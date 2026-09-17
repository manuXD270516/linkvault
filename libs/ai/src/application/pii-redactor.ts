// Redacción de datos personales para proveedores externos (D11 de ai-gateway-core, ADR-018 §11 y §13,
// specs/ai/data-protection). Detectores, en este orden: email, URL, teléfono y nombre opcional.
// Cada valor distinto recibe un marcador estable por tipo (`[EMAIL_1]`, `[URL_1]`…). El mapa marcador→valor vive solo
// en el cierre de una redacción: el redactor no guarda estado y el objeto devuelto no lo expone.

export type PiiKind = 'EMAIL' | 'URL' | 'PHONE' | 'NAME';

export interface RedactionOptions {
  redactName?: boolean;
  personName?: string;
}

export interface Redaction<T> {
  /** Copia del input con los strings redactados; las claves de objeto no se tocan. */
  readonly value: T;
  /**
   * Copia de `output` con los marcadores de esta redacción sustituidos por sus valores en cualquier string, a
   * cualquier profundidad. Los marcadores desconocidos se dejan tal cual.
   */
  reinject<O>(output: O): O;
}

/** Asigna marcadores estables por valor dentro de una única redacción y recuerda su valor para reinyectarlo. */
class MarkerTable {
  private readonly markerByIdentity = new Map<string, string>();
  private readonly valueByMarker = new Map<string, string>();
  private readonly counters = new Map<PiiKind, number>();

  /** `identity` agrupa variantes del mismo valor (p. ej. el nombre sin distinguir mayúsculas); por defecto, el valor. */
  markerFor(kind: PiiKind, value: string, identity: string = value): string {
    const key = `${kind}:${identity}`;
    const existing = this.markerByIdentity.get(key);
    if (existing !== undefined) return existing;
    const next = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, next);
    const marker = `[${kind}_${next}]`;
    this.markerByIdentity.set(key, marker);
    this.valueByMarker.set(marker, value);
    return marker;
  }

  valueOf(marker: string): string | undefined {
    return this.valueByMarker.get(marker);
  }
}

const MARKER_PATTERN = /\[(?:EMAIL|URL|PHONE|NAME)_\d+\]/g;

type Detector = (text: string, markers: MarkerTable) => string;

const EMAIL_PATTERN =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/**
 * URLs con esquema http(s) o perfiles sin esquema (`linkedin.com/in/…`, `github.com/…`, con `www.` o subdominio de
 * país opcional). Una sola expresión para numerar por orden de aparición.
 */
