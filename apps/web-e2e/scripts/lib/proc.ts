import { spawn } from 'node:child_process';

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandOptions {
  readonly cwd: string;
  readonly env: Record<string, string>;
  /** Si es `true`, la salida se muestra además de capturarse (para las órdenes largas de compose). */
  readonly echo?: boolean;
}

/** Ejecuta una orden sin shell y devuelve su salida; nunca lanza por un código distinto de cero. */
export function runCommand(command: string, args: readonly string[], options: CommandOptions): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (options.echo === true) {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (options.echo === true) {
        process.stderr.write(chunk);
      }
    });
    child.on('error', (error) => {
      resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
