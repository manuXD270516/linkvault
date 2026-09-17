// Extracción tolerante de JSON de la respuesta de un modelo (D3 de ai-gateway-core, design-v0.2 §4.3).
// 1) Si hay un bloque de código, se usa el contenido del primero. 2) Si no, el texto completo. En ambos casos se intenta
// el texto recortado y, si no parsea, el primer objeto o array JSON balanceado, respetando strings y escapes.

export type JsonExtraction =
  { ok: true; value: unknown } | { ok: false; reason: 'no_json' };

/** Primer bloque de código: etiqueta de lenguaje opcional (`json`, `jsonc`…), contenido no codicioso. */
const CODE_BLOCK = /```[\w+-]*[^\S\n]*\n?([\s\S]*?)```/;

export function extractJson(text: string): JsonExtraction {
  const block = CODE_BLOCK.exec(text);
  const candidate = block?.[1] ?? text;
  return parseCandidate(candidate);
}

function parseCandidate(candidate: string): JsonExtraction {
  const whole = tryParse(candidate.trim());
  if (whole.ok) return whole;

  for (let start = 0; start < candidate.length; start++) {
    const char = candidate[start];
    if (char !== '{' && char !== '[') continue;
    const end = balancedEnd(candidate, start);
    if (end === -1) continue;
    const parsed = tryParse(candidate.slice(start, end + 1));
    if (parsed.ok) return parsed;
  }
  return { ok: false, reason: 'no_json' };
}

/** Índice del cierre que equilibra la apertura en `start`, ignorando llaves y corchetes dentro de strings; -1 si no hay. */
function balancedEnd(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '}' || char === ']') {
      if (stack.pop() !== char) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

function tryParse(text: string): JsonExtraction {
  if (text.length === 0) return { ok: false, reason: 'no_json' };
  try {
    const value = JSON.parse(text) as unknown;
    // Solo objetos o arrays (D3): un escalar suelto no es una salida estructurada.
    return value !== null && typeof value === 'object'
      ? { ok: true, value }
      : { ok: false, reason: 'no_json' };
  } catch {
    return { ok: false, reason: 'no_json' };
  }
}
