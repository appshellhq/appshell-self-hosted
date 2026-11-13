/*
 * The cases at the edges: a pinned colour scheme, a frame sized to its content, the first
 * paint, the app opened on its own, and the app's process going away under an open page.
 *
 *   node edges.mjs [restart]     restart: wait for `docker compose restart research` mid-run
 */
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const PORTAL = process.env.PORTAL ?? 'http://localhost:7250/a/acme/portal';
const OUT = process.env.OUT ?? '.';
const results = {};
const browser = await chromium.launch();
const inner = (tab) => tab.frames().find((f) => f !== tab.mainFrame());
const look = (tab) =>
  inner(tab).evaluate(() => ({
    dark: document.body.classList.contains('body--dark'),
    background: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.body).color,
    card: getComputedStyle(document.querySelector('.q-card')).backgroundColor,
  }));

// Each viewer's own scheme, then one the application pins while the page is open.
{
  const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
  const tab = await context.newPage();
  await tab.goto(`${PORTAL}/research`);
  await tab.frameLocator('iframe.frame').getByText('Experiment runs').waitFor();
  await tab.waitForTimeout(800);
  results['system scheme, viewer prefers dark'] = await look(tab);
  await tab.screenshot({ path: `${OUT}/system-dark.png` });

  await tab.evaluate(() => (document.documentElement.dataset.appshellTheme = 'light'));
  await tab.waitForTimeout(500);
  results['pinned light, viewer prefers dark'] = await look(tab);
  await tab.screenshot({ path: `${OUT}/pinned-light.png` });
  await context.close();
}

// Sized to its content: the host is told the height, and the page scrolls instead of the frame.
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const tab = await context.newPage();
  await tab.goto(`${PORTAL}/research`);
  const frame = tab.frameLocator('iframe.frame');
  await frame.getByText('Experiment runs').waitFor();
  const height = () => tab.locator('iframe.frame').evaluate((f) => f.getBoundingClientRect().height);
  const before = await height();

  // What the wrapper sends with SIZING: content, sent again by hand.
  await tab.locator('iframe.frame').evaluate((f) =>
    f.contentWindow.postMessage(
      {
        appshell: 'appshell-frame/1',
        type: 'init',
        sizing: 'content',
        vars: {},
        colorScheme: 'system',
        themeCss: [...document.querySelectorAll('style')]
          .map((s) => s.textContent)
          .find((css) => css.trimStart().startsWith(':root')),
      },
      new URL(f.src).origin,
    ),
  );
  await tab.waitForTimeout(500);
  const fitted = await height();
  await frame.getByText('Show every epoch').click();
  await tab.waitForTimeout(700);
  const grown = await height();

  await frame.getByText('Archive…').click();
  await frame.getByText('Archive this experiment?').waitFor();
  await tab.waitForTimeout(400);
  const dialog = await frame.locator('.q-dialog .q-card').boundingBox();
  await tab.screenshot({ path: `${OUT}/content-dialog.png` });
  results['content sizing'] = {
    'frame height: filled, fitted, grown': [before, fitted, grown],
    'page scrolls': await tab.evaluate(() => document.documentElement.scrollHeight > innerHeight),
    'dialog top in the viewport (800 high)': dialog?.y,
  };
  await context.close();
}

// The first paint: is anything unthemed ever on screen?
{
  const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
  const tab = await context.newPage();
  const started = Date.now();
  const shots = [];
  const go = tab.goto(`${PORTAL}/research`, { waitUntil: 'commit' });
  for (let i = 0; i < 12; i += 1) {
    await tab.waitForTimeout(120);
    const at = Date.now() - started;
    await tab.screenshot({ path: `${OUT}/paint-${String(i).padStart(2, '0')}.png` }).catch(() => {});
    shots.push(at);
  }
  await go;
  results['first paint shots at (ms)'] = shots;
  await context.close();
}

// Opened on its own: the app as it always was.
{
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const tab = await context.newPage();
  await tab.goto('http://localhost:7260/');
  await tab.getByText('Experiment runs').waitFor();
  await tab.waitForTimeout(500);
  results['opened on its own'] = await tab.evaluate(() => ({
    primary: getComputedStyle(document.body).getPropertyValue('--q-primary'),
    fromHost: document.querySelector('.text-caption')?.textContent,
    pending: document.documentElement.classList.contains('appshell-pending'),
  }));
  await tab.screenshot({ path: `${OUT}/standalone.png` });
  await context.close();
}

// The process restarts under an open page: its state was in memory.
if (process.argv[2] === 'restart') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const tab = await context.newPage();
  await tab.goto(`${PORTAL}/research`);
  const frame = tab.frameLocator('iframe.frame');
  await frame.getByText('Experiment runs').waitFor();
  await frame.locator('.q-slider').click({ position: { x: 230, y: 10 } });
  await tab.waitForTimeout(500);
  const before = await frame.getByText(/^0\.\d{4}$/).textContent();

  const compose = ['compose', '-p', 'appshell-spike', '-f', 'compose.yaml', '-f', 'spike/compose.yaml'];
  execFileSync('docker', [...compose, 'kill', 'research'], { cwd: process.env.REPO, stdio: 'ignore' });
  await tab.waitForTimeout(2500);
  await tab.screenshot({ path: `${OUT}/restart-down.png` });
  const down = await inner(tab).evaluate(() => document.body.innerText.match(/connection lost[^\n]*/i)?.[0] ?? 'no message');

  const killed = Date.now();
  execFileSync('docker', [...compose, 'up', '--wait', 'research'], {
    cwd: process.env.REPO,
    stdio: 'ignore',
    env: { ...process.env, REGISTRY_IMAGE: 'appshell/registry:local' },
  });
  let after = 'never came back';
  try {
    await frame.getByText('Experiment runs').waitFor({ timeout: 30000 });
    await frame.getByText(/^0\.\d{4}$/).waitFor({ timeout: 30000 });
    await tab.waitForFunction(() => true);
    await tab.waitForTimeout(4000);
    after = await frame.getByText(/^0\.\d{4}$/).textContent();
  } catch (error) {
    after = `FAILED: ${error.message.split('\n')[0]}`;
  }
  await tab.screenshot({ path: `${OUT}/restart-back.png` });
  results['process restarted under an open page'] = {
    'slider before': before,
    'while down': down,
    'slider after': after,
    'themed after': await inner(tab).evaluate(() => Boolean(document.getElementById('appshell-theme'))),
    'seconds': Math.round((Date.now() - killed) / 1000),
  };
  await context.close();
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
