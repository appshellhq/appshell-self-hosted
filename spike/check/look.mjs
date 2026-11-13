/*
 * Opens each framed page and says what happened: what the console logged, what the frame's
 * document ended up with, and a screenshot.
 *
 *   node look.mjs [light|dark]
 */
import { chromium } from 'playwright';

const PORTAL = process.env.PORTAL ?? 'http://localhost:7250/a/acme/portal';
const OUT = process.env.OUT ?? '.';
const scheme = process.argv[2] ?? 'light';

const browser = await chromium.launch();

for (const page of ['research', 'research-same-origin', 'research-cross-site']) {
  const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });
  const tab = await context.newPage();
  const logged = [];
  tab.on('console', (m) => ['error', 'warning'].includes(m.type()) && logged.push(`${m.type()}: ${m.text()}`));
  tab.on('pageerror', (e) => logged.push(`pageerror: ${e.message}`));

  const started = Date.now();
  await tab.goto(`${PORTAL}/${page}`);
  const frame = tab.frameLocator('iframe.frame');

  let state;
  try {
    await frame.getByText('Experiment runs').waitFor({ timeout: 10000 });
    const ready = Date.now() - started;
    await frame.locator('.nicegui-content, body').first().waitFor();
    await tab.waitForTimeout(1500);
    state = await tab.frames().find((f) => f !== tab.mainFrame()).evaluate(() => {
      const body = getComputedStyle(document.body);
      return {
        url: location.href,
        themed: Boolean(document.getElementById('appshell-theme')?.textContent),
        pending: document.documentElement.classList.contains('appshell-pending'),
        primary: body.getPropertyValue('--q-primary'),
        background: body.backgroundColor,
        dark: document.body.classList.contains('body--dark'),
        fromHost: document.querySelector('.text-caption')?.textContent,
        visits: [...document.querySelectorAll('.text-caption')].at(1)?.textContent,
        cookie: document.cookie,
      };
    });
    state.readyMs = ready;
  } catch (error) {
    state = { failed: error.message.split('\n')[0] };
  }

  const box = await tab.locator('iframe.frame').boundingBox().catch(() => null);
  await tab.screenshot({ path: `${OUT}/${page}-${scheme}.png` });
  console.log(`\n== ${page} (${scheme})`);
  console.log(JSON.stringify({ ...state, frameBox: box, hostAddress: tab.url() }, null, 2));
  for (const line of logged) console.log(`  ${line}`);
  await context.close();
}

await browser.close();
