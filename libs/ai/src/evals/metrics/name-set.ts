// Comparación de conjuntos de nombres por su forma normalizada (D5 de ai-eval-harness). La comparten las tareas cuyo
// `expected` es una lista de nombres —`classify-skills` y las skills de `extract-job`—, para que "TypeScript." y
// "typescript" cuenten como el mismo acierto en las dos.

/** Puntuación final que se ignora; no incluye `#` ni `+` para no confundir `C#` con `C` ni `C++` con `C`. */
const TRAILING_PUNCTUATION = /[.,;:!?…]+$/u;

/** Minúsculas, espacios colapsados y sin puntuación final. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(TRAILING_PUNCTUATION, '')
    .trim();
}

export interface NameSetComparison {
  /** Esperados que la salida no contiene, normalizados y en orden de `expected`. */
  missing: string[];
  /** De la salida que no se esperaban, normalizados y en orden de salida. */
  extra: string[];
  /** Esperados presentes en la salida / esperados; `null` si no hay esperados. */
  recall: number | null;
  /** Esperados presentes en la salida / nombres de la salida; `null` si la salida no trae ninguno. */
  precision: number | null;
}

/** Compara por nombres normalizados y sin repetidos. */
export function compareNameSets(
  expected: readonly string[],
  actual: readonly string[],
): NameSetComparison {
  const expectedNames = unique(expected.map(normalizeName));
  const actualNames = unique(actual.map(normalizeName));
  const expectedSet = new Set(expectedNames);
  const actualSet = new Set(actualNames);
  const hits = expectedNames.filter((name) => actualSet.has(name)).length;

  return {
    missing: expectedNames.filter((name) => !actualSet.has(name)),
    extra: actualNames.filter((name) => !expectedSet.has(name)),
    recall: expectedNames.length === 0 ? null : hits / expectedNames.length,
    precision: actualNames.length === 0 ? null : hits / actualNames.length,
  };
}

/** Media de los valores presentes; 0 si no hay ninguno, como el resto de métricas sobre conjuntos vacíos. */
export function meanOfDefined(values: readonly (number | null)[]): number {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return 0;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
