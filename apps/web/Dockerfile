# ADA Change Detection — React/Vite frontend, built once and served by nginx.
# nginx also proxies /api, /auth-api and /idp to the backend containers,
# replacing the Vite dev proxy so the browser stays on one origin (nginx.conf).
#
# The build context is the REPOSITORY ROOT, not this directory: the web app depends
# on the @ada/shared workspace package, which resolves only from the root
# package-lock.json. From apps/web npm goes to the registry and fails with
# `404 Not Found - GET .../@ada%2fshared`.
FROM node:22-alpine AS build

WORKDIR /repo

# Manifests before sources, so npm ci re-runs when a dependency changes rather
# than when a component does.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY libs/ts/shared/package.json libs/ts/shared/
COPY libs/ts/api-types/package.json libs/ts/api-types/
COPY apps/field/package.json apps/field/

# apps/field/ is the Expo client: in the workspace and in the lockfile, but its
# dependencies are several hundred megabytes and nothing here imports them.
RUN npm ci --workspace @ada/web --workspace @ada/shared --workspace @ada/api-types \
    --include-workspace-root

COPY libs/ts/shared libs/ts/shared
# Only tsc runs here: the generated src/*.ts are committed, so openapi-typescript
# (the `generate` script) is never needed at image build time.
COPY libs/ts/api-types/package.json libs/ts/api-types/tsconfig.json libs/ts/api-types/
COPY libs/ts/api-types/src libs/ts/api-types/src
COPY apps/web apps/web

# @ada/web imports @ada/shared and @ada/api-types as built output (dist/), so
# both libraries build first.
RUN npm run build --workspace @ada/api-types \
    && npm run build --workspace @ada/shared \
    && npm run build --workspace @ada/web

FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
