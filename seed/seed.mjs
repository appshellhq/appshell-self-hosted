/*
 * Seeds the registry with what a platform team would publish first: a layout, two pages, and
 * acme/portal, the application that composes them.
 *
 * Run it with `docker compose run --rm seed`, once the registry is up. It's safe to run again:
 * claiming a scope it already owns, publishing a version again with the same content, and
 * applying the same application change nothing.
 *
 * It signs in as appshell-seed, a service account in the demo realm that holds the publisher
 * role, through the client credentials grant: a pipeline's identity rather than a person's. So
 * acme belongs to that account, and a person who wants to change the portal clones it into a
 * scope of their own.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const { APPSHELL_REGISTRY, PUBLIC_URL, TOKEN_URL, SEED_CLIENT_ID, SEED_CLIENT_SECRET } = process.env;

const SCOPE = 'acme';
const REMOTES = ['layout', 'home', 'orders', 'frame'];
const BUNDLES = '/bundles';

const waitFor = async (url, what) => {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(5000) })).ok) return;
    } catch {
      // Not answering yet.
    }
    await sleep(2000);
  }

  throw new Error(`${what} never answered at ${url}`);
};

/** One digest of every file under dir and its path, so two builds compare in one step. */
const digestOf = (dir) => {
  const hash = createHash('sha256');
  for (const file of readdirSync(dir, { recursive: true }).sort()) {
    const path = join(dir, file);
    if (statSync(path).isFile()) hash.update(`${file}\0`).update(readFileSync(path)).update('\0');
  }

  return hash.digest('hex');
};

const signIn = async () => {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: SEED_CLIENT_ID,
      client_secret: SEED_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    throw new Error(`Keycloak refused the seed's sign-in: ${response.status} ${await response.text()}`);
  }

  return (await response.json()).access_token;
};

await waitFor(`${APPSHELL_REGISTRY}/health`, 'The registry');

const env = {
  ...process.env,
  APPSHELL_TOKEN: await signIn(),
  // The CLI's own config and credentials, kept out of the way: everything it needs is above.
  APPSHELL_CONFIG: '/tmp/appshell/config',
  APPSHELL_CREDENTIALS: '/tmp/appshell/credentials',
};

// Run with this node, as the image has no shell to read the bin script's #! line.
const appshell = (cwd, ...args) =>
  execFileSync(process.execPath, ['/seed/node_modules/.bin/appshell', ...args], {
    cwd,
    env,
    stdio: 'inherit',
  });

appshell('/remotes', 'scopes', 'create', SCOPE);

const packages = REMOTES.map((name) => {
  const dir = `/remotes/${name}`;
  const { version } = JSON.parse(readFileSync(`${dir}/package.json`, 'utf-8'));

  // Where a deployment puts a build: the bundles server, which the registry fetches from at
  // {scope}/{name}/{version}/. The registry itself never stores a package's code. It tells
  // browsers a version's files never change, so a version already there is left as it is, and
  // a different build is refused rather than served to some browsers and not others.
  const bundle = `${BUNDLES}/${SCOPE}/${name}/${version}`;
  if (!existsSync(bundle)) {
    cpSync(`${dir}/dist`, bundle, { recursive: true });
  } else if (digestOf(bundle) !== digestOf(`${dir}/dist`)) {
    throw new Error(
      `bundles/${SCOPE}/${name}/${version} holds a different build. A published version never ` +
        `changes: give remotes/${name} a new version, or start over (see the README).`,
    );
  }
  appshell(dir, 'publish', '--template', 'dist/appshell.template.json');

  return `${SCOPE}/${name}@${version}`;
});

const application = '/tmp/portal.app.yaml';
writeFileSync(
  application,
  `${readFileSync('/seed/portal.app.yaml', 'utf-8')}  packages:\n${packages.map((p) => `    - ${p}\n`).join('')}`,
);
appshell('/seed', 'app', 'apply', '-f', application);

console.log(`\nSeeded. Open ${PUBLIC_URL}/a/${SCOPE}/portal`);
