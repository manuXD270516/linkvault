import { type CommandResult, runCommand } from './proc';

/** Lo que necesitan las órdenes de compose del runner: el proyecto propio, el fichero de entorno y el entorno de D6. */
export interface ComposeContext {
  readonly root: string;
  readonly projectName: string;
  /** Ruta relativa a `root` de `apps/web-e2e/e2e.env`. */
  readonly envFile: string;
  readonly env: Record<string, string>;
}

function composeArgs(ctx: ComposeContext, args: readonly string[]): string[] {
  return ['compose', '--project-name', ctx.projectName, '--env-file', ctx.envFile, ...args];
}

/**
 * Arranque de la infraestructura: el **único** sitio del runner que la levanta (tarea 1.2). El comando es el de
 * `platform/local-environment` («Infraestructura con un comando»), con el proyecto de compose de la suite y
 * `e2e.env` como fichero de entorno, para que compose no lea el `.env` de la raíz (design D3, fase 2).
 *
 * Mientras 35a (`object-store`) no esté en `main`, ese comando es `docker compose up -d --wait` sobre el compose con
 * MinIO. **La tarea 7.9 lo cambia** a `pnpm infra:up` (`up --wait` + `api:object-store -- provision`) pasando el
 * fichero de entorno por `COMPOSE_ENV_FILES`, al rebasar la rama sobre el `main` que contiene 35a.
 */
export function startInfra(ctx: ComposeContext): Promise<CommandResult> {
  return runCommand('docker', composeArgs(ctx, ['up', '-d', '--wait']), {
    cwd: ctx.root,
    env: ctx.env,
    echo: true,
  });
}

/** `docker compose ps` del proyecto de la suite, en JSON. */
export function composePs(ctx: ComposeContext, all: boolean): Promise<CommandResult> {
  return runCommand('docker', composeArgs(ctx, ['ps', ...(all ? ['-a'] : []), '--format', 'json']), {
    cwd: ctx.root,
    env: ctx.env,
  });
}

/** Apagado de la infraestructura del proyecto de la suite, con sus volúmenes (design D3, fase 6). */
export function stopInfra(ctx: ComposeContext): Promise<CommandResult> {
  return runCommand('docker', composeArgs(ctx, ['down', '-v', '--remove-orphans']), {
    cwd: ctx.root,
    env: ctx.env,
    echo: true,
  });
}

export interface PublishedPort {
  readonly service: string;
  readonly port: number;
}

/** Puertos publicados en el host, leídos de la salida de `docker compose ps --format json` (array o una línea por servicio). */
export function parsePublishedPorts(output: string): PublishedPort[] {
  const trimmed = output.trim();
  if (trimmed === '') {
    return [];
  }
  const rows: unknown[] = trimmed.startsWith('[')
    ? (JSON.parse(trimmed) as unknown[])
    : trimmed.split(/\r?\n/).filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as unknown);
  const result: PublishedPort[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) {
      continue;
    }
    const record = row as { Service?: unknown; Publishers?: unknown };
    const service = typeof record.Service === 'string' ? record.Service : '?';
    const publishers = Array.isArray(record.Publishers) ? record.Publishers : [];
    for (const publisher of publishers) {
      if (typeof publisher !== 'object' || publisher === null) {
        continue;
      }
      const published = (publisher as { PublishedPort?: unknown }).PublishedPort;
      if (typeof published === 'number' && published > 0) {
        result.push({ service, port: published });
      }
    }
  }
  return result;
}

/** Servicios del proyecto, leídos de la misma salida. */
export function parseServices(output: string): { service: string; state: string; health: string }[] {
  const trimmed = output.trim();
  if (trimmed === '') {
    return [];
  }
  const rows: unknown[] = trimmed.startsWith('[')
    ? (JSON.parse(trimmed) as unknown[])
    : trimmed.split(/\r?\n/).filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as unknown);
  return rows.flatMap((row) => {
    if (typeof row !== 'object' || row === null) {
      return [];
    }
    const record = row as { Service?: unknown; State?: unknown; Health?: unknown };
    return [
      {
        service: typeof record.Service === 'string' ? record.Service : '?',
        state: typeof record.State === 'string' ? record.State : '?',
        health: typeof record.Health === 'string' ? record.Health : '',
      },
    ];
  });
}
