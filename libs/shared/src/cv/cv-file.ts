// Qué archivos admite la subida de CV y cómo se decide su tipo (D2 de cv-upload-extract, ADR-028 §2). Vive en
// `libs/shared` porque es una función pura que comparten la API —que decide con el primer trozo del stream— y sus
// tests, y porque el SPA anuncia las mismas extensiones y los mismos MIME en su `accept`.
//
// La autoridad son **los bytes y la extensión**, que tienen que apuntar al mismo tipo. El `Content-Type` de la parte
// **solo veta**: lo pone el cliente, y navegadores antiguos, aplicaciones móviles y cualquier `curl` mandan
// `application/octet-stream` para un PDF perfectamente válido. Rechazarlo sería rechazar el CV de alguien por culpa de
// su navegador.

/** Tipos admitidos, tal y como se guardan en `cv_documents.fileType`. */
export const CV_FILE_TYPE_VALUES = ['pdf', 'docx'] as const;
export type CvFileType = (typeof CV_FILE_TYPE_VALUES)[number];

/** Lo que define a cada tipo: su MIME oficial, su extensión y la firma que lleva dentro. */
export interface CvFileTypeDefinition {
  /** MIME oficial; es el único `Content-Type` "conocido" que no veta a este tipo. */
  readonly mimeType: string;
  /** Extensión del nombre, con el punto y en minúsculas. */
  readonly extension: string;
  /** Bytes que identifican el formato. */
  readonly signature: readonly number[];
}

/**
 * `%PDF-` puede aparecer tras un BOM o tras unos bytes de basura; la regla es que esté **dentro del primer kilobyte**.
 * `PK\x03\x04` identifica un ZIP y tiene que estar al principio: un DOCX es un ZIP, aunque no todo ZIP sea un DOCX
 * (residuo aceptado de D2; lo resuelve el extractor del worker con `unreadable_file`).
 */
export const CV_PDF_SIGNATURE_MAX_OFFSET = 1024;

export const CV_FILE_TYPES: Readonly<Record<CvFileType, CvFileTypeDefinition>> =
  {
    pdf: {
      mimeType: 'application/pdf',
      extension: '.pdf',
      // '%PDF-'
      signature: [0x25, 0x50, 0x44, 0x46, 0x2d],
    },
    docx: {
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: '.docx',
      // 'PK\x03\x04'
      signature: [0x50, 0x4b, 0x03, 0x04],
    },
  };

/**
 * `Content-Type` que no dice nada útil y por tanto no puede vetar nada.
 *
 * `text/plain` está en la lista porque es lo que el parser de multipart **inventa** cuando una parte llega sin su
 * cabecera `Content-Type` (es el valor por defecto de RFC 7578), y desde fuera no se distingue de un `text/plain`
 * escrito a mano. Tratarlo como veto rechazaría el DOCX de cualquiera cuyo cliente omita la cabecera, que es justo el
 * escenario "DOCX sin Content-Type útil". Lo que decide sigue siendo la pareja bytes + extensión.
 */
const NEUTRAL_CONTENT_TYPES = new Set([
  '',
  'application/octet-stream',
  'text/plain',
]);

/**
 * Tipo que dicen los bytes, o `undefined` si no son de ninguno de los dos. Mira como mucho el primer kilobyte para el
 * PDF y el principio para el ZIP, así que basta con el primer trozo del stream.
 */
export function sniffCvFileType(
  bytes: Uint8Array,
): CvFileType | undefined {
  if (startsWith(bytes, CV_FILE_TYPES.docx.signature, 0)) {
    return 'docx';
  }
  const pdf = CV_FILE_TYPES.pdf.signature;
  const last = Math.min(
    CV_PDF_SIGNATURE_MAX_OFFSET,
    bytes.length - pdf.length,
  );
  for (let offset = 0; offset <= last; offset += 1) {
    if (startsWith(bytes, pdf, offset)) {
      return 'pdf';
    }
  }
  return undefined;
}

/** Extensión en minúsculas del nombre recibido, con el punto; `undefined` si no tiene ninguna. */
function extensionOf(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) {
    return undefined;
  }
  return fileName.slice(dot).toLowerCase();
}

/** Tipo que dice la extensión, o `undefined` si no es `.pdf` ni `.docx`. */
function typeOfExtension(fileName: string): CvFileType | undefined {
  const extension = extensionOf(fileName);
  return CV_FILE_TYPE_VALUES.find(
    (type) => CV_FILE_TYPES[type].extension === extension,
  );
}

/** El `Content-Type` sin sus parámetros (`; charset=…`), recortado y en minúsculas. */
function bareContentType(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

export interface CvFileCandidate {
  /** `Content-Type` de la parte multipart, tal y como llegó. Puede faltar. */
  readonly contentType?: string;
  /** Nombre del archivo tal y como llegó, sin sanear: aquí solo se mira su extensión. */
  readonly fileName: string;
  /** Primer trozo del contenido; basta con un kilobyte. */
  readonly bytes: Uint8Array;
}

/**
 * Tipo admitido del archivo, o `undefined` si no lo es. Las dos autoridades —bytes y extensión— tienen que coincidir,
 * y el `Content-Type` veta si nombra un tipo distinto del resuelto; si va vacío, falta o es `application/octet-stream`,
 * no estorba.
 */
export function resolveCvFileType(
  candidate: CvFileCandidate,
): CvFileType | undefined {
  const sniffed = sniffCvFileType(candidate.bytes);
  if (sniffed === undefined) {
    return undefined;
  }
  if (typeOfExtension(candidate.fileName) !== sniffed) {
    return undefined;
  }
  const declared = bareContentType(candidate.contentType);
  if (
    !NEUTRAL_CONTENT_TYPES.has(declared) &&
    declared !== CV_FILE_TYPES[sniffed].mimeType
  ) {
    return undefined;
  }
  return sniffed;
}

function startsWith(
  bytes: Uint8Array,
  signature: readonly number[],
  offset: number,
): boolean {
  if (offset + signature.length > bytes.length) {
    return false;
  }
  return signature.every((byte, index) => bytes[offset + index] === byte);
}
