# appshell, self-hosted

The [appshell](https://appshell.org) registry, running on your machine. One command starts it with
everything it needs, and publishes an application composed from three micro-frontends. You can
then sign in, develop a page into a copy of that application, publish it, roll it back, and see
who may change what.

## What you need

- **Docker with Compose:** Docker Desktop, Rancher Desktop, or Podman with Compose.
- **Ports 7150 and 8080 free:** 7150 for the registry, 8080 for Keycloak.
- **Node 24,** from step 2 of the walkthrough. Step 1 needs only Docker.

## Start it

```sh
git clone https://github.com/appshellhq/appshell-self-hosted.git
cd appshell-self-hosted
docker compose up --wait
```

The first run builds the seed, which takes a minute or two. Then open
<http://localhost:7150/a/acme/portal>.

## What's running

| Service    | What it is                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registry` | The appshell registry. It stores packages' manifests and applications, composes each application's page, and serves packages' code on the application's own origin.                                       |
| `mongodb`  | The registry's only store.                                                                                                                                                                                    |
| `keycloak` | Who signs in. Its `appshell` realm has **alice** (password `alice`), who may publish, and **bob** (`bob`), who may not. The admin console is at <http://localhost:8080>, as `admin` / `admin`.             |
| `bundles`  | Where packages' code lives: in a real deployment your bucket or CDN, here the `bundles/` directory. The registry never stores code. It fetches it from here and serves it to browsers.                    |
| `seed`     | What a platform team publishes first: `acme`'s layout and two pages, and `acme/portal`, the application that composes them. It runs once and exits. It signs in as a service account, as a pipeline would. |

The registry and Keycloak listen on `127.0.0.1` only. Their passwords and secrets are in this
repository, so nothing else on your network should reach them.

## Walk through it

### 1. Look at the portal

Open <http://localhost:7150/a/acme/portal>. The registry composed the page from three packages:
`acme/layout`, the frame and navigation, and two pages, `acme/home` and `acme/orders`. Home lists
each one and the version it runs.

### 2. Sign in as alice

In a terminal, from this directory:

```sh
source ./env.sh
cd remotes
npm ci
npx appshell config init --registry http://localhost:7150 \
  --auth-issuer http://localhost:8080/realms/appshell \
  --default-scope alice --application alice/portal
npx appshell login
npx appshell scopes create alice
```

- **`env.sh`** gives the CLI a config and credentials of their own, in `.appshell/` here, so this
  demo never touches `~/.appshell`. Source it in each terminal you use.
- **`login`** prints a link. Open it, and sign in as `alice` / `alice`.
- **`scopes create`** claims `alice`, the namespace alice publishes into.

### 3. Copy the portal into your scope

```sh
npx appshell app clone --from acme/portal --to alice/portal --allow-overlays
```

`acme` belongs to the seed's account, so alice can't change `acme/portal`:

```sh
npx appshell app rollback acme/portal --to 1
# 403 You may not write to scope 'acme'.
```

Her copy, `alice/portal`, is hers. It also allows overlays, which step 4 needs.

### 4. Develop a page in it

```sh
npm start -w hello
```

The dev server opens an overlay on `alice/portal` and prints a link to confirm it. Open the link,
apply the overlay, then open <http://localhost:7150/a/alice/portal/hello>. Hello is in the
navigation, served from your machine. Edit `remotes/hello/src/Hello.tsx` and save, and the page
updates in place.

The overlay applies to your browser only. Open the same address in a private window, and the
portal is there without Hello.

### 5. Publish it

Stop the dev server with `Ctrl-C`, then:

```sh
npm run build -w hello
mkdir -p ../bundles/alice/hello/0.1.0
cp -R hello/dist/. ../bundles/alice/hello/0.1.0/
(cd hello && npx appshell publish --template dist/appshell.template.json)
npx appshell app activate alice/hello@0.1.0
```

- **The copy is your deployment.** Your pipeline would put the build in your bucket or CDN. The
  registry fetches it from there at `{scope}/{name}/{version}/`, as `ARTIFACT_BASE_URL` in
  `compose.yaml` says.
- **`publish` sends only the manifest:** what the package exposes, and its metadata. Publishing
  runs nothing.
- **`activate` is what puts it in the application.** Open `alice/portal` in the private window
  again: Hello is there for everyone now.

### 6. Keep code private

Hello is private: a package is, unless its `appshell.config.yaml` says otherwise. Ask for its code
without the application:

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:7150/p/alice/hello/0.1.0/remoteEntry.js
# 404
```

The page still loads it. When the registry served `alice/portal`, it gave the browser a signed
cookie naming that application. A private package's code goes to a browser holding one for an
application that runs it, and to whoever may write into its scope. Anyone else gets a 404, the
same answer as for a package that doesn't exist, so the refusal doesn't confirm that it does.

Private decides who may **use** a package, not who may **read** its code: anyone who can open an
application can read the code it runs.

### 7. Roll back

```sh
npx appshell app revisions
npx appshell app rollback --to 1
```

Every change to an application is a revision, and a rollback is one more. Reload the portal, and
Hello is gone.

### 8. Sign in as bob

```sh
npx appshell login
npx appshell app activate alice/hello@0.1.0
# 403 This action requires the 'appshell-publisher' role, which this token does not carry.
```

Sign in as `bob` / `bob`. Bob can open every application here, but can't publish or change one: he
doesn't hold the realm's `appshell-publisher` role. Run `npx appshell login` again as alice to carry
on.

## How it fits together

- **The registry never stores code.** It proxies `/p/<scope>/<name>/<version>/*` from
  `ARTIFACT_BASE_URL`, server-side, so browsers only ever talk to the application's own origin.
- **Published files are cached for good.** The address names the version, and a published version
  never changes, so the registry serves public code `immutable`. Private code is `no-store`.
- **The registry checks every token itself** (`AUTH_MODE=oidc`). Tokens name the issuer your
  browser and the CLI use, `http://localhost:8080/realms/appshell`. The registry reaches it inside
  the Compose network through `AUTH_DISCOVERY_URL`, so nothing edits `/etc/hosts`.
- **The theme comes from the application,** as `--appshell-*` CSS custom properties. Each page's
  CSS uses them, so the pages look alike without sharing a stylesheet.

## Without signing in

For a first look with nobody signed in, start clean in `AUTH_MODE=none`:

```sh
docker compose down -v
AUTH_MODE=none docker compose up --wait
```

Every request then runs as one principal. Scopes and private packages have nothing to show, and
the registry logs a warning never to run it this way in production. Ownership doesn't carry
between modes, so start clean (`down -v`) when you switch.

## Your own identity provider

The registry verifies tokens from any OpenID Connect provider: set `AUTH_ISSUER`, and
`AUTH_AUDIENCE` to the audience its tokens carry.

- **Roles:** the registry reads them from Keycloak's `realm_access.roles` claim. Another provider's
  tokens need that claim to carry `appshell-publisher`. Support for Entra ID's and Okta's own role
  claims is coming.
- **The CLI's sign-in** uses the device grant with PKCE, on a public client named `appshell-cli`.
  Name another with `appshell config init --client-id`.

## Another registry image

```sh
REGISTRY_IMAGE=<image> docker compose up --wait
```

## Stopping and starting over

- **`docker compose down`** stops everything. MongoDB keeps its data. Keycloak imports its realm
  again on the next `up`, with the same accounts, so everything they own stays theirs.
- **To start over:**

  ```sh
  docker compose down -v
  rm -rf bundles/acme bundles/alice .appshell
  ```

## Troubleshooting

- **On a network that inspects HTTPS,** Node won't trust the certificate authority your network
  re-signs traffic with until it's told to use your system's certificates. Run
  `export NODE_USE_SYSTEM_CA=1` before `npm ci`. The seed's image runs `npm ci` too, when
  `docker compose up` first builds it, inside a container that doesn't trust your system's
  certificates. If that build fails with a certificate error, this is why: build it once on a
  network that doesn't inspect HTTPS.
- **`seed` exited with an error:** `docker compose logs seed` says why.
  `docker compose run --rm seed` runs it again.
- **A port is taken:** stop what holds 7150 or 8080. The dev servers use 7410–7413.

## License

[Apache-2.0](LICENSE)
