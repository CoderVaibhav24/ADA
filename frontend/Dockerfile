# ADA Change Detection — React/Vite frontend, built once and served by nginx.
# nginx also proxies /api, /auth-api and /idp to the backend containers,
# replacing the Vite dev proxy so the browser stays on one origin (nginx.conf).
#
# The build context is the REPOSITORY ROOT, not this directory: frontend depends
# on the @ada/shared workspace package, which resolves only from the root
# package-lock.json. From ../frontend npm goes to the registry and fails with
# `404 Not Found - GET .../@ada%2fshared`.
FROM node:22-alpine AS build

WORKDIR /repo

# Manifests before sources, so npm ci re-runs when a dependency changes rather
# than when a component does.
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY packages/shared/package.json packages/shared/
COPY app/package.json app/

# app/ is the Expo client: in the workspace and in the lockfile, but its
# dependencies are several hundred megabytes and nothing here imports them.
RUN npm ci --workspace frontend --workspace @ada/shared --include-workspace-root

COPY packages/shared packages/shared
COPY frontend frontend

# frontend imports @ada/shared as built output (dist/), so it cannot go second.
RUN npm run build --workspace @ada/shared \
    && npm run build --workspace frontend

FROM nginx:1.27-alpine

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/frontend/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
