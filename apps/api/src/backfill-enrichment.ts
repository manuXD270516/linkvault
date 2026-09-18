import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import {
  BackfillEnrichment,
  parseBackfillArgs,
} from './modules/links/application/backfill-enrichment.cli';
import { loadApiConfigOrExit } from './infrastructure/config/load-api-config';

// `nx run api:backfill-enrichment -- --limit=500 [--status=pending|failed]` (D10 de link-enrichment).
//
// Es un comando **manual**: arranca el contexto de la aplicación sin servidor HTTP, pide las lecturas por el outbox y
// se apaga. No monta ninguna cola, así que funciona con el publicador apagado: los eventos esperan en `outbox_events`
// y el relay los publica cuando vuelva.

async function main(): Promise<void> {
  const options = parseBackfillArgs(process.argv.slice(2));
  const config = loadApiConfigOrExit(process.env);
  // Sin relay: este comando escribe en el outbox, no publica. Encender la cola aquí abriría Redis para nada.
  const context = await NestFactory.createApplicationContext(
    AppModule.register({ ...config, OUTBOX_RELAY_ENABLED: false }),
    { bufferLogs: true },
  );
  try {
    const report = await context
      .get(BackfillEnrichment, { strict: false })
      .execute(options);
    process.stdout.write(
      `[api] backfill-enrichment: ${report.requested} of ${report.found} ${options.status} links asked to be read again\n`,
    );
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'UnknownError';
  const detail = error instanceof RangeError ? `: ${error.message}` : '';
  process.stderr.write(`[api] backfill-enrichment failed (${name})${detail}\n`);
  process.exit(1);
});
