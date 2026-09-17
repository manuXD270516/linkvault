// JSON canónico para la clave de ejecución (D4 de ai-gateway-core, ADR-018 §3).
// Claves de objeto ordenadas por unidad de código UTF-16, `undefined` omitido en objetos, `-0` como `0`, arrays en su
// orden y sin espacios. En lo demás sigue a JSON.stringify (`toJSON`, `undefined` en arrays como `null`).
// ADVERTENCIA: cambiar esta función cambia todas las claves e invalida fixtures y caché (nueva versión de clave).

export function canonicalJSON(value: unknown): string {
  const serialized = serialize(value);
  if (serialized === undefined) {
    throw new TypeError('canonicalJSON: value is not serializable');
  }
  return serialized;
}

function serialize(value: unknown): string | undefined {
  if (value !== null && typeof value === 'object' && hasToJSON(value)) {
    return serialize(value.toJSON());
  }
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case 'bigint':
      throw new TypeError('canonicalJSON: bigint is not serializable');
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
    case 'object':
      if (value === null) return 'null';
      if (Array.isArray(value)) {
        return `[${value.map((item: unknown) => serialize(item) ?? 'null').join(',')}]`;
      }
      return serializeObject(value);
  }
}

function serializeObject(value: object): string {
  const entries: string[] = [];
  for (const key of Object.keys(value).sort()) {
    const serialized = serialize((value as Record<string, unknown>)[key]);
    if (serialized !== undefined) {
      entries.push(`${JSON.stringify(key)}:${serialized}`);
    }
  }
  return `{${entries.join(',')}}`;
}

function hasToJSON(value: object): value is { toJSON(): unknown } {
  return typeof (value as { toJSON?: unknown }).toJSON === 'function';
}
