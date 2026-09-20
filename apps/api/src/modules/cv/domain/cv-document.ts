import type {
  CvExtractionFailureReason,
  CvExtractionStatus,
  CvFileType,
} from '@linkvault/shared';

// Entidad del CV guardado (D3 y D4 de cv-upload-extract, ADR-028 §3 y §4). Aquí no hay framework ni base de datos: solo
// lo que un CV es y las dos reglas que nadie puede saltarse, que son las de `version` e `isDefault`.
//
// Lo que el dominio **no** conoce: `fileKey` (un detalle del adaptador del almacén), `extractedText` y la marca de
// texto recortado (los escribe el worker y nunca salen por HTTP salvo la vista previa). Si un día apareciesen aquí,
// aparecerían también en cualquier mapeo descuidado.

/** Estado de la lectura tal y como lo guarda y lo enseña la API. */
export interface CvExtractionState {
  readonly status: CvExtractionStatus;
  readonly failureReason?: CvExtractionFailureReason;
  readonly textChars: number;
  readonly extractedAt?: Date;
}

/** Un CV guardado de una persona. */
export interface CvDocumentEntity {
  readonly id: string;
  readonly userId: string;
  /** Saneado al entrar (`safeCvFileName`): es lo que su dueña ve para reconocerlo. */
  readonly fileName: string;
  readonly fileType: CvFileType;
  readonly sizeBytes: number;
  /** Correlativo por persona y **nunca reutilizado**: borrar la 3 deja 1, 2, 4. */
  readonly version: number;
  /** Como mucho uno por persona; lo garantiza un índice único parcial, no una consulta previa. */
  readonly isDefault: boolean;
  readonly uploadedAt: Date;
  readonly extraction: CvExtractionState;
}

/** Estado con el que nace un CV: todavía no se ha leído nada de él. */
export const PENDING_EXTRACTION: CvExtractionState = {
  status: 'pending',
  textChars: 0,
};

/**
 * Número de la próxima subida: uno más que el mayor usado, **aunque ese ya no exista**. El máximo se recalcula dentro
 * de la transacción y lo protege el índice único `(userId, version)`; si dos subidas piden el mismo número, una choca
 * y su transacción se reintenta con el máximo actual.
 *
 * No reutilizar los huecos es lo que hace que "la v4" quiera decir lo mismo para siempre.
 */
export function nextVersion(versions: readonly number[]): number {
  return versions.reduce((max, version) => Math.max(max, version), 0) + 1;
}

/**
 * Cuál de los que quedan pasa a ser el marcado tras borrar el que lo era: **el más reciente**, o `undefined` si no
 * queda ninguno. Dejar a una persona con tres CV y ninguno marcado sería un estado que solo sirve para que el análisis
 * falle más tarde y en otro sitio.
 *
 * Empate en `uploadedAt` —dos subidas del mismo milisegundo— se rompe por `version`, que es estrictamente creciente:
 * así la promoción es determinista y no depende del orden en que lleguen los documentos.
 */
export function promotedAfterRemoval(
  remaining: readonly CvDocumentEntity[],
): CvDocumentEntity | undefined {
  return remaining.reduce<CvDocumentEntity | undefined>(
    (best, candidate) => (best === undefined || isNewer(candidate, best) ? candidate : best),
    undefined,
  );
}

function isNewer(
  candidate: CvDocumentEntity,
  best: CvDocumentEntity,
): boolean {
  const difference = candidate.uploadedAt.getTime() - best.uploadedAt.getTime();
  return difference === 0 ? candidate.version > best.version : difference > 0;
}
