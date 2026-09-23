import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { loadApiConfigOrExit } from './infrastructure/config/load-api-config';
import {
  BackfillSalaryParse,
  parseBackfillSalaryParseArgs,
} from './modules/links/application/backfill-salary-parse.cli';

// `nx run api:backfill-salary-parse -- [--limit=500] [--dry-run]`
// Paso 1 ADR-046: parse → Mongo $set. Luego: `api:backfill-search --docType=job_preview`.

async function main(): Promise<void> {
  const options = parseBackfillSalaryParseArgs(process.argv.slice(2));
  const { config, ai } = loadApiConfigOrExit(process.env);
  const context = await NestFactory.createApplicationContext(
    AppModule.register({ ...config, OUTBOX_RELAY_ENABLED: false }, ai),
    { bufferLogs: true },
  );
  try {
    const report = await context
      .get(BackfillSalaryParse, { strict: false })
      .execute(options);
    process.stdout.write(
      `[api] backfill-salary-parse: updated ${report.updated} of ${report.found} candidates\n`,
    );
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'UnknownError';
  const detail = error instanceof RangeError ? `: ${error.message}` : '';
  process.stderr.write(
    `[api] backfill-salary-parse failed (${name})${detail}\n`,
  );
  process.exit(1);
});
