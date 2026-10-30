import {
  CV_CHILD_BOOT_TIMEOUT_MS,
  CV_ISOLATION_GRACE_MS,
} from '../../application/extraction-deadlines';

// Topes de la lectura aislada del CV (D5 de cv-extract-isolation). **Constantes del código, no variables de
// entorno**: el contrato de configuración que vigila `compose-env-contract` no cambia y un tope de seguridad no es algo
// que se quiera poder aflojar con un `.env`. Un test fija sus valores.

export { CV_CHILD_BOOT_TIMEOUT_MS, CV_ISOLATION_GRACE_MS };

const MIB = 1024 * 1024;

/** Páginas de PDF que se leen; las demás se ignoran sin fallar. */
export const CV_MAX_PDF_PAGES = 50;
/** Caracteres de texto crudo que se acumulan antes de dejar de leer y entregar lo acumulado. */
export const CV_MAX_RAW_TEXT_CHARS = 1_000_000;
/** Bytes que puede producir en total el inflado de las entradas de un DOCX. */
export const CV_DOCX_MAX_INFLATED_BYTES = 64 * MIB;
/** Entradas máximas de un DOCX. */
export const CV_DOCX_MAX_ENTRIES = 2_000;
/** Heap viejo del hijo, en MB (`--max-old-space-size`). */
export const CV_CHILD_MAX_OLD_SPACE_MB = 256;
/** Semiespacio del hijo, en MB (`--max-semi-space-size`). */
export const CV_CHILD_MAX_SEMI_SPACE_MB = 16;
/** Crecimiento de la memoria residente del hijo, sobre la que tenía en `ready`, que el vigía no tolera. */
export const CV_MEMORY_CEILING_BYTES = 512 * MIB;
/** Cada cuánto muestrea el vigía la memoria residente del hijo. */
export const CV_MEMORY_SAMPLE_MS = 100;
/** Tope del marco del canal, por línea y en total. */
export const CV_CHANNEL_MAX_BYTES = 8 * MIB;
