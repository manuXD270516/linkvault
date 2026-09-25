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
# Production deps for the generated package.json.
#
# Por qué se borra `packageManager` del manifiesto que genera Nx (ADR-048 §1): Nx copia ahí
# `packageManager: pnpm@12.4.2` desde el package.json raíz, pero el pnpm-lock.yaml que genera a su
# lado NO lleva la entrada `packageManagerDependencies` que pnpm 12 asocia a ese campo, porque en
# pnpm 12 el propio pnpm se autogestiona como dependencia. Al instalar, pnpm quiere escribir esa
# entrada, `--frozen-lockfile` se lo prohíbe, y aborta:
#   ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE
#   × resolve package manager dependencies
#   ╰─▶ Cannot update packageManagerDependencies with "frozen-lockfile" because the lockfile is not
#       up to date
# Quien quite la línea de `node -e` vuelve exactamente a ese error y la imagen deja de construirse:
# no degrada, rompe. Es el mismo defecto que en `docker/api.Dockerfile`, no uno parecido: el campo
# sale del mismo package.json raíz y lo copia el mismo generador de Nx.
#
# El candado se conserva a propósito: `--frozen-lockfile` sigue puesto. Aflojarlo
# (`--no-frozen-lockfile`) pondría el build en verde dejando el artefacto atado a lo que el registro
# publicase el día de la construcción, que es justo lo que ADR-048 §1 descarta.
#
# `docker/web.Dockerfile` NO lleva este arreglo, y la asimetría es deliberada, no un olvido: esa
# imagen no tiene etapa de dependencias de producción (copia los estáticos ya compilados de
# `dist/apps/web/browser` a nginx), así que no ejecuta ningún `pnpm install` sobre un manifiesto
# generado por Nx y no tiene dónde aparecer el campo.
RUN node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync('package.json','utf8')); delete m.packageManager; fs.writeFileSync('package.json', JSON.stringify(m, null, 2) + '\n');"
RUN pnpm install --prod --frozen-lockfile

FROM node:${NODE_VERSION}-alpine AS runner
RUN addgroup -S linkvault && adduser -S -G linkvault linkvault
WORKDIR /app

COPY --from=build --chown=linkvault:linkvault /workspace/dist/apps/worker ./

USER linkvault
ENV NODE_ENV=production
ENV AI_PROMPTS_DIR=/app/assets/ai/prompts
EXPOSE 3001

# Liveness only in the image; compose readiness uses GET /health (platform/runtime-health).
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_HEALTH_PORT||3001)+'/health/live').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "main.js"]
