import { EXIT_CODES } from './args';
import { runExportFeedbackCommand } from './export-feedback-candidates-command';

// Punto de entrada de `nx run ai:export-feedback-candidates` (cv-suggestions-review 4.3).

export {};

async function main(argv: readonly string[]): Promise<void> {
  process.exitCode = await runExportFeedbackCommand(argv, {
    env: process.env,
    cwd: process.cwd(),
    stdout: (chunk) => {
      process.stdout.write(chunk);
    },
    stderr: (chunk) => {
      process.stderr.write(chunk);
    },
  });
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(
    `[ai:export-feedback-candidates] Unexpected error: ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown'}\n`,
  );
  process.exitCode = EXIT_CODES.programming;
});
