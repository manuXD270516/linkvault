import {
  CvFileTooLarge,
  InvalidCvUpload,
} from '../domain/errors';

// Traducción de los errores de `@fastify/multipart` a errores de dominio (D2, ADR-028 §2). El plugin lanza errores con
// `code` propio, y si llegan al filtro global salen como `500 internal_error`: un archivo demasiado grande le diría a
// la persona que la avería es nuestra.
//
// **La traducción es por defecto**: cualquier `code` que empiece por `FST_` acaba en `400 validation_error` nombrando
// `file`, y encima de esa red van las filas conocidas. El defecto existe porque la lista de códigos es del plugin y
// puede crecer con una versión menor: una rama nueva no puede convertirse en un `500` por no haberla previsto.
//
// **Dónde se envuelve importa.** Como el cuerpo se lee a mano, trozo a trozo, el error de tamaño no sale de
// `request.file()`: lo lanza el bucle que consume el stream, cuando el plugin corta al superar `fileSize`. Envolver
// solo la obtención de la parte dejaría esa rama fuera y la convertiría justo en el `500` que esto existe para evitar.

/** Error del parser con su `code`, tal y como lo lanza el plugin. */
interface CodedError {
  readonly code: string;
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const code = (error as Partial<CodedError>).code;
  return typeof code === 'string' ? code : undefined;
}

/** `true` si el cuerpo de la petición no es multipart: eso no es un archivo que no admitamos, sino otra cosa. */
export function isNotMultipart(error: unknown): boolean {
  return codeOf(error) === 'FST_INVALID_MULTIPART_CONTENT_TYPE';
}

/**
 * Error de dominio equivalente, o `undefined` si el error no es del parser y debe subir tal cual (un fallo nuestro
 * sigue siendo un `500`, que es lo correcto).
 *
 * | Error del plugin | Error de dominio |
 * |---|---|
 * | `FST_REQ_FILE_TOO_LARGE` | `CvFileTooLarge` (413) |
 * | `FST_FILES_LIMIT`, `FST_PARTS_LIMIT`, `FST_FIELDS_LIMIT`, `FST_PROTO_VIOLATION` | `InvalidCvUpload('file')` (400) |
 * | cualquier otro `FST_*` | `InvalidCvUpload('file')` (400) |
 *
 * `FST_INVALID_MULTIPART_CONTENT_TYPE` **no** pasa por aquí: lo resuelve `isNotMultipart`, porque "el cuerpo de la
 * petición no es multipart" es `415 unsupported_media_type` y no "el archivo no vale".
 */
export function asCvUploadError(error: unknown): Error | undefined {
  const code = codeOf(error);
  if (code === 'FST_REQ_FILE_TOO_LARGE') {
    return new CvFileTooLarge();
  }
  if (code === PREMATURE_CLOSE) {
    return new InvalidCvUpload();
  }
  if (code === undefined || !code.startsWith('FST_')) {
    return undefined;
  }
  return new InvalidCvUpload();
}

/**
 * Lo que Node lanza cuando el stream de la parte se destruye a mitad. Llega aquí por dos caminos y los dos son un
 * `400`: el plugin destruye la parte en curso al tocar `files`, `parts` o `fields` —así que el `code` del plugin no
 * nos alcanza, solo su consecuencia—, y un cliente que corta la conexión a mitad de la subida hace lo mismo.
 *
 * Sin esta fila, "dos archivos en la misma petición" y "un campo de más" acabarían en el `500` que toda esta
 * traducción existe para evitar.
 */
const PREMATURE_CLOSE = 'ERR_STREAM_PREMATURE_CLOSE';

/**
 * Ejecuta el trabajo traduciendo los errores del parser. Envuelve **la obtención de la parte y el bucle de lectura**,
 * que es donde sale el error de tamaño.
 */
export async function translatingMultipartErrors<T>(
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const translated = asCvUploadError(error);
    if (translated === undefined) {
      throw error;
    }
    throw translated;
  }
}
