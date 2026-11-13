/*
 * Props from the container to a framed app, against kind (spike/kind). The layout's header has
 * a project selector, which every page gets as a prop through the published RemoteSlot.
 *
 *   node props.mjs                 every section
 *   node props.mjs change          only that one
 */
import { chromium } from 'playwright';

const SITE = process.env.SITE ?? 'https://spike.local.appshell.org';
const PORTAL = `${SITE}/a/acme/portal`;
const AUTH_HOST = 'spike-auth.local.appshell.org';
const OUT = process.env.OUT ?? '.';
const only = process.argv.slice(2);
const wanted = (name) => only.length === 0 || only.includes(name);

const browser = await chromium.launch();
const results = {};

const section = async (name, fn) => {
  if (!wanted(name)) return;
  try {
    results[name] = await fn();
  } catch (error) {
    // The first line only: the rest of a failure can quote the page, cookies and all.
    results[name] = `FAILED: ${error.message.split('\n')[0]}`;
  }
};

/** In every frame: when the bridge let the page paint, and when the project reached its label. */
const timings = () => {
  if (window.parent === window) return;

  const seen = {};
  window.spikeTimings = seen;
  let pending = false;

  new MutationObserver(() => {
    const now = document.documentElement.classList.contains('appshell-pending');
    if (pending && !now && seen.revealed === undefined) seen.revealed = Math.round(performance.now());
    pending = now;

    if (seen.project === undefined) {
      const told = [...document.querySelectorAll('.text-caption')].some((label) =>
        /^Project \w+, from the container/.test(label.textContent),
      );
      if (told) seen.project = Math.round(performance.now());
    }
  }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
};

/** A browser of its own, signed in at the portal as alice. */
const signedIn = async (page) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  await context.addInitScript(timings);
  const tab = await context.newPage();

  await tab.goto(`${PORTAL}/${page}`);
  if (new URL(tab.url()).host === AUTH_HOST) {
    await tab.locator('#username').fill('alice');
    await tab.locator('#password').fill('alice');
    await Promise.all([tab.waitForURL(`${PORTAL}/**`), tab.locator('#kc-login').click()]);
  }

  return { context, tab, frame: tab.frameLocator('iframe.frame') };
};

const project = (frame) => frame.getByText(/^(Project \w+, from|No project)/);
const runs = (frame) => frame.locator('a').filter({ hasText: /^r-\d+$/ }).allTextContents();
const slider = (frame) => frame.getByText(/^0\.\d{4}$/).textContent();
const visits = async (frame) => (await frame.getByText(/^Visits this session/).textContent()).trim();

const said = async (frame, pattern, timeout = 15000) => {
  await project(frame).filter({ hasText: pattern }).waitFor({ timeout });
  return (await project(frame).textContent()).trim();
};

/** Every document the frame is served from here on. */
const framesServed = (tab) => {
  const served = [];
  tab.on('response', (response) => {
    if (response.request().isNavigationRequest() && response.request().frame() !== tab.mainFrame()) {
      served.push(response.status());
    }
  });

  return served;
};

/** Marks an element as the one that's there now, and says later whether it still is. */
const mark = (tab, selector) => tab.locator(selector).evaluate((element) => Object.assign(element, { spikeMarked: true }));
const kept = (tab, selector) =>
  tab.locator(selector).evaluate((element) => element.spikeMarked === true).catch(() => false);

const choose = (tab, name) => tab.locator('.layout-header select').selectOption(name);

/**
 * A React remote that takes no props at all, when the project changes: is it the same element
 * after, and what did RemoteSlot do? It logs each load its loader starts, and each time it
 * draws, with whether it had the remote to draw.
 */
const reactRemote = async (tab) => {
  await tab.getByRole('link', { name: 'Orders' }).click();
  await tab.locator('section.orders').waitFor();
  await tab.waitForTimeout(500);
  await mark(tab, 'section.orders');

  const slot = [];
  const note = (message) => slot.push(message.text());
  tab.on('console', note);
  await choose(tab, 'language');
  await tab.waitForTimeout(1000);
  tab.off('console', note);

  const r = {
    'the remote': (await kept(tab, 'section.orders')) ? 'the same element' : 'unmounted and mounted again',
    'RemoteSlot loaded it again': slot.filter((line) => line.startsWith('loading Appshell component')).length,
    'RemoteSlot drew without it': slot.filter((line) => /^rendering RemoteSlot.*loading=true$/.test(line)).length,
  };
  await choose(tab, 'vision');
  await tab.waitForTimeout(500);

  return r;
};

