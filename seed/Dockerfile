# syntax=docker/dockerfile:1.7
#
# The seed: the repository's remotes, built, with the appshell CLI that publishes them. Built from
# the repository root, so it can copy remotes/ beside seed/. A v* tag publishes it for amd64 and
# arm64 (.github/workflows/release.yml), so `docker compose run seed` pulls it instead of building.
#
# Only the last stage is built per platform, and it runs nothing. The stages before it run once, on
# the builder's own platform, since what they make is JavaScript that runs on any. So a release
# needs no emulation.

# The pages the seed publishes, built.
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS remotes

WORKDIR /remotes

# Manifests first, so a change to a page's code doesn't reinstall every dependency.
COPY remotes/package.json remotes/package-lock.json ./
COPY remotes/layout/package.json layout/
COPY remotes/home/package.json home/
COPY remotes/orders/package.json orders/
COPY remotes/hello/package.json hello/
COPY remotes/frame/package.json frame/
RUN npm ci --no-audit --no-fund

# Each page as a publish reads it: its build, and the package.json naming it.
COPY remotes/ ./
RUN npm run build -w @acme/layout -w @acme/home -w @acme/orders -w @acme/frame \
  && for name in layout home orders frame; do \
       mkdir -p "/out/$name" \
       && cp -R "$name/package.json" "$name/appshell.config.yaml" "$name/dist" "/out/$name/"; \
     done

# The CLI the seed publishes with, and nothing else.
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS cli

WORKDIR /seed

COPY seed/package.json seed/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# Node and nothing else: no shell, no package manager.
FROM gcr.io/distroless/nodejs24-debian13@sha256:d1c8c1be703f1dca243457ac656e7eee7c571a7136a6e681d17c4294e6fe7a6d

COPY --from=remotes /out /remotes
COPY --from=cli /seed/node_modules /seed/node_modules
COPY seed/seed.mjs seed/portal.app.yaml /seed/

# Root, because it writes into ./bundles, a directory on the host: a fixed user here would need
# the same uid as whoever cloned the repository, which on Linux it usually doesn't have. It's a
# one-off job on your machine that exits when it's done. The image's entrypoint is node.
CMD ["/seed/seed.mjs"]
