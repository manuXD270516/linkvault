#!/usr/bin/env node
/**
 * Pausa o reanuda la cola `enrich-link` (change `enrichment-egress-guard`, design R7 y tarea 7.3a).
 *
 * Es la contingencia cuando hay que actuar sobre el filtro de salida sin revertirlo: revertir reabre el defecto, así que
 * se pausa la única cola por la que sale una descarga iniciada por una URL de usuario. La frescura reutiliza esa misma
 * cola con `triggeredBy: freshness`, de modo que pausarla detiene también las relecturas. Los links esperan `pending`
 * sin perder datos y siguen su curso al reanudar. No toca ficheros de despliegue.
 *
 * Uso (desde donde Redis sea alcanzable; la conexión sale de `REDIS_URL` y nunca se imprime):
 *
 *   REDIS_URL=redis://localhost:6379 node tools/queues/enrich-link-queue.mjs pause
 *   REDIS_URL=redis://localhost:6379 node tools/queues/enrich-link-queue.mjs resume
 *   REDIS_URL=redis://localhost:6379 node tools/queues/enrich-link-queue.mjs status
 *
 * Termina mostrando si la cola quedó pausada. `--queue=<nombre>` existe solo para ensayar la falsación (pausar otra
 * cola no detiene el enriquecimiento); el valor por defecto es `ENRICH_LINK_QUEUE` de `@linkvault/shared`.
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

/** Debe coincidir con `ENRICH_LINK_QUEUE` de `@linkvault/shared`; un test del repositorio lo comprueba. */
const ENRICH_LINK_QUEUE = 'enrich-link';

const COMMANDS = new Set(['pause', 'resume', 'status']);

function parseArguments(argv) {
  let command = null;
  let queueName = ENRICH_LINK_QUEUE;
  for (const argument of argv) {
    if (argument.startsWith('--queue=')) {
      queueName = argument.slice('--queue='.length);
    } else if (COMMANDS.has(argument)) {
      command = argument;
    }
  }
  return { command, queueName };
}

async function main() {
  const { command, queueName } = parseArguments(process.argv.slice(2));
  const redisUrl = process.env.REDIS_URL;
  if (command === null || redisUrl === undefined || redisUrl === '') {
    process.stderr.write(
      'uso: REDIS_URL=<url> node tools/queues/enrich-link-queue.mjs pause|resume|status\n',
    );
    process.exitCode = 2;
    return;
  }

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(queueName, { connection });
  try {
    if (command === 'pause') await queue.pause();
    if (command === 'resume') await queue.resume();
    const paused = await queue.isPaused();
    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'paused',
    );
    process.stdout.write(
      `${JSON.stringify({ queue: queueName, command, paused, counts })}\n`,
    );
  } finally {
    await queue.close();
    connection.disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(
    `error: ${error instanceof Error ? error.message : 'fallo desconocido'}\n`,
  );
  process.exitCode = 1;
});
