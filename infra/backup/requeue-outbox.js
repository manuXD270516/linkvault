// Reencola el outbox tras una restauración (ADR-066, design D12 de `staging-backups`). Script de `mongosh`; se ejecuta DENTRO del
// contenedor `mongo` por la entrada estándar (lo lanza `requeue-outbox.sh`):
//
//   docker compose … exec -T -e REQUEUE_SINCE=<ISO> [-e REQUEUE_COUNT_ONLY=1] mongo mongosh --quiet --file /dev/stdin < requeue-outbox.js
//
// Redis no se respalda: un evento YA publicado cuyo job no se había consumido al volcar se perdería con Redis. El relay solo
// publica los eventos con `publishedAt: null`, así que se ponen como pendientes (`publishedAt: null`, `attempts: 0`,
// `nextAttemptAt` = ahora) los publicados desde `REQUEUE_SINCE`, SIN tocar los agotados (`failedAt` con fecha). Con
// `REQUEUE_COUNT_ONLY=1` solo cuenta, por tipo, y no cambia nada (es lo que hace el ensayo).
//
// Constantes fijas (design D12, C9): el nombre de la colección y los de los campos están aquí a propósito, y la comprobación
// `backup-outbox-contract` de `tools/repo-checks` las compara con `apps/api/src/infrastructure/outbox/outbox-event.schemas.ts`:
// renombrar un campo allí hace fallar esa comprobación hasta que se actualice este fichero.
// OUTBOX-CONTRACT-BEGIN
const OUTBOX = {
  database: 'linkvault',
  collection: 'outbox_events',
  type: 'type',
  publishedAt: 'publishedAt',
  failedAt: 'failedAt',
  attempts: 'attempts',
  nextAttemptAt: 'nextAttemptAt',
};
// OUTBOX-CONTRACT-END

const env = process.env;
if (!env.MONGO_INITDB_ROOT_USERNAME || !env.MONGO_INITDB_ROOT_PASSWORD) {
  print('requeue-outbox: faltan las credenciales raíz en el entorno de mongo');
  quit(2);
}
const since = new Date(env.REQUEUE_SINCE ?? '');
if (Number.isNaN(since.getTime())) {
  print('requeue-outbox: REQUEUE_SINCE no es una fecha ISO válida');
  quit(2);
}
const countOnly = env.REQUEUE_COUNT_ONLY === '1';

if (!db.getSiblingDB('admin').auth(env.MONGO_INITDB_ROOT_USERNAME, env.MONGO_INITDB_ROOT_PASSWORD)) {
  print('requeue-outbox: la autenticación como raíz falló');
  quit(3);
}

const events = db.getSiblingDB(OUTBOX.database).getCollection(OUTBOX.collection);
const filter = { [OUTBOX.publishedAt]: { $gte: since }, [OUTBOX.failedAt]: null };

const byType = events
  .aggregate([{ $match: filter }, { $group: { _id: '$' + OUTBOX.type, count: { $sum: 1 } } }, { $sort: { _id: 1 } }])
  .toArray();
let total = 0;
for (const row of byType) {
  total += row.count;
  print('requeue-outbox: ' + (countOnly ? 'se reencolarían' : 'reencolados') + ' ' + row._id + ' ' + row.count);
}

if (!countOnly && total > 0) {
  events.updateMany(filter, {
    $set: { [OUTBOX.publishedAt]: null, [OUTBOX.attempts]: 0, [OUTBOX.nextAttemptAt]: new Date() },
  });
}
print('requeue-outbox: total ' + total + (countOnly ? ' (solo cuenta)' : ''));
