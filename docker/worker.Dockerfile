# Multi-stage image for apps/worker (NestJS standalone + BullMQ). Prompts are also copied
# into assets/ai/prompts by the worker webpack build for enrich/match/roadmap tasks.
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
RUN pnpm nx build worker --configuration=production

WORKDIR /workspace/dist/apps/worker
RUN pnpm install --prod --frozen-lockfile

FROM node:${NODE_VERSION}-alpine AS runner
RUN addgroup -S linkvault && adduser -S -G linkvault linkvault
WORKDIR /app

COPY --from=build --chown=linkvault:linkvault /workspace/dist/apps/worker ./

USER linkvault
ENV NODE_ENV=production
ENV AI_PROMPTS_DIR=/app/assets/ai/prompts
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_HEALTH_PORT||3001)+'/health/live').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "main.js"]
