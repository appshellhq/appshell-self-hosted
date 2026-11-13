/*
 * Drives each framed page the way a person would, and reports what the spike asks about:
 * routes and history, the socket, the session cookie, isolation, and the sandbox.
 */
import { chromium } from 'playwright';

const PORTAL = process.env.PORTAL ?? 'http://localhost:7250/a/acme/portal';
const OUT = process.env.OUT ?? '.';
const PAGES = (process.env.PAGES ?? 'research research-same-origin research-cross-site').split(' ');

const browser = await chromium.launch();
const results = {};

const inner = (tab) => tab.frames().find((f) => f !== tab.mainFrame());
const path = (url) => new URL(url).pathname;
const settle = (tab) => tab.waitForTimeout(700);

for (const page of PAGES) {
  const r = (results[page] = {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const tab = await context.newPage();
  const logged = [];
  tab.on('console', (m) => m.type() === 'error' && logged.push(m.text()));
  const frame = tab.frameLocator('iframe.frame');
  const step = async (name, fn) => {
    try {
      r[name] = await fn();
    } catch (error) {
      r[name] = `FAILED: ${error.message.split('\n')[0]}`;
    }
  };

  await tab.goto(`${PORTAL}/${page}`);
  await frame.getByText('Experiment runs').waitFor();

  // The socket: a slider moved in the browser redraws a chart from Python.
  await step('socket round trip', async () => {
    const label = frame.getByText(/^0\.\d{4}$/);
    const before = await label.textContent();
    await frame.locator('.q-slider').click({ position: { x: 230, y: 10 } });
    await frame.getByText(/^0\.\d{4}$/).filter({ hasNotText: before }).waitFor({ timeout: 4000 });
    return `${before} -> ${await label.textContent()}`;
  });

  // A link inside the frame: does the page's address follow it?
  await step('frame link -> host address', async () => {
    await frame.getByText('r-102', { exact: true }).click();
    await frame.getByText('Run r-102').waitFor();
    await settle(tab);
    return { host: path(tab.url()), frame: path(inner(tab).url()) };
  });

  await step('back', async () => {
    await tab.goBack();
    await frame.getByText('Experiment runs').waitFor({ timeout: 5000 });
    await settle(tab);
    return { host: path(tab.url()), frame: path(inner(tab).url()) };
  });

  await step('forward', async () => {
    await tab.goForward();
    await frame.getByText('Run r-102').waitFor({ timeout: 5000 });
    await settle(tab);
    return { host: path(tab.url()), frame: path(inner(tab).url()) };
  });

  // The layout's own link to this page, while the frame is deeper in.
  await step("layout's link while deep", async () => {
    await tab.locator('.layout-nav a.active').click();
    await frame.getByText('Experiment runs').waitFor({ timeout: 5000 });
    await settle(tab);
    return { host: path(tab.url()), frame: path(inner(tab).url()) };
  });

  await step('away and back', async () => {
    await tab.locator('.layout-nav a', { hasText: 'Orders' }).click();
    await tab.getByText('Recent orders').waitFor();
    await tab.goBack();
    await frame.getByText('Experiment runs').waitFor({ timeout: 5000 });
    await settle(tab);
    return { host: path(tab.url()), frame: path(inner(tab).url()) };
  });

  // A deep link, and a reload of one.
  await step('deep link', async () => {
    await tab.goto(`${PORTAL}/${page}/runs/r-101`);
    await frame.getByText('Run r-101').waitFor({ timeout: 5000 });
    await settle(tab);
    return { host: path(tab.url()), frame: path(inner(tab).url()) };
  });

  // The session cookie: a second load of the app in the same browser.
  await step('session cookie kept', async () => {
    await tab.goto(`${PORTAL}/${page}`);
    await frame.getByText('Experiment runs').waitFor();
    const first = await frame.getByText(/Visits this session/).textContent();
    await tab.reload();
    await frame.getByText('Experiment runs').waitFor();
    const second = await frame.getByText(/Visits this session/).textContent();
    return `${first} / ${second}`;
  });

  // A dialog, which the frame can't draw outside itself.
  await step('dialog', async () => {
    await frame.getByText('Archive…').click();
    await frame.getByText('Archive this experiment?').waitFor();
    await tab.waitForTimeout(400);
    await tab.screenshot({ path: `${OUT}/${page}-dialog.png` });
    const backdrop = await frame.locator('.q-dialog__backdrop').boundingBox();
    await frame.getByText('Cancel').click();
    return { backdrop };
  });

  // Isolation: can the app's page reach the shell's?
  await step('frame reads the shell page', () =>
    inner(tab).evaluate(() => {
      try {
        return `yes: "${window.parent.document.title}", config ${typeof window.parent.__appshell_config__}`;
      } catch (error) {
        return `no: ${error.name}`;
      }
    }),
  );

  r.errors = logged;
  await context.close();
}

// What the sandbox has to allow, and what the registry's policy does to an origin it wasn't told of.
{
  const context = await browser.newContext();
  const tab = await context.newPage();
  await tab.goto(`${PORTAL}/orders`);
  const violations = [];
  await tab.exposeFunction('violation', (v) => violations.push(v));
  await tab.evaluate(() =>
    document.addEventListener('securitypolicyviolation', (e) =>
      window.violation(`${e.violatedDirective} blocked ${e.blockedURI}`),
    ),
  );

  const tryFrame = async (src, sandbox) => {
    await tab.evaluate(
      ([src, sandbox]) => {
        document.getElementById('probe')?.remove();
        const frame = document.createElement('iframe');
        frame.id = 'probe';
        if (sandbox !== null) frame.setAttribute('sandbox', sandbox);
        frame.src = src;
        frame.style.cssText = 'width:600px;height:400px';
        document.body.append(frame);
      },
      [src, sandbox],
    );
    try {
      await tab.frameLocator('#probe').getByText('Experiment runs').waitFor({ timeout: 5000 });
      const probe = tab.frames().find((f) => f.url().startsWith(src));
      await tab.frameLocator('#probe').locator('.q-slider').click({ position: { x: 200, y: 10 } });
      await tab.waitForTimeout(600);
      return `renders; slider label ${await probe.locator('text=/^0\\.\\d{4}$/').textContent()}`;
    } catch {
      return 'does not render';
    }
  };

  results.sandbox = {
    'allow-scripts allow-same-origin': await tryFrame('http://localhost:7260/', 'allow-scripts allow-same-origin'),
    'allow-scripts': await tryFrame('http://localhost:7260/', 'allow-scripts'),
    '(empty)': await tryFrame('http://localhost:7260/', ''),
  };
  results['origin the policy was not told of'] = await tryFrame('http://localhost:7261/', null);
  results.violations = violations;
  await context.close();
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
