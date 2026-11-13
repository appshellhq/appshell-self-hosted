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

## What's here

| Path                       | What it is                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `remotes/frame/`           | The wrapper remote: the iframe, and the host's half of the bridge (`src/Frame.tsx`)                    |
| `spike/research/`          | The NiceGUI app. `appshell_frame.py`, `bridge.js` and `theme.css` are what a pip package would hold     |
| `spike/edge/nginx.conf`    | A gateway's part: the portal's one address, the app under it by path, and `frame-src` added to its policy |
| `spike/compose.yaml`       | The stack, over the demo's `compose.yaml`                                                               |
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

To try another NiceGUI, build the app with it:

```sh
docker compose -p appshell-spike -f compose.yaml -f spike/compose.yaml build \
  --build-arg NICEGUI_VERSION=4.0.0 research
```
