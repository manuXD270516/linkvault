import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { powershellPath } from './listeners';

/**
 * Lanzamiento para `--keep-stack` en Windows: la pila tiene que **sobrevivir al runner**.
 *
 * Medido el 2026-09-27: libuv mete a cada hijo no separado en un job que lo mata cuando termina el proceso de Node, así
 * que un `spawn` normal muere con el runner; y un `spawn` con `detached: true` no tiene consola, de modo que los
 * procesos que `nx` lanza después abren **ventanas de consola visibles** en el escritorio. Aquí se crea el proceso con
 * `CreateNoWindow` (una consola sin ventana que heredan sus descendientes) desde PowerShell, fuera del job del runner,
 * con **exactamente** el entorno indicado (sin el `PSModulePath` que PowerShell añade al suyo). El proceso raíz es un
 * `cmd.exe` que redirige la salida al log; `taskkill /T` sobre su PID termina el árbol entero.
 */
// El PID (o el error) se escribe en un fichero, no en la salida estándar: el proceso creado hereda los handles de
// PowerShell, y una tubería hacia el runner seguiría abierta mientras viva la pila (medido: el runner se quedaba
// esperando). Por eso PowerShell se lanza con la entrada y la salida a `ignore`.
const LAUNCHER = `param([string]$EnvFile, [string]$Arguments, [string]$WorkDir, [string]$PidFile)
try {
  $envMap = Get-Content -Raw -LiteralPath $EnvFile | ConvertFrom-Json
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = Join-Path $env:SystemRoot 'System32\\cmd.exe'
  $psi.Arguments = $Arguments
  $psi.WorkingDirectory = $WorkDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables.Clear()
  foreach ($entry in $envMap.PSObject.Properties) { $psi.EnvironmentVariables[$entry.Name] = [string]$entry.Value }
  $process = [System.Diagnostics.Process]::Start($psi)
  Set-Content -LiteralPath $PidFile -Value $process.Id -NoNewline
} catch {
  Set-Content -LiteralPath $PidFile -Value ('ERROR ' + $_.Exception.Message) -NoNewline
}
`;

function quote(value: string): string {
  if (value.includes('"')) {
    throw new Error(`cannot quote a value with double quotes for cmd.exe: ${value}`);
  }
  return `"${value}"`;
}

/** Lanza `executable args…` con la salida a `logPath`, oculto y fuera del job del runner. Devuelve el PID raíz (`cmd.exe`). */
export async function launchHiddenWindows(options: {
  readonly name: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly env: Record<string, string>;
  readonly cwd: string;
  readonly logPath: string;
  readonly workDir: string;
}): Promise<number> {
  const envFile = join(options.workDir, `launch-${options.name}.env.json`);
  const pidFile = join(options.workDir, `launch-${options.name}.pid`);
  const scriptFile = join(options.workDir, 'launch-hidden.ps1');
  writeFileSync(envFile, JSON.stringify(options.env));
  writeFileSync(scriptFile, LAUNCHER);
  rmSync(pidFile, { force: true });
  const command = [options.executable, ...options.args].map(quote).join(' ');
  // `cmd.exe` añade `PROMPT` a su entorno y los hijos lo heredarían: se quita antes de lanzar (medido en la 2.4c).
  const cmdArguments = `/d /s /c "set "PROMPT=" && ${command} > ${quote(options.logPath)} 2>&1"`;
  try {
    const code = await new Promise<number>((resolve) => {
      const child = spawn(
        powershellPath(options.env),
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptFile,
          envFile,
          cmdArguments,
          options.cwd,
          pidFile,
        ],
        { cwd: options.cwd, env: options.env, stdio: 'ignore', windowsHide: true },
      );
      child.once('exit', (exitCode) => resolve(exitCode ?? -1));
      child.once('error', () => resolve(-1));
    });
    const written = existsSync(pidFile) ? readFileSync(pidFile, 'utf8').trim() : '';
    const pid = Number(written);
    if (code !== 0 || !Number.isInteger(pid) || pid <= 0) {
      throw new Error(`hidden launch of ${options.name} failed (exit ${code}): ${written || 'no PID written'}`);
    }
    return pid;
  } finally {
    rmSync(envFile, { force: true });
    rmSync(pidFile, { force: true });
  }
}

/** `true` mientras el proceso exista (señal 0: solo comprueba). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
