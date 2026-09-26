// Lectura de los errores del SDK para el script `object-store` (design D4 de `object-store`). Se mira el nombre (el
// `<Code>` de S3) y el estado HTTP, nunca el mensaje: el del SDK puede llevar dentro la clave de un objeto, y la de un
// CV lleva el identificador de la persona.

interface SdkErrorShape {
  readonly name?: unknown;
  readonly Code?: unknown;
  readonly $metadata?: { readonly httpStatusCode?: unknown };
}

function shapeOf(error: unknown): SdkErrorShape {
  return typeof error === 'object' && error !== null
    ? (error as SdkErrorShape)
    : {};
}

/** `<Code>` del error (o su nombre), o `UnknownError` si no trae ninguno. */
export function errorCode(error: unknown): string {
  const shape = shapeOf(error);
  if (typeof shape.Code === 'string' && shape.Code !== '') {
    return shape.Code;
  }
  if (typeof shape.name === 'string' && shape.name !== '') {
    return shape.name;
  }
  return 'UnknownError';
}

export function httpStatus(error: unknown): number | undefined {
  const status = shapeOf(error).$metadata?.httpStatusCode;
  return typeof status === 'number' ? status : undefined;
}

/** `NoSuchBucket (HTTP 404)`: lo que se informa de un error, sin su mensaje. */
export function describeError(error: unknown): string {
  const status = httpStatus(error);
  return status === undefined
    ? errorCode(error)
    : `${errorCode(error)} (HTTP ${status})`;
}

export function hasCode(error: unknown, ...codes: readonly string[]): boolean {
  return codes.includes(errorCode(error));
}

/** El almacén no implementa esa API: `NotImplemented` o un `501`, venga o no con cuerpo XML. */
export function isNotImplemented(error: unknown): boolean {
  return hasCode(error, 'NotImplemented') || httpStatus(error) === 501;
}

/** El bucket (o el objeto) no existe: `NoSuchBucket`, `NotFound` o un `404`. */
export function isNotFound(error: unknown): boolean {
  return (
    hasCode(error, 'NoSuchBucket', 'NotFound') || httpStatus(error) === 404
  );
}
