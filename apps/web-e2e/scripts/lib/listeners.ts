import { runCommand } from './proc';

/** Una fila de escucha de un puerto: dirección local y PID dueño (`null` si el sistema no lo muestra). */
export interface ListenerRow {
  readonly port: number;
  readonly address: string;
  readonly pid: number | null;
}

export type ListenerVerdict = { readonly ok: true } | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Decisión del guardia de PID (design D3, fase 3), como función pura: **cada** fila de escucha tiene que ser de un
 * proceso del árbol lanzado. `ownPids` es ese árbol **sin** el PID del propio runner. Falla ante cualquier fila ajena,
 * sin PID (cuenta como ajena) o del runner, y ante un puerto sin ninguna fila (no hay nada que atribuir).
 */
export function evaluateListeners(rows: readonly ListenerRow[], ownPids: ReadonlySet<number>): ListenerVerdict {
  const problems: string[] = [];
  if (rows.length === 0) {
    problems.push('no listener rows: nothing listening can be attributed to the launched processes');
  }
  for (const row of rows) {
    if (row.pid === null) {
      problems.push(`port ${row.port} (${row.address}): a listener without PID counts as foreign`);
    } else if (!ownPids.has(row.pid)) {
      problems.push(`port ${row.port} (${row.address}): PID ${row.pid} is not a process launched by this run`);
    }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

/** Filas de `Get-NetTCPConnection … | ConvertTo-Json` (un objeto o un array). */
export function parseWindowsListeners(output: string): ListenerRow[] {
  const trimmed = output.trim();
  if (trimmed === '') {
    return [];
  }
  const parsed = JSON.parse(trimmed) as unknown;
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.flatMap((row): ListenerRow[] => {
    if (typeof row !== 'object' || row === null) {
      return [];
    }
    const record = row as { LocalAddress?: unknown; LocalPort?: unknown; OwningProcess?: unknown };
    if (typeof record.LocalPort !== 'number') {
      return [];
    }
    return [
      {
        port: record.LocalPort,
        address: typeof record.LocalAddress === 'string' ? record.LocalAddress : '?',
        pid: typeof record.OwningProcess === 'number' ? record.OwningProcess : null,
      },
    ];
  });
}

/** Filas de `ss -H -ltnp`: una por proceso en `users:(…)`, o una sin PID si `ss` no lo muestra. */
export function parseSsListeners(output: string, ports: ReadonlySet<number>): ListenerRow[] {
  const rows: ListenerRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 4) {
      continue;
    }
    const local = columns[3] ?? '';
    const colon = local.lastIndexOf(':');
    const port = Number(local.slice(colon + 1));
    if (!ports.has(port)) {
      continue;
    }
    const address = local.slice(0, colon);
    const pids = [...line.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1]));
    if (pids.length === 0) {
      rows.push({ port, address, pid: null });
    } else {
      for (const pid of pids) {
        rows.push({ port, address, pid });
      }
    }
  }
  return rows;
}

/** Todas las filas de escucha TCP de esos puertos, en cualquier interfaz. */
export async function listListeners(
  ports: readonly number[],
  env: Record<string, string>,
  root: string,
): Promise<ListenerRow[]> {
  if (process.platform === 'win32') {
    const script =
      `Get-NetTCPConnection -State Listen -LocalPort ${ports.join(',')} -ErrorAction SilentlyContinue | ` +
      'Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress';
    const result = await runCommand(powershellPath(env), ['-NoProfile', '-NonInteractive', '-Command', script], {
      cwd: root,
      env,
    });
    if (result.code !== 0) {
      throw new Error(`Get-NetTCPConnection failed: ${result.stderr.trim()}`);
    }
    return parseWindowsListeners(result.stdout);
  }
  const result = await runCommand('ss', ['-H', '-ltnp'], { cwd: root, env });
  if (result.code !== 0) {
    throw new Error(`ss -H -ltnp failed: ${result.stderr.trim()}`);
  }
  return parseSsListeners(result.stdout, new Set(ports));
}

/** PowerShell de Windows por ruta absoluta: la lista blanca de D6 conserva `SystemRoot`. */
export function powershellPath(env: Record<string, string>): string {
  const systemRoot = Object.entries(env).find(([key]) => key.toLowerCase() === 'systemroot')?.[1] ?? 'C:\\Windows';
  return `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}
