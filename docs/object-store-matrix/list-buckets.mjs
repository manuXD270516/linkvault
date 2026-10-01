// Lista los buckets de un almacén por la API S3 (tarea 2.11 de `object-store`; la usan la 4.3 —el healthcheck no crea
// buckets— y la 7.1 —desde volúmenes vacíos, el `up` no deja ningún bucket—). Solo lee: un `ListBuckets` firmado.
//
// Uso, desde la raíz del repositorio (resuelve `@aws-sdk/client-s3` de su `node_modules`), con las `S3_*` del almacén
// en el entorno:
//
//   node docs/object-store-matrix/list-buckets.mjs
//
// Salida: `buckets (N):` y un nombre por línea. Códigos: 0 listado hecho (aunque esté vacío); 1 el almacén respondió
// con un error o no respondió; 2 faltan variables. Nunca imprime las credenciales.

import { ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';

const REQUIRED = ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'];
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  process.stderr.write(`list-buckets: missing ${missing.join(', ')}\n`);
  process.exit(2);
}

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
  maxAttempts: 1,
});

try {
  const response = await client.send(new ListBucketsCommand({}));
  const names = (response.Buckets ?? []).map((bucket) => bucket.Name ?? '(sin nombre)').sort();
  process.stdout.write(`buckets (${names.length}):\n`);
  for (const name of names) {
    process.stdout.write(`${name}\n`);
  }
  process.exitCode = 0;
} catch (error) {
  // Solo el nombre y el estado HTTP: el mensaje no aporta y no se arriesga a repetir nada de la petición.
  const name = error instanceof Error ? error.name : 'UnknownError';
  const status = error?.$metadata?.httpStatusCode ?? 'sin respuesta';
  process.stderr.write(`list-buckets: failed (${name}, HTTP ${status})\n`);
  process.exitCode = 1;
} finally {
  client.destroy();
}