/** The framed app with its slider moved: what a change of project does to it. */
const framed = async (tab, frame, link) => {
  await tab.getByRole('link', { name: link, exact: true }).click();
  const r = { before: { project: await said(frame, /^Project vision/), runs: await runs(frame) } };

  await frame.locator('.q-slider').click({ position: { x: 230, y: 10 } });
  await frame.getByText('0.0090').waitFor();
  r.before.slider = await slider(frame);
  r.before.visits = await visits(frame);

  await mark(tab, 'iframe.frame');
  const served = framesServed(tab);
  const started = Date.now();
  await choose(tab, 'language');
  r.after = { project: await said(frame, /^Project language/) };
  r.after['told after ms'] = Date.now() - started;
  await tab.waitForTimeout(500);

  r.after.runs = await runs(frame);
  r.after.slider = await slider(frame);
  r.after.visits = await visits(frame);
  r['the iframe'] = (await kept(tab, 'iframe.frame')) ? 'the same element' : 'a new one';
  r['documents the frame was served'] = served.length;

  return r;
};

// A prop that changes: is the remote mounted again, and does the change reach the frame?
await section('change', async () => {
  const { context, tab, frame } = await signedIn('research-same-origin');
  await said(frame, /^Project vision/);

  const r = { 'a React remote (Orders)': await reactRemote(tab) };
  r['the framed app, by path'] = await framed(tab, frame, 'Research, same origin');
  await tab.screenshot({ path: `${OUT}/props-change.png` });

  // Three changes with nothing between them: whole props each time, so the last one stands.
  for (const name of ['vision', 'language', 'vision']) await choose(tab, name);
  r['after vision, language, vision at once'] = await said(frame, /^Project vision/);

  await choose(tab, 'vision');
  r['the framed app, on an origin of its own'] = await framed(tab, frame, 'Research');
  await context.close();

  return r;
});

// The frame loads a page of its own: the host answers its hello with the props as they are now.
await section('navigation', async () => {
  const { context, tab, frame } = await signedIn('research-same-origin');
  await said(frame, /^Project vision/);
  await choose(tab, 'language');
  await said(frame, /^Project language/);

  const r = {};
  await frame.getByText('r-102', { exact: true }).click();
  await frame.getByText('Run r-102').waitFor();
  r['on the run page'] = await said(frame, /^Project language/);
  await choose(tab, 'vision');
  r['changed while on it'] = await said(frame, /^Project vision/);
  await tab.goBack();
  await frame.getByText('Experiment runs').waitFor();
  r['back on the list'] = { project: await said(frame, /^Project vision/), runs: await runs(frame) };
  await context.close();

  return r;
});

// The page is built before the host has answered: what's on it until the props arrive.
await section('first paint', async () => {
  const { context, tab, frame } = await signedIn('research-same-origin');
  const loads = [];
  for (let i = 0; i < 5; i += 1) {
    await tab.reload();
    await said(frame, /^Project vision/);
    const seen = await tab.frames()[1].evaluate(() => window.spikeTimings);
    loads.push(`painted at ${seen.revealed} ms, told its project at ${seen.project} ms`);
  }
  await context.close();

  return loads;
});

// A prop is the browser's word: the page's own script, or anything else in it, can say another.
await section('untrusted', async () => {
  const { context, tab, frame } = await signedIn('research-same-origin');
  await said(frame, /^Project vision/);
  await tab.evaluate(() =>
    document
      .querySelector('iframe.frame')
      .contentWindow.postMessage({ appshell: 'appshell-frame/1', type: 'props', props: { project: 'everything' } }, '*'),
  );
  const r = { 'a project that is not one': await said(frame, /^No project named/), runs: await runs(frame) };
  await context.close();

  return r;
});

console.log(JSON.stringify(results, null, 2));
await browser.close();
