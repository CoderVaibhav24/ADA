# ADA ICMS OTA update server. One file, Node built-ins only.
FROM node:22-alpine
WORKDIR /srv
COPY server.mjs ./
USER node
ENV PORT=8020 UPDATES_DIR=/updates
EXPOSE 8020
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8020/health || exit 1
CMD ["node", "server.mjs"]
