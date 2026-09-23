import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { loadApiConfigOrExit } from './infrastructure/config/load-api-config';
import {
  BackfillSearch,
  parseBackfillSearchArgs,
} from './modules/search/application/backfill-search.cli';

// `nx run api:backfill-search -- --docType=job_preview [--limit=500] [--dry-run]`
// Manual: AppContext without HTTP; enqueues SearchUpsert via outbox (ADR-040 reindex).

async function main(): Promise<void> {
  const options = parseBackfillSearchArgs(process.argv.slice(2));
  const { config, ai } = loadApiConfigOrExit(process.env);
  const context = await NestFactory.createApplicationContext(
    AppModule.register({ ...config, OUTBOX_RELAY_ENABLED: false }, ai),
    { bufferLogs: true },
  );
  try {
    const report = await context
      .get(BackfillSearch, { strict: false })
      .execute(options);
    process.stdout.write(
      `[api] backfill-search: enqueued ${report.enqueued} of ${report.found} candidates\n`,
    );
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'UnknownError';
  const detail = error instanceof RangeError ? `: ${error.message}` : '';
  process.stderr.write(`[api] backfill-search failed (${name})${detail}\n`);
  process.exit(1);
});
