/*
 * Stage 2: the framed app behind a real gateway, on kind (spike/kind). Signs in as the demo's
 * accounts and reports what the spike asks about a cluster: who the app thinks is signed in,
 * the socket through the gateway, a private package's gate, two replicas, and a replica dying.
 *
 *   node gateway.mjs                 every section
 *   node gateway.mjs sticky kill     only those
 */
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const SITE = process.env.SITE ?? 'https://spike.local.appshell.org';
const PORTAL = `${SITE}/a/acme/portal`;
const AUTH_HOST = 'spike-auth.local.appshell.org';
const RESEARCH_HOST = 'spike-research.local.appshell.org';
const CONTEXT = process.env.KUBE_CONTEXT ?? 'dev';
const OUT = process.env.OUT ?? '.';
const only = process.argv.slice(2);
const wanted = (name) => only.length === 0 || only.includes(name);

const browser = await chromium.launch();
const results = {};

const kubectl = (...args) =>
  execFileSync('kubectl', ['--context', CONTEXT, '-n', 'appshell-spike', ...args], { encoding: 'utf-8' });

const section = async (name, fn) => {
  if (!wanted(name)) return;
  try {
    results[name] = await fn();
  } catch (error) {
    results[name] = `FAILED: ${error.message.split('\n')[0]}`;
  }
};

/** A browser of its own, signed in at the portal as one of the demo's people. */
const signedIn = async (username = 'alice', start = `${PORTAL}/research-same-origin`) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const tab = await context.newPage();
  const errors = [];
  tab.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));

  const response = await tab.goto(start);
  let status = response?.status();
  if (new URL(tab.url()).host === AUTH_HOST) {
    await tab.locator('#username').fill(username);
    await tab.locator('#password').fill(username);
    const [landed] = await Promise.all([
      tab.waitForResponse((r) => r.url().startsWith(SITE) && r.request().isNavigationRequest() && r.status() !== 302),
      tab.locator('#kc-login').click(),
    ]);
    status = landed.status();
  }

  return { context, tab, errors, status, frame: tab.frameLocator('iframe.frame') };
};

/** What the app's page says about itself, once its socket has delivered the host's answer. */
const told = async (frame, timeout = 15000) => {
  await frame.getByText(/^Dataset /).waitFor({ timeout });
  const text = async (pattern) => (await frame.getByText(pattern).textContent()).trim();

  return {
    user: await text(/^(Signed in as|Nobody signed in)/),
    pod: (await text(/^Served by/)).replace(/^Served by |\.$/g, ''),
    visits: await text(/^Visits this session/),
  };
};

const moveSlider = async (frame) => {
  const label = frame.getByText(/^0\.\d{4}$/);
  const before = await label.textContent();
  const x = before === '0.0090' ? 60 : 230;
  await frame.locator('.q-slider').click({ position: { x, y: 10 } });
  await frame.getByText(/^0\.\d{4}$/).filter({ hasNotText: before }).waitFor({ timeout: 5000 });

  return `${before} -> ${await label.textContent()}`;
};

// By path on the portal's origin: the portal's session, and the socket under a prefix.
await section('same origin', async () => {
  const { context, tab, frame, errors } = await signedIn('alice');
  const r = { ...(await told(frame)) };
  r.socket = await moveSlider(frame);

  await frame.getByText('r-102', { exact: true }).click();
  await frame.getByText('Run r-102').waitFor();
  await tab.waitForTimeout(700);
  r.link = { host: new URL(tab.url()).pathname, frame: new URL(tab.frames()[1].url()).pathname };
  await tab.goBack();
  await frame.getByText('Experiment runs').waitFor();

  // A request that names its own user: the gateway drops it and fills in the session's.
  await context.setExtraHTTPHeaders({ 'X-Userinfo': Buffer.from('{"preferred_username":"mallory"}').toString('base64') });
  await tab.reload();
  r['with a forged X-Userinfo'] = (await told(frame)).user;
  await context.setExtraHTTPHeaders({});

  await tab.screenshot({ path: `${OUT}/gateway-same-origin.png` });
  r.errors = errors;
  await context.close();

  return r;
});

// An origin of its own: a second session, begun inside the frame with nobody typing anything.
await section('own origin', async () => {
  const { context, tab, frame, errors } = await signedIn('alice');
  const hops = [];
  tab.on('framenavigated', (f) => f !== tab.mainFrame() && hops.push(new URL(f.url()).host + new URL(f.url()).pathname));
  const requests = [];
  tab.on('response', (r) => {
    const url = new URL(r.url());
    if (r.request().isNavigationRequest() && r.request().frame() !== tab.mainFrame()) {
      requests.push(`${r.status()} ${url.host}${url.pathname}`);
    }
  });

  await tab.goto(`${PORTAL}/research`);
  const r = { ...(await told(frame)) };
  r['the frame was sent through'] = requests;
  r.socket = await moveSlider(frame);
  r.cookies = (await context.cookies())
    .filter((c) => c.domain.includes('spike'))
    .map((c) => `${c.domain} ${c.name} ${c.sameSite}${c.httpOnly ? ' HttpOnly' : ''}`);
  await tab.screenshot({ path: `${OUT}/gateway-own-origin.png` });

  // The portal's session without the identity provider's: what the frame can't do by itself.
  await context.clearCookies({ domain: AUTH_HOST });
  await context.clearCookies({ domain: RESEARCH_HOST });
  errors.length = 0;
  await tab.reload();
  await tab.waitForTimeout(4000);
  const inner = tab.frames().find((f) => f !== tab.mainFrame());
  r['with no session at the identity provider'] = {
    frame: inner ? new URL(inner.url()).host + new URL(inner.url()).pathname : 'none',
    shows: inner ? (await inner.locator('body').innerText().catch((e) => `unreadable: ${e.message.split('\n')[0]}`)).slice(0, 120) : '',
    errors: [...errors],
  };
  await tab.screenshot({ path: `${OUT}/gateway-own-origin-signed-out.png` });
  await context.close();

  return r;
});