const URL_PATTERN =
  /\bhttps?:\/\/[^\s<>"'`]+|(?<![\w.@/-])(?:(?:www|[a-z]{2})\.)?(?:linkedin\.com\/in\/|github\.com\/)[^\s<>"'`]+/gi;

/** Puntuación final que acompaña a una URL en prosa y no forma parte de ella. */
const TRAILING_PUNCTUATION = /[.,;:!?'"]$/;

const detectEmails: Detector = (text, markers) =>
  text.replace(EMAIL_PATTERN, (email) => markers.markerFor('EMAIL', email));

const detectUrls: Detector = (text, markers) =>
  text.replace(URL_PATTERN, (match) => markUrl(match, markers));

function markUrl(match: string, markers: MarkerTable): string {
  const url = trimUrl(match);
  return markers.markerFor('URL', url) + match.slice(url.length);
}

function trimUrl(candidate: string): string {
  let url = candidate;
  for (;;) {
    if (TRAILING_PUNCTUATION.test(url)) {
      url = url.slice(0, -1);
    } else if (hasUnbalancedClosing(url)) {
      url = url.slice(0, -1);
    } else {
      return url;
    }
  }
}

function hasUnbalancedClosing(url: string): boolean {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const last = url.at(-1);
  if (last === undefined) return false;
  const opening = pairs[last];
  if (opening === undefined) return false;
  return count(url, last) > count(url, opening);
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

// `\p{Zs}`: separadores de espacio Unicode (espacio normal y no separable, entre otros), sin saltos de línea.

/**
 * Móvil boliviano: 8 dígitos que empiezan por 6 o 7, opcionalmente con prefijo `591`, `+591` o `(+591)`. No forma
 * parte de un número o palabra más largos.
 */
const BO_MOBILE_PATTERN =
  /(?<![\p{L}\p{N}+])(?:\(?\+?591\)?[\p{Zs}.-]?)?[67]\d{7}(?![\p{L}\p{N}])/gu;

/** Candidato a número internacional: `+`, dígitos, y separadores (espacio, punto, guion, paréntesis) entre ellos. */
const INTERNATIONAL_CANDIDATE_PATTERN =
  /(?<![\p{L}\p{N}])\+\(?\d[\d\p{Zs}.()-]*\d/gu;

const INTERNATIONAL_MIN_DIGITS = 7;
const INTERNATIONAL_MAX_DIGITS = 14;

const detectBolivianMobiles: Detector = (text, markers) =>
  text.replace(BO_MOBILE_PATTERN, (phone) => markers.markerFor('PHONE', phone));

/**
 * `+` seguido de 7 a 14 dígitos con separadores. Si el candidato tiene más de 14 dígitos (p. ej. dos números
 * seguidos) se redacta el mayor prefijo de grupos completos que quepa; el resto sigue disponible para otros detectores.
 */
const detectInternationalNumbers: Detector = (text, markers) =>
  text.replace(INTERNATIONAL_CANDIDATE_PATTERN, (candidate) => {
    const end = internationalNumberEnd(candidate);
    if (end === -1) return candidate;
    const phone = candidate.slice(0, end);
    return markers.markerFor('PHONE', phone) + candidate.slice(end);
  });

/** Longitud del mayor prefijo de grupos de dígitos completos con 7 a 14 dígitos; -1 si no existe. */
function internationalNumberEnd(candidate: string): number {
  let digits = 0;
  let end = -1;
  for (const group of candidate.matchAll(/\d+/g)) {
    digits += group[0].length;
    if (digits > INTERNATIONAL_MAX_DIGITS) break;
    if (digits >= INTERNATIONAL_MIN_DIGITS) end = group.index + group[0].length;
  }
  return end;
}

/** Secuencia máxima de grupos de dígitos separados por un único espacio, guion o punto. */
const DIGIT_RUN_PATTERN = /(?<![\p{L}\p{N}+])\d+(?:[\p{Zs}.-]\d+)*/gu;

const LOCAL_MIN_DIGITS = 8;
const LOCAL_MAX_DIGITS = 11;
const LOCAL_MIN_GROUPS = 2;
const LOCAL_MAX_GROUPS = 4;
const YEAR_GROUP = /^(?:19|20)\d{2}$/;

/**
 * Números locales LatAm: 8 a 11 dígitos en 2 a 4 grupos separados por espacio, guion o punto (`11 1234-5678`,
 * `55 1234 5678`, `9 1234 5678`). Dentro de una secuencia más larga se redacta, desde cada grupo, la ventana más
 * larga que cumpla; una ventana formada solo por años (`2019 2020`) no es un teléfono.
 */
const detectLocalNumbers: Detector = (text, markers) =>
  text.replace(DIGIT_RUN_PATTERN, (run) => redactLocalWindows(run, markers));

function redactLocalWindows(run: string, markers: MarkerTable): string {
  const groups = [...run.matchAll(/\d+/g)].map((group) => ({
    digits: group[0],
    start: group.index,
    end: group.index + group[0].length,
  }));
  let result = '';
  let copiedUntil = 0;
  let first = 0;

  while (first < groups.length) {
    const last = longestLocalWindow(groups, first);
    const firstGroup = groups[first];
    const lastGroup = last === -1 ? undefined : groups[last];
    if (firstGroup === undefined || lastGroup === undefined) {
      first++;
      continue;
    }
    const phone = run.slice(firstGroup.start, lastGroup.end);
    result +=
      run.slice(copiedUntil, firstGroup.start) +
      markers.markerFor('PHONE', phone);
    copiedUntil = lastGroup.end;
    first = last + 1;
  }
  return result + run.slice(copiedUntil);
}

/** Índice del último grupo de la ventana más larga que empieza en `first` y parece un teléfono local; -1 si no hay. */
function longestLocalWindow(
  groups: readonly { digits: string }[],
  first: number,
): number {
  const maxLast = Math.min(first + LOCAL_MAX_GROUPS - 1, groups.length - 1);
  for (let last = maxLast; last >= first + LOCAL_MIN_GROUPS - 1; last--) {
    const window = groups.slice(first, last + 1);
    const digits = window.reduce((sum, group) => sum + group.digits.length, 0);
    const onlyYears = window.every((group) => YEAR_GROUP.test(group.digits));
    if (
      digits >= LOCAL_MIN_DIGITS &&
      digits <= LOCAL_MAX_DIGITS &&
      !onlyYears
    ) {
      return last;
    }
  }
  return -1;
}

/**
 * Valores numéricos que no son teléfonos y se enmascaran antes de detectarlos (D11), en este orden: marcadores ya
 * insertados, rangos mes.año, rangos de años, fechas, montos precedidos de moneda y años sueltos.
 */
const PHONE_EXCLUSION_PATTERNS: readonly RegExp[] = [
  MARKER_PATTERN,
  // Rangos mes.año: `03.2020 - 06.2022`, `03/2020–06/2022`.
  /(?<!\d)\d{2}[./]\d{4}\s*[-–—]\s*\d{2}[./]\d{4}(?!\d)/g,
  // Rangos de años: `2019-2023`, `2019 – 2023`.
  /(?<!\d)(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}(?!\d)/g,
  // Fechas `dd/mm/aaaa` y `aaaa-mm-dd`, también con el separador `/`, `.` o `-` repetido.
  /(?<!\d)(?:0?[1-9]|[12]\d|3[01])([/.-])(?:0?[1-9]|1[0-2])\1(?:19|20)\d{2}(?!\d)/g,
  /(?<!\d)(?:19|20)\d{2}([/.-])(?:0?[1-9]|1[0-2])\1(?:0?[1-9]|[12]\d|3[01])(?!\d)/g,
  // Montos precedidos de moneda: `Bs 8500`, `Bs. 12.500`, `USD 1,200.50`, `$ 1 500 000`.
  /(?:\b(?:Bs\.?|USD)|\$)\p{Zs}?\d+(?:[.,]\d+|\p{Zs}\d{3}(?!\d))*/giu,
  // Años sueltos: no unidos a otro grupo de dígitos por un separador de teléfono.
  /(?<![\p{N}+])(?<!\p{N}[\p{Zs}.-])(?:19|20)\d{2}(?!\p{N})(?![\p{Zs}.-]\p{N})/gu,
];

/**
 * Marcadores de posición con caracteres de uso privado: no son dígitos, letras ni separadores, así que cortan las
 * secuencias numéricas. El índice se codifica con caracteres de uso privado para no introducir dígitos.
 */
const MASK_OPEN = String.fromCharCode(0xe000);
const MASK_CLOSE = String.fromCharCode(0xe001);
const MASK_DIGIT_ZERO = 0xe010;
const MASK_TOKEN = new RegExp(
  `${MASK_OPEN}([${String.fromCharCode(MASK_DIGIT_ZERO)}-${String.fromCharCode(MASK_DIGIT_ZERO + 9)}]+)${MASK_CLOSE}`,
  'g',
);

function maskToken(index: number): string {
  const encoded = [...String(index)]
    .map((digit) => String.fromCharCode(MASK_DIGIT_ZERO + Number(digit)))
    .join('');
  return MASK_OPEN + encoded + MASK_CLOSE;
}

function decodeMaskIndex(encoded: string): number {
  return Number(
    [...encoded]
      .map((char) => String(char.charCodeAt(0) - MASK_DIGIT_ZERO))
      .join(''),
  );
}

/**
 * Aplica `detect` con las exclusiones enmascaradas y las restaura después. Si el texto ya contiene el carácter de
 * apertura de máscara no se enmascara nada: se prefiere redactar de más a restaurar mal.
 */
function withExclusionsMasked(
  text: string,
  detect: (masked: string) => string,
): string {
  if (text.includes(MASK_OPEN)) return detect(text);
  const excluded: string[] = [];
  const masked = PHONE_EXCLUSION_PATTERNS.reduce(
    (current, pattern) =>
      current.replace(pattern, (match) => {
        excluded.push(match);
        return maskToken(excluded.length - 1);
      }),
    text,
  );
  return detect(masked).replace(
    MASK_TOKEN,
    (token, encoded: string) => excluded[decodeMaskIndex(encoded)] ?? token,
  );
}

/** Teléfonos, en orden: móvil boliviano, internacional con `+` y local LatAm, con las exclusiones enmascaradas. */
const detectPhones: Detector = (text, markers) =>
  withExclusionsMasked(text, (masked) =>
    [
      detectBolivianMobiles,
      detectInternationalNumbers,
      detectLocalNumbers,
    ].reduce((current, detect) => detect(current, markers), masked),
  );

/**
 * Nombre propio, solo con `redactName: true` y un `personName` no vacío: coincidencia de palabras completas, sin
 * distinguir mayúsculas y con cualquier espacio entre las partes. Todas las variantes comparten `[NAME_1]` y se
 * reinyectan con la forma de su primera aparición.
 */
function nameDetector(options: RedactionOptions): Detector | undefined {
  const parts = options.personName?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (options.redactName !== true || parts.length === 0) return undefined;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${parts.map(escapeRegExp).join('\\s+')}(?![\\p{L}\\p{N}])`,
    'giu',
  );
  const identity = parts.join(' ').toLocaleLowerCase();
  return (text, markers) =>
    text.replace(pattern, (name) => markers.markerFor('NAME', name, identity));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BASE_DETECTORS: readonly Detector[] = [
  detectEmails,
  detectUrls,
  detectPhones,
];

/** Sin estado: cada llamada a `redact` crea su propia tabla de marcadores, accesible solo desde `reinject`. */
export class PiiRedactor {
  redact<T>(input: T, options: RedactionOptions = {}): Redaction<T> {
    const markers = new MarkerTable();
    const detectName = nameDetector(options);
    const detectors = detectName
      ? [...BASE_DETECTORS, detectName]
      : BASE_DETECTORS;
    const redactText = (text: string): string =>
      detectors.reduce((current, detect) => detect(current, markers), text);
    const reinjectText = (text: string): string =>
      text.replace(
        MARKER_PATTERN,
        (marker) => markers.valueOf(marker) ?? marker,
      );

    return {
      value: mapStrings(input, redactText),
      reinject: (output) => mapStrings(output, reinjectText),
    };
  }
}

/** Copia profunda que transforma solo los valores string de objetos planos y arrays. */
function mapStrings<T>(value: T, transform: (text: string) => string): T {
  return mapUnknown(value, transform) as T;
}

function mapUnknown(
  value: unknown,
  transform: (text: string) => string,
): unknown {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value))
    return value.map((item: unknown) => mapUnknown(item, transform));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        mapUnknown(item, transform),
      ]),
    );
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
