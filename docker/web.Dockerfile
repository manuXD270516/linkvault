# Multi-stage image for apps/web (Angular 22 SPA) served by nginx with SPA fallback.
# Referrer-Policy is also set at the Traefik edge (esp. /unirse); nginx repeats it as defense in depth.
# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22.23.2

FROM node:${NODE_VERSION}-alpine AS build
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .nvmrc nx.json tsconfig.base.json ./
COPY apps ./apps
COPY libs ./libs
COPY tools ./tools

ENV NX_DAEMON=false
ENV CI=true
RUN pnpm install --frozen-lockfile
RUN pnpm nx build web --configuration=production

FROM nginx:1.27-alpine AS runner
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/dist/apps/web/browser /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1
