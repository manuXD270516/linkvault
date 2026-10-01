import { runObjectStoreCli } from './infrastructure/storage/object-store/object-store.cli';

// `object-store <provision|verify>` (design D4 de `object-store`, ADR-052 §4). Aprovisiona y comprueba el almacén de
// objetos **solo por la API S3**, sin la CLI de ningún producto. No importa `AppModule`: valida solo las `S3_*`.
//
// - Producción: `docker compose … run --rm --no-deps api node object-store.js provision` (y `verify`), tras el `up`.
// - Desarrollo: `pnpm nx run api:object-store -- provision`.
//
// Códigos de salida: 0 todo como se exige; 1 algo no quedó como se exige; 2 uso o configuración incorrectos.

runObjectStoreCli(process.argv.slice(2), {
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
    process.stderr.write(`[object-store] failed (${name})\n`);
    process.exitCode = 1;
  },
);
