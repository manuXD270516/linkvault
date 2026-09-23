import type { SalaryPeriod } from '../schemas/preview.schema';

// Parser determinista de texto salarial (ADR-046 / search-salary-text-parse).
// Sin I/O: o hay confianza alta o `null`. No inventa extremos ni convierte periodos.

/** Extractor id guardado en procedencia `auto` tras un parse exitoso. */
export const PARSE_SALARY_TEXT_EXTRACTOR = 'parse-salary-text';

/** Resultado confiable del parse: siempre trae ambos extremos (único → min=max). */
export type ParsedSalary = {
  readonly min: number;
  readonly max: number;
  readonly currency?: string;
  readonly period?: SalaryPeriod;
};

/** Palabras que anclan el texto como salario (ES/EN, sin depender de acentos). */
const SALARY_WORD =
  /\b(?:sueldo|salario|remuneraci[oó]n|salary|compensation|pay)\b/i;

/** Marcadores de periodo claros; ambiguo entre varios → null. */
const PERIOD_PATTERNS: readonly {
  readonly period: SalaryPeriod;
  readonly re: RegExp;
}[] = [
  {
    period: 'month',
    re: /(?:\/\s*mes\b|\bmensual(?:es)?\b|\bmonthly\b|\bper\s+month\b|\/\s*month\b)/i,
  },
  {
    period: 'year',
    re: /(?:\/\s*a[nñ]o\b|\banual(?:es)?\b|\byearly\b|\bper\s+year\b|\/\s*year\b|\bannually\b)/i,
  },
  {
    period: 'hour',
    re: /(?:\/\s*hora\b|\bhorari[oa]s?\b|\bhourly\b|\bper\s+hour\b|\/\s*hour\b)/i,
  },
];

/** Moneda cerca del monto: USD/$ o BOB/Bs. */
const CURRENCY_TOKEN =
  /(?:\bUSD\b|US\$|\$)|(?:\bBOB\b|\bBs\.?)/gi;

/**
 * Parsea un texto salarial libre. Devuelve extremos numéricos solo con ancla
 * (palabra salarial **o** moneda + periodo) y separadores de miles no ambiguos.
 */
export function parseSalaryText(input: string): ParsedSalary | null {
  const text = input.trim();
  if (text === '') return null;
  if (!hasSalaryAnchor(text)) return null;
  if (looksLikeExperienceYears(text)) return null;

  const currency = detectCurrency(text);
  const period = detectPeriod(text);
  const amounts = extractAmounts(text);
  if (amounts === null || amounts.length === 0) return null;

  if (amounts.length === 1) {
    const n = amounts[0];
    if (n === undefined) return null;
    return finish(n, n, currency, period);
  }

  // Rango: tomar el primer par en orden de aparición (min ≤ max; si no, invertir).
  const a = amounts[0];
  const b = amounts[1];
  if (a === undefined || b === undefined) return null;
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return finish(min, max, currency, period);
}

function finish(
  min: number,
  max: number,
  currency: string | undefined,
  period: SalaryPeriod | undefined,
): ParsedSalary {
  return {
    min,
    max,
    ...(currency !== undefined ? { currency } : {}),
    ...(period !== undefined ? { period } : {}),
  };
}

/** Ancla: palabra salarial, o (moneda **y** marcador de periodo). */
function hasSalaryAnchor(text: string): boolean {
  if (SALARY_WORD.test(text)) return true;
  const hasCurrency = CURRENCY_TOKEN.test(text);
  CURRENCY_TOKEN.lastIndex = 0;
  if (!hasCurrency) return false;
  return PERIOD_PATTERNS.some(({ re }) => {
    const hit = re.test(text);
    re.lastIndex = 0;
    return hit;
  });
}

/** "5 años de experiencia" no es sueldo aunque tenga dígitos. */
function looksLikeExperienceYears(text: string): boolean {
  return (
    /\b\d{1,2}\s*(?:a[nñ]os?|years?)\b/i.test(text) &&
    /\b(?:experiencia|experience|exp\.?)\b/i.test(text) &&
    !SALARY_WORD.test(text)
  );
}

function detectCurrency(text: string): string | undefined {
  // Preferir código explícito cerca del monto; $ solo si no hay Bs.
  if (/\bUSD\b|US\$/i.test(text)) return 'USD';
  if (/\bBOB\b|\bBs\.?/i.test(text)) return 'BOB';
  if (/\$/.test(text)) return 'USD';
  return undefined;
}

function detectPeriod(text: string): SalaryPeriod | undefined {
  const hits: SalaryPeriod[] = [];
  for (const { period, re } of PERIOD_PATTERNS) {
    if (re.test(text)) hits.push(period);
    re.lastIndex = 0;
  }
  if (hits.length === 0) return undefined;
  const unique = new Set(hits);
  if (unique.size !== 1) return undefined;
  return hits[0];
}

/**
 * Extrae montos en orden. Separadores: tabla fija — `1,000` / `1.000` miles;
 * un decimal con 1–2 dígitos; ambos separadores → el último es decimal.
 * Ambiguo → null (toda la extracción falla).
 */
