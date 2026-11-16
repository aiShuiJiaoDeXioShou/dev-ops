FROM node:24.15.0-bookworm-slim AS error-pages
WORKDIR /workspace
COPY design/tokens.json design/
COPY apps/web/src/shared/ui/gateway-failures.ts apps/web/src/shared/ui/
COPY apps/web/public/prototype/bots/bot-signal.svg apps/web/public/prototype/bots/
COPY deploy/gateway/error-page.html deploy/gateway/render-error-pages.mjs deploy/gateway/
RUN node deploy/gateway/render-error-pages.mjs /generated

FROM nginx:1.30-alpine
COPY --from=error-pages /generated/ /usr/share/nginx/gateway-errors/
COPY deploy/gateway/default.conf.template /etc/nginx/templates/
