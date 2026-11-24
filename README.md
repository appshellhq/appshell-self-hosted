# appshell, self-hosted

The [appshell](https://appshell.org) registry, running on your machine. Two commands start it with
everything it needs, and publish an application composed from three micro-frontends. You can
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
docker compose run --rm seed
```

`up` starts the registry and what it needs. The seed then publishes the portal, and ends by
printing its address: <http://localhost:7150/a/acme/portal>.

## What's running

| Service    | What it is                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registry` | The appshell registry. It stores packages' manifests and applications, composes each application's page, and serves packages' code on the application's own origin.                                       |
| `mongodb`  | The registry's only store.                                                                                                                                                                                    |
| `keycloak` | Who signs in. Its `appshell` realm has **alice** (password `alice`), who may publish, and **bob** (`bob`), who may not. The admin console is at <http://localhost:8080>, as `admin` / `admin`.             |
| `bundles`  | Where packages' code lives: in a real deployment your bucket or CDN, here the `bundles/` directory. The registry never stores code. It fetches it from here and serves it to browsers.                    |
| `seed`     | What a platform team publishes first: `acme`'s layout and two pages, and `acme/portal`, the application that composes them. It runs once and exits, and running it again changes nothing. It signs in as a service account, as a pipeline would. |

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
docker compose run --rm seed
```

Every request then runs as one principal. Scopes and private packages have nothing to show, and
the registry logs a warning never to run it this way in production. Ownership doesn't carry
between modes, so start clean (`down -v`) when you switch.

## Your own identity provider

The registry works with any OpenID Connect provider; the walkthrough's Keycloak is one. The seed
signs in through the bundled Keycloak, so [start it](#start-it) and seed it first. Then, to sign in
through yours, put its settings in a `.env` file beside `compose.yaml`, which Compose reads, and
start the registry again:

```sh
docker compose up --wait
```

The seeded portal stays. `acme` belongs to the seed's account in the bundled Keycloak, so nobody
signed in through your provider can change it, as alice couldn't in step 3. Sign in through yours
and claim a scope of your own:

```sh
source ./env.sh
cd remotes
npx appshell config init --auth-issuer <your issuer> --client-id <your CLI's client> \
  --default-scope <scope> --application <scope>/portal
npx appshell login
npx appshell scopes create <scope>
```

Then carry on from [step 3](#3-copy-the-portal-into-your-scope), with your scope wherever steps 3 to 7
say `alice`: the portal you clone, the bundles directory you copy to, and the package you activate.
Skip step 8, whose alice and bob are the bundled Keycloak's accounts.

### What your provider needs

- **Access tokens that are JWTs,** signed with RSA, RSA-PSS or ECDSA keys it publishes at its
  discovery document's `jwks_uri`. The registry can't check opaque (reference) tokens.
- **An audience for the registry** in every access token, which `AUTH_AUDIENCE` names. It's also
  how the registry tells an access token from an ID token when a provider marks neither, so an ID
  token must never carry it.
- **A claim that carries the role,** or group, that may publish. `AUTH_ROLES_CLAIM` names the
  claim, and `AUTH_WRITE_ROLE` the value, matched exactly.
- **A public client for the CLI** that allows the device authorization grant. The CLI signs in as
  `appshell-cli` unless `--client-id` names another.

### Settings

| Setting               | The bundled Keycloak                    | What it is                                                                                                  |
| --------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `AUTH_ISSUER`         | `http://localhost:8080/realms/appshell` | The issuer, exactly as its tokens' `iss` says it.                                                           |
| `AUTH_DISCOVERY_URL`  | `http://keycloak:8080/realms/appshell`  | Where to reach it from inside Compose. Empty for a provider outside it, which the registry then finds at `AUTH_ISSUER`. |
| `AUTH_AUDIENCE`       | `appshell-registry`                     | The audience its access tokens carry for the registry.                                                      |
| `AUTH_ROLES_CLAIM`    | unset, which reads `realm_access.roles` | The claim that carries roles: a name, or a dotted path into nested claims. One value may be a string.      |
| `AUTH_WRITE_ROLE`     | `appshell-publisher`                    | The role that may publish. With directory groups issued as DNs, the whole DN.                              |
| `AUTH_USERNAME_CLAIM` | unset, which reads `preferred_username` | The claim that carries a username, which falls back to the subject (`sub`).                                |

### Recipes

These come from each provider's documentation; only Keycloak is tried here.

**PingFederate.** The CLI's client uses an access token manager that issues JSON Web Tokens, not
reference tokens, and signs them with the centralized signing key, so the key is in `/pf/JWKS`, the
discovery document's `jwks_uri`. Its `aud` is the registry's audience, and its attribute contract
includes the groups. Setting its Type Header Value to `at+jwt` marks its tokens as access tokens,
but the audience is enough.

```sh
AUTH_ISSUER=https://pingfederate.example.com
AUTH_DISCOVERY_URL=
AUTH_AUDIENCE=appshell-registry
AUTH_ROLES_CLAIM=groups
AUTH_WRITE_ROLE=appshell-publishers
# The claim your attribute contract maps a username to, if not preferred_username.
AUTH_USERNAME_CLAIM=uid
```

**Microsoft Entra ID.** Register the registry as an API with an app role, `appshell-publisher`,
assigned to whoever may publish, and version 2 access tokens (`requestedAccessTokenVersion: 2` in
its manifest). Register the CLI as a second app that allows public client flows and may call the
registry's API. Its access tokens are for the registry only when the CLI asks for the API's scope,
so sign in with it: `npx appshell login --scope "openid profile offline_access api://<registry's
client ID>/<scope>"`.

```sh
AUTH_ISSUER=https://login.microsoftonline.com/<tenant ID>/v2.0
AUTH_DISCOVERY_URL=
# The registry app's application (client) ID, which version 2 access tokens carry as their aud.
AUTH_AUDIENCE=<registry's client ID>
AUTH_ROLES_CLAIM=roles
AUTH_WRITE_ROLE=appshell-publisher
```

**Okta.** Use a custom authorization server, such as `default`: the org authorization server's
access tokens are for Okta's own APIs. Add a `groups` claim to its access tokens, and register the
CLI as a native app that allows the device authorization grant.

```sh
AUTH_ISSUER=https://<your Okta domain>/oauth2/default
AUTH_DISCOVERY_URL=
# The authorization server's audience.
AUTH_AUDIENCE=api://default
AUTH_ROLES_CLAIM=groups
AUTH_WRITE_ROLE=appshell-publishers
```

## Checking the images

The registry's image and the seed's are signed by the GitHub workflows that published them, with
no key to trust. [cosign](https://docs.sigstore.dev/cosign/system_config/installation/) 3 checks
each signature and which workflow made it. Run these from this directory, so they check the
versions `compose.yaml` names:

```sh
cosign verify "$(docker compose config --images | grep appshell-registry)" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github\.com/appshellhq/appshell-services/\.github/workflows/promote\.yml@refs/tags/v'

cosign verify "$(docker compose --profile seed config --images | grep self-hosted-seed)" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github\.com/appshellhq/appshell-self-hosted/\.github/workflows/release\.yml@refs/tags/v'
```

Each image also carries an SBOM and its build's provenance:

```sh
docker buildx imagetools inspect "$(docker compose config --images | grep appshell-registry)" \
  --format '{{ json .SBOM }}'
```

Use `.Provenance` for the provenance.

## Another registry image

```sh
REGISTRY_IMAGE=<image> docker compose up --wait
```

## Changing what the seed publishes

The seed runs an image this repository publishes, `ghcr.io/appshellhq/appshell-self-hosted-seed`,
built from `remotes/` and `seed/`. After you change either, build it from your copy:

```sh
docker compose build seed
docker compose run --rm seed
```

A published version never changes, so give a changed package a new version in its
`package.json`, or [start over](#stopping-and-starting-over).

## Stopping and starting over

- **`docker compose down`** stops everything. MongoDB keeps its data. Keycloak imports its realm
  again on the next `up`, with the same accounts, so everything they own stays theirs.
- **To start over:**

  ```sh
  docker compose down -v
  rm -rf bundles/acme bundles/alice .appshell
  ```

  Then [start it](#start-it) again.

## Troubleshooting

- **On a network that inspects HTTPS,** Node won't trust the certificate authority your network
  re-signs traffic with until it's told to use your system's certificates. Run
  `export NODE_USE_SYSTEM_CA=1` before `npm ci`. Building the seed's image yourself runs
  `npm ci` too, inside a container that doesn't trust your system's certificates. If that build
  fails with a certificate error, this is why: build it on a network that doesn't inspect HTTPS.
  Running the published image needs no build.
- **The seed failed:** its output says why. Run it again once that's fixed: it skips what it has
  already done. If it found a different build of a version already in `bundles/`, from changed
  code or dependencies, [start over](#stopping-and-starting-over), or give that package a new
  version.
- **A port is taken:** stop what holds 7150 or 8080. The dev servers use 7410–7413.

## License

[Apache-2.0](LICENSE)