// A private package's gate: the app by path answers only a browser the registry gave a grant.
await section('grant', async () => {
  const r = {};
  const direct = await signedIn('alice', `${SITE}/frames/research/`);
  r['signed in, never served the portal'] = direct.status;
  await direct.tab.goto(`${PORTAL}`);
  r['then, after the portal'] = (await direct.tab.goto(`${SITE}/frames/research/`)).status();
  await direct.context.clearCookies({ name: 'appshell_grant' });
  r['then, with the grant cookie gone'] = (await direct.tab.goto(`${SITE}/frames/research/`)).status();
  await direct.context.close();

  return r;
});

// Two replicas: does a page's socket find the replica that built the page?
await section('sticky', async () => {
  const r = { loadbalancer: kubectl('get', 'apisixupstream', 'research', '-o', 'jsonpath={.spec.loadbalancer}') };

  for (const person of ['alice', 'bob']) {
    const { context, tab, frame } = await signedIn(person);
    const loads = [];
    for (let i = 0; i < 8; i += 1) {
      // Every document the frame was served, and by which replica: more than one is the app
      // reloading itself because its socket reached a replica that never built the page.
      const served = [];
      const note = async (response) => {
        if (response.request().isNavigationRequest() && response.request().frame() !== tab.mainFrame()) {
          const body = await response.text().catch(() => '');
          served.push(/Served by research-[a-z0-9]+-([a-z0-9]{5})/.exec(body)?.[1] ?? response.status());
        }
      };
      tab.on('response', note);
      const started = Date.now();
      await tab.reload();
      try {
        const { pod } = await told(frame, 20000);
        await tab.waitForTimeout(300);
        loads.push(`${pod.slice(-5)} in ${Date.now() - started} ms, frame served by ${served.join(', ')}`);
      } catch {
        loads.push(`never connected in ${Date.now() - started} ms, frame served by ${served.join(', ')}`);
      }
      tab.off('response', note);
    }
    r[person] = loads;
    await context.close();
  }

  return r;
});

// An open page left alone, longer than a proxy's idle timeout.
await section('idle', async () => {
  const { context, tab, frame } = await signedIn('alice');
  await told(frame);
  await tab.waitForTimeout(150_000);
  const lost = await frame.getByText('Connection lost').isVisible().catch(() => false);
  const r = { 'after 150 s idle': lost ? 'connection lost' : `still connected: ${await moveSlider(frame)}` };
  await context.close();

  return r;
});

// The replica holding an open page goes away.
await section('kill', async () => {
  const { context, tab, frame } = await signedIn('alice');
  const before = await told(frame);
  await moveSlider(frame);
  kubectl('delete', 'pod', before.pod, '--wait=false');
  const killed = Date.now();

  const r = { before };
  const documents = [];
  tab.on('response', (response) => {
    if (response.request().isNavigationRequest() && response.request().frame() !== tab.mainFrame()) {
      documents.push(`${response.status()} at ${Date.now() - killed} ms`);
    }
  });
  // Watched together: the notice may be up for less time than it takes to look for it.
  const lost = frame.getByText('Connection lost').waitFor({ timeout: 60000 }).then(
    async () => {
      r['said "Connection lost" after ms'] = Date.now() - killed;
      await tab.screenshot({ path: `${OUT}/gateway-killed.png` });
    },
    () => (r['said "Connection lost"'] = 'never'),
  );
  const back = frame
    .getByText(/^Served by/)
    .filter({ hasNotText: before.pod })
    .waitFor({ timeout: 60000 })
    .then(
      () => (r['back on another replica after ms'] = Date.now() - killed),
      () => (r['back on another replica'] = 'not within a minute'),
    );
  await Promise.race([Promise.all([lost, back]), back.then(() => tab.waitForTimeout(500))]);
  r['the frame was served'] = documents;
  await tab.screenshot({ path: `${OUT}/gateway-after-kill.png` });
  if (r['back on another replica after ms']) {
    r.after = await told(frame);
    r['slider after'] = await frame.getByText(/^0\.\d{4}$/).textContent();
  } else {
    const inner = tab.frames().find((f) => f !== tab.mainFrame());
    r['the frame shows'] = (await inner.locator('body').innerText().catch(() => 'nothing readable')).slice(0, 200);
  }
  await context.close();

  return r;
});

console.log(JSON.stringify(results, null, 2));
await browser.close();
