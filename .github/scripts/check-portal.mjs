/*
 * Opens the seeded portal in Chromium, as a visitor gets it, and fails unless it composed.
 *
 * Serving the right bytes isn't composing them: a remote that fails to load, or a shared
 * dependency that no longer lines up, serves fine and renders nothing. So this checks what the
 * page shows, and that nothing on it failed.
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:7150/a/acme/portal';
const browser = await chromium.launch();
const page = await browser.newPage();
const problems = [];

page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
page.on('console', (message) => message.type() === 'error' && problems.push(`console: ${message.text()}`));
page.on('response', (response) => response.status() >= 400 && problems.push(`${response.status()} ${response.url()}`));

await page.goto(url, { waitUntil: 'networkidle' });

const expect = async (description, locator) => {
  try {
    await locator.first().waitFor({ timeout: 15_000 });
    console.log(`ok: ${description}`);
  } catch {
    problems.push(`missing: ${description}`);
  }
};

await expect('the layout, with its navigation', page.getByRole('navigation', { name: 'Pages' }));
await expect('home, as the start page', page.getByRole('heading', { name: 'Your registry composed this page' }));
for (const pkg of ['acme/layout@1.0.0', 'acme/home@1.0.0', 'acme/orders@1.0.0']) {
  await expect(`${pkg}, served by the registry`, page.getByText(pkg, { exact: true }));
}

await page.getByRole('link', { name: 'Orders' }).click();
await expect('orders, at its route', page.getByRole('heading', { name: 'Recent orders' }));

await browser.close();

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