function extractAmounts(text: string): number[] | null {
  // Buscar rangos explícitos primero: N - M / N–M / N a M (con moneda opcional alrededor).
  const range = text.match(
    /(\$?\s*(?:\bBs\.?\s*)?(?:\b(?:USD|BOB)\s*)?\d[\d.,]*)\s*(?:-|–|—|\ba\b)\s*(\$?\s*(?:\bBs\.?\s*)?(?:\b(?:USD|BOB)\s*)?\d[\d.,]*)/i,
  );
  if (range?.[1] !== undefined && range[2] !== undefined) {
    const left = parseAmountToken(range[1]);
    const right = parseAmountToken(range[2]);
    if (left === null || right === null) return null;
    return [left, right];
  }

  // from N to M / desde N hasta M
  const fromTo = text.match(
    /(?:from|desde)\s+(\$?\s*(?:\bBs\.?\s*)?(?:\b(?:USD|BOB)\s*)?\d[\d.,]*)\s+(?:to|hasta|a)\s+(\$?\s*(?:\bBs\.?\s*)?(?:\b(?:USD|BOB)\s*)?\d[\d.,]*)/i,
  );
  if (fromTo?.[1] !== undefined && fromTo[2] !== undefined) {
    const left = parseAmountToken(fromTo[1]);
    const right = parseAmountToken(fromTo[2]);
    if (left === null || right === null) return null;
    return [left, right];
  }

  // Monto único: primer número "grande" o con separadores de miles / tras ancla.
  const tokens = text.match(
    /(?:\$\s*|\bBs\.?\s*|\b(?:USD|BOB)\s*)?\d[\d.,]*/gi,
  );
  if (tokens === null || tokens.length === 0) return null;

  const parsed: number[] = [];
  for (const token of tokens) {
    // Ignorar tokens que son solo moneda sin dígitos (no deberían matchear).
    if (!/\d/.test(token)) continue;
    const n = parseAmountToken(token);
    if (n === null) return null;
    // Filtrar años sueltos tipo "2024" en fechas si el token es año ISO plausible
    // y no hay contexto de miles: un sueldo de 2024 es raro en LatAm sin separador;
    // preferimos rechazar solo si parece fecha completa.
    parsed.push(n);
  }
  if (parsed.length === 0) return null;
  // Un solo monto o el primero si hay ruido; si hay 2+ tokens sueltos sin rango, null
  // (ambiguo: no inventar rango).
  if (parsed.length === 1) return parsed;
  return null;
}

/**
 * Interpreta un token numérico con separadores. Devuelve null si es ambiguo.
 *
 * Reglas:
 * - Solo dígitos → entero.
 * - Un separador + exactamente 3 dígitos finales → miles (`.` o `,`).
 * - Un separador + 1–2 dígitos finales → decimal.
 * - Ambos `.` y `,`: el último es decimal, el otro miles.
 * - Más de un grupo de miles debe ser consistente (grupos de 3).
 */
export function parseAmountToken(raw: string): number | null {
  const cleaned = raw.replace(/(?:\$|\bUSD\b|\bBOB\b|\bBs\.?)/gi, '').trim();
  if (cleaned === '' || !/\d/.test(cleaned)) return null;

  const hasDot = cleaned.includes('.');
  const hasComma = cleaned.includes(',');

  if (!hasDot && !hasComma) {
    if (!/^\d+$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  if (hasDot && hasComma) {
    const lastDot = cleaned.lastIndexOf('.');
    const lastComma = cleaned.lastIndexOf(',');
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const thousandSep = decimalSep === '.' ? ',' : '.';
    return parseWithSeps(cleaned, thousandSep, decimalSep);
  }

  const sep = hasDot ? '.' : ',';
  const parts = cleaned.split(sep);
  if (parts.length === 2) {
    const frac = parts[1] ?? '';
    if (frac.length === 3 && /^\d+$/.test(frac)) {
      // Miles: 3.500 / 3,500
      const intPart = parts[0] ?? '';
      if (!/^\d+$/.test(intPart)) return null;
      const n = Number(`${intPart}${frac}`);
      return Number.isFinite(n) ? n : null;
    }
    if (frac.length >= 1 && frac.length <= 2 && /^\d+$/.test(frac)) {
      // Decimal: 3.5 / 3,50
      const intPart = parts[0] ?? '';
      if (!/^\d+$/.test(intPart)) return null;
      const n = Number(`${intPart}.${frac}`);
      return Number.isFinite(n) ? n : null;
    }
    // 4+ dígitos tras un solo separador: ambiguo
    return null;
  }

  // Varios grupos: todos salvo el primero deben tener 3 dígitos (miles).
  if (parts.length > 2) {
    const head = parts[0] ?? '';
    if (!/^\d+$/.test(head)) return null;
    for (let i = 1; i < parts.length; i += 1) {
      const g = parts[i] ?? '';
      if (!/^\d{3}$/.test(g)) return null;
    }
    const n = Number(parts.join(''));
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function parseWithSeps(
  cleaned: string,
  thousandSep: string,
  decimalSep: string,
): number | null {
  const escapedThousand = escapeRegExp(thousandSep);
  const withoutThousands = cleaned.replace(
    new RegExp(escapedThousand, 'g'),
    '',
  );
  const normalized = withoutThousands.replace(decimalSep, '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
