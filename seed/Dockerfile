# syntax=docker/dockerfile:1.7
#
# The seed: the repository's remotes, built, with the appshell CLI that publishes them. Built from
# the repository root, so it can copy remotes/ beside seed/.

FROM node:24-alpine

WORKDIR /remotes

# Manifests first, so a change to a page's code doesn't reinstall every dependency.
COPY remotes/package.json remotes/package-lock.json ./
COPY remotes/layout/package.json layout/
COPY remotes/home/package.json home/
COPY remotes/orders/package.json orders/
COPY remotes/hello/package.json hello/
RUN npm ci --no-audit --no-fund

COPY remotes/ ./
RUN npm run build -w @acme/layout -w @acme/home -w @acme/orders

COPY seed/ /seed/

# Root, because it writes into ./bundles, a directory on the host: a fixed user here would need
# the same uid as whoever cloned the repository, which on Linux it usually doesn't have. It's a
# one-off job on your machine that exits when it's done.
ENTRYPOINT ["node", "/seed/seed.mjs"]
