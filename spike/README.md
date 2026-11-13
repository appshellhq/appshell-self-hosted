# Spike: a NiceGUI app as a micro-frontend, framed

For [appshellhq/appshell#102](https://github.com/appshellhq/appshell/issues/102), which holds the
questions and what was found. This branch never merges.

A NiceGUI app draws its UI from a Python process, so there's no bundle to federate. Here it runs
as a service beside the demo's registry, and `acme/frame`, an ordinary React remote, frames it
and speaks the host's half of a `postMessage` bridge.

## Run it

It uses ports of its own, so it runs beside a demo that's already up.

```sh
docker compose -p appshell-spike -f compose.yaml -f spike/compose.yaml up --wait --build
docker compose -p appshell-spike -f compose.yaml -f spike/compose.yaml run --rm --build seed
```

Then open <http://localhost:7250/a/acme/portal/research>. The navigation has the same app three
times, framed from each place it could be served:

| Page                  | The app's address                        | What it shows                                                    |
| --------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| Research              | `http://localhost:7260`                  | An origin of its own on the portal's site: isolated, cookies kept |
| Research, same origin | `http://localhost:7250/frames/research/` | The portal's own origin, by path: nothing to allow, no isolation |
| Research, cross-site  | `http://127.0.0.1:7260`                  | Another site: the browser withholds the app's session cookie     |

Stop it with `down -v` on the same command, and `rm -rf spike/bundles/acme`.

## Stage 2: behind a real gateway, on kind

The same app in a cluster, behind APISIX: signed in at the gateway, two replicas, and the app
gated as a private package's code is. It needs a kind cluster that already runs APISIX with its
ingress controller, a certificate for `*.local.appshell.org`, and those names resolving to it.

```sh
spike/kind/up.sh
```

It builds the images, loads them into kind, and applies `spike/kind/` to a namespace of its own,
`appshell-spike`, with its own registry and Keycloak, so nothing else in the cluster changes.
Then open <https://spike.local.appshell.org/a/acme/portal/research> and sign in as `alice` /
`alice`.

| Host                                | What answers                                                        |
| ----------------------------------- | ------------------------------------------------------------------- |
| `spike.local.appshell.org`          | The portal, and the app under `/frames/research/` in the same session |
| `spike-research.local.appshell.org` | The app on an origin of its own, with a session of its own          |
| `spike-auth.local.appshell.org`     | The namespace's Keycloak: sign-in only, never its admin console      |

The demo's accounts are public, and kind's gateway may listen beyond your machine. What they can
reach is this portal and the app's made-up data: no route carries a token to the registry.

Remove it with `kubectl --context dev delete namespace appshell-spike`.

## Props from the container

What a React remote gets as props, a framed app gets as messages. The portal's header has a
**Project** selector, which the layout hands to every page's slot as a `project` prop:

- **`acme/frame` sends a slot's props to the app** with the bridge's `init`, and again in a
  `props` message whenever they change. They cross as JSON, whole each time.
- **Python hears them with `appshell_frame.on_props`.** The app lists that project's runs, and
  shows none for a project it doesn't know: a prop is the browser's word.
- **The published `RemoteSlot` is enough.** It runs its loader again when a prop changes, and
  the remote stays mounted: the app keeps its document, its socket and its state.

## What's here

| Path                       | What it is                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `remotes/frame/`           | The wrapper remote: the iframe, and the host's half of the bridge (`src/Frame.tsx`)                    |
| `remotes/layout/`          | The demo's layout, with a project selector in its header that every page gets as a prop                 |
| `spike/research/`          | The NiceGUI app. `appshell_frame.py`, `bridge.js` and `theme.css` are what a pip package would hold     |
| `spike/edge/nginx.conf`    | A gateway's part: the portal's one address, the app under it by path, and `frame-src` added to its policy |
| `spike/compose.yaml`       | The stack, over the demo's `compose.yaml`                                                               |
| `spike/kind/`              | Stage 2: the stack on kind. `gateway.yaml` is the gateway's part: sign-in, routes, sticky sessions, the grant check |
| `spike/check/`             | What was driven in a headless browser, and how                                                          |

## The checks

They need Playwright, which this repository doesn't install:

```sh
dir=$(mktemp -d) && npm install --prefix "$dir" playwright@1.64.1 && cp spike/check/*.mjs "$dir/"
"$dir/node_modules/.bin/playwright" install chromium
(cd "$dir" && node look.mjs dark && node behave.mjs && REPO="$OLDPWD" node edges.mjs restart)
```

- **`look.mjs`** opens each page and reports what the frame ended up with, with a screenshot.
- **`behave.mjs`** drives routes, history, the socket, the session cookie, a dialog, whether the
  app's page can read the shell's, and what the sandbox has to allow.
- **`edges.mjs`** covers a pinned colour scheme, a frame sized to its content, the first paint,
  the app opened on its own, and its process restarting under an open page.

- **`gateway.mjs`** is stage 2's, against kind: who the app is told is signed in, the frame's
  own sign-in, the grant check, which replica answers, an idle socket, and a replica deleted
  under an open page. It runs `kubectl`, so start it where the cluster's context is `dev`.

- **`props.mjs`** is also against kind: what a change of project does to a React remote and to
  the framed app in each placement, a page the frame loads itself, what's on the page before the
  props arrive, and a project that isn't one.

To try another NiceGUI, build the app with it:

```sh
docker compose -p appshell-spike -f compose.yaml -f spike/compose.yaml build \
  --build-arg NICEGUI_VERSION=4.0.0 research
```
