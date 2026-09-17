import { EXIT_CODES } from './args';
import { runEvalCommand } from './eval-command';

// Punto de entrada de `nx run ai:eval` y `ai:eval-ci` (D2 de ai-eval-harness). Se ejecuta con `node --import tsx` como
// CommonJS: sin top-level await ni `import.meta`, rutas desde `process.cwd()` y salida por `process.stdout`/`stderr`.

export {};

async function main(argv: readonly string[]): Promise<void> {
  process.exitCode = await runEvalCommand(argv, {
    env: process.env,
    cwd: process.cwd(),
    stdout: (chunk) => {
      process.stdout.write(chunk);
    },
    stderr: (chunk) => {
      process.stderr.write(chunk);
    },
    now: () => new Date(),
  });
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(
    `[ai:eval] Unexpected error: ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown'}\n`,
  );
  process.exitCode = EXIT_CODES.programming;
});
