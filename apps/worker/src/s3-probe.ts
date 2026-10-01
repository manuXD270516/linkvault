import { runS3Probe } from './infrastructure/storage/s3-probe';

// `s3-probe` (tarea 7.5 de `object-store`, design D4 y D15). Comprueba, con la fábrica de cliente S3 y el lector de CV
// del `worker`, que el bucket de CV existe y que una clave ausente de `.verify-probe/` se lee como `null`. No importa
// `AppModule`: valida solo las `S3_*` que usa.
//
// - Verificación del artefacto: `docker compose … run --rm --no-deps worker node s3-probe.js`, tras `object-store verify`.
//
// Códigos de salida: 0 todo como se exige; 1 algo no está como se exige; 2 configuración inválida.

runS3Probe({
  env: process.env,
  io: {
    out: (text) => {
      process.stdout.write(text);
    },
    err: (text) => {
      process.stderr.write(text);
    },
  },
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // Solo el nombre: el mensaje de un error del SDK puede llevar la clave de un objeto.
    const name = error instanceof Error ? error.name : 'UnknownError';
    process.stderr.write(`[s3-probe] failed (${name})\n`);
    process.exitCode = 1;
  },
);
