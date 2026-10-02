import { normalizeCheckoutPath } from './block';
import { powershellPath } from './listeners';
import { runCommand } from './proc';

export interface ProcessInfo {
  readonly pid: number;
  readonly ppid: number;
  readonly commandLine: string;
}

/** Procesos del sistema con su padre y su línea de comando (`Get-CimInstance Win32_Process` o `ps -eo pid,ppid,args`). */
export async function listProcesses(env: Record<string, string>, root: string): Promise<ProcessInfo[]> {
  if (process.platform === 'win32') {
    const script =
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress';
    const result = await runCommand(powershellPath(env), ['-NoProfile', '-NonInteractive', '-Command', script], {
      cwd: root,
      env,
    });
    if (result.code !== 0) {
      throw new Error(`Get-CimInstance Win32_Process failed: ${result.stderr.trim()}`);
    }
    // `ConvertTo-Json` de Windows PowerShell 5.1 deja sin escapar algunos caracteres de control de las líneas de
    // comando, y `JSON.parse` los rechaza; con `-Compress` la estructura no lleva ninguno, así que se sustituyen.
    // eslint-disable-next-line no-control-regex -- se buscan justamente los caracteres de control
    const parsed = JSON.parse(result.stdout.trim().replace(/[\u0000-\u001f]/g, ' ')) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap((row): ProcessInfo[] => {
      if (typeof row !== 'object' || row === null) {
        return [];
      }
      const record = row as { ProcessId?: unknown; ParentProcessId?: unknown; CommandLine?: unknown };
      if (typeof record.ProcessId !== 'number') {
        return [];
      }
      return [
        {
          pid: record.ProcessId,
          ppid: typeof record.ParentProcessId === 'number' ? record.ParentProcessId : 0,
          commandLine: typeof record.CommandLine === 'string' ? record.CommandLine : '',
        },
      ];
    });
  }
  const result = await runCommand('ps', ['-eo', 'pid=,ppid=,args='], { cwd: root, env });
  if (result.code !== 0) {
    throw new Error(`ps failed: ${result.stderr.trim()}`);
  }
  return result.stdout.split(/\r?\n/).flatMap((line): ProcessInfo[] => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match === null) {
      return [];
    }
    return [{ pid: Number(match[1]), ppid: Number(match[2]), commandLine: match[3] ?? '' }];
  });
}

/** Los procesos raíz y todos sus descendientes. */
export function processTree(roots: readonly number[], processes: readonly ProcessInfo[]): Set<number> {
  const children = new Map<number, number[]>();
  for (const info of processes) {
    const list = children.get(info.ppid) ?? [];
    list.push(info.pid);
    children.set(info.ppid, list);
  }
  const tree = new Set<number>();
  const pending = [...roots];
  while (pending.length > 0) {
    const pid = pending.pop();
    if (pid === undefined || tree.has(pid)) {
      continue;
    }
    tree.add(pid);
    pending.push(...(children.get(pid) ?? []));
  }
  return tree;
}

/**
 * ¿Es un `serve` de `api` o `worker` **de este checkout**? (design D3, fase 1). La línea de comando tiene que contener
 * `<checkout>/node_modules/` —con el separador final, para que un worktree anidado bajo este no case— y un `serve` de
 * `api` o `worker`. Sin distinguir mayúsculas en `win32` y aceptando los dos separadores. `web` no cuenta: su servidor
 * compila en memoria.
 */
export function isSameCheckoutServe(commandLine: string, checkoutRoot: string, platform: NodeJS.Platform): boolean {
  const fold = (value: string): string => {
    const slashed = value.replace(/\\/g, '/');
    return platform === 'win32' ? slashed.toLowerCase() : slashed;
  };
  const needle = `${fold(normalizeCheckoutPath(checkoutRoot))}/node_modules/`;
  const command = fold(commandLine);
  if (!command.includes(needle)) {
    return false;
  }
  return /\bserve\s+(api|worker)\b|\b(api|worker):serve\b/i.test(command);
}

/** Termina un árbol de procesos lanzado por la corrida: `taskkill /T /F` en Windows, el grupo de procesos en Linux. */
export async function killTree(pid: number, env: Record<string, string>, root: string): Promise<void> {
  if (process.platform === 'win32') {
    await runCommand('taskkill', ['/T', '/F', '/PID', String(pid)], { cwd: root, env });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Ya no existe.
    }
  }
}
