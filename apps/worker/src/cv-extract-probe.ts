import { childLocationFor } from './modules/cv/infrastructure/isolation/child-command';
import { runCvExtractProbe } from './modules/cv/infrastructure/isolation/cv-extract-probe';

// `cv-extract-probe` (D11 de `cv-extract-isolation`, mismo patrón que `s3-probe`). Lee un PDF y un DOCX generados con el
// adaptador aislado real y mide el arranque del proceso hijo. No importa `AppModule` ni valida configuración.
//
// - Verificación del artefacto: `docker compose … run --rm --no-deps worker node cv-extract-probe.js`.
//
// Códigos de salida: 0 todo como se exige; 1 la lectura o el arranque fallaron.

runCvExtractProbe({
  ...childLocationFor(__dirname),
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
    const name = error instanceof Error ? error.name : 'UnknownError';
    process.stderr.write(`[cv-extract-probe] failed (${name})\n`);
    process.exitCode = 1;
  },
);
