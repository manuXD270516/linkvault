// Redacción de datos personales para proveedores externos (D11 de ai-gateway-core, ADR-018 §11 y §13,
// ADR-030 §10/§14, D8/D10 de cv-match-suggestions, specs/ai/data-protection). Detectores, en este orden:
// email, URL, documento, dirección, teléfono y nombre opcional. El documento va antes del teléfono para que un
// fragmento que cumpla ambas reglas se redacte una sola vez como `[ID_n]`. Cada valor distinto recibe un marcador
// estable por tipo. El mapa marcador→valor vive solo en el cierre de una redacción: el redactor no guarda estado y
// el objeto devuelto no expone los valores.

import {
  REDACTED_DATA_TYPE_IDS,
  type RedactedDataTypeId,
} from '@linkvault/shared';

/** `PiiKind` derivado de la lista canónica de `@linkvault/shared` (tarea 1.3 / 5.1). */
export type PiiKind = Uppercase<RedactedDataTypeId>;

/** Kinds que el redactor reconoce en marcadores; se deriva de la lista canónica. */
export const PII_KINDS: readonly PiiKind[] = REDACTED_DATA_TYPE_IDS.map(
  (id) => id.toUpperCase() as PiiKind,
);

/**
 * Kinds para los que este archivo implementa un detector. Añadir un tipo a la lista canónica sin tocar el redactor
 * debe romper el test que compara este conjunto con `PII_KINDS`.
 */
export const DETECTED_PII_KINDS = [
  'EMAIL',
  'URL',
  'PHONE',
  'ADDRESS',
  'ID',
  'NAME',
] as const satisfies readonly PiiKind[];

export interface RedactionOptions {
  redactName?: boolean;
  personName?: string;
}

export interface Redaction<T> {
  /** Copia del input con los strings redactados; las claves de objeto no se tocan. */
  readonly value: T;
  /** Marcadores emitidos en esta redacción (sin valores). */
  readonly emittedMarkers: ReadonlySet<string>;
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

  emitted(): ReadonlySet<string> {
    return new Set(this.valueByMarker.keys());
  }
}

/** Forma de marcador PII reconocida para reinyección, exclusiones y detección de inventados. */
export const MARKER_PATTERN = new RegExp(
  `\\[(?:${PII_KINDS.join('|')})_\\d+\\]`,
  'g',
);

/**
 * Marcadores con forma PII presentes en `value` que no están en `emitted`. Observable desde fuera del módulo
 * (D10 / tarea 5.16): la comprobación no depende de en qué capa se invoque.
 */
export function findInventedPiiMarkers(
  value: unknown,
  emitted: ReadonlySet<string>,
): readonly string[] {
  const invented = new Set<string>();
  visitStrings(value, (text) => {
    for (const match of text.matchAll(MARKER_PATTERN)) {
      if (!emitted.has(match[0])) invented.add(match[0]);
    }
  });
  return [...invented];
}

type Detector = (text: string, markers: MarkerTable) => string;

const EMAIL_PATTERN =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/**
 * TLD de dominios sin esquema habituales en CVs y portafolios (D11): genéricos y de país de LatAm. Un dominio con
 * `www.` o con esquema se redacta con cualquier TLD.
 */
const BARE_DOMAIN_TLDS = [
  'com', 'net', 'org', 'io', 'dev', 'app', 'me', 'co', 'ai', 'xyz',
  'bo', 'ar', 'mx', 'cl', 'pe', 'uy', 'py', 'ec', 've', 'br',
] as const;

/** Etiqueta de dominio: letras ASCII, dígitos y guiones internos. */
const DOMAIN_LABEL = String.raw`[a-z0-9](?:[a-z0-9-]*[a-z0-9])?`;
/** Puerto, ruta, query o fragmento opcionales tras el host (`\x60` es el acento grave). */
const URL_TAIL = String.raw`(?::\d{1,5})?(?:[/?#][^\s<>"'\x60]*)?`;
/** Inicio de un host: no continúa una palabra, otro host, un email ni una ruta. */
const HOST_START = String.raw`(?<![\p{L}\p{N}_.@/-])`;
/** Fin de un host: no sigue una letra, dígito, guion o `_` (así `anaperez.devs` no es `anaperez.dev`). */
const HOST_END = String.raw`(?![\p{L}\p{N}_-])`;

/**
 * Una sola expresión, para numerar por orden de aparición, con tres ramas en este orden: URL con esquema `http(s)`;
 * host que empieza por `www.` con cualquier TLD; y dominio sin esquema cuyo TLD está en `BARE_DOMAIN_TLDS`, con o sin
 * ruta (grupo `bare`: el host). Los nombres de tecnologías con punto que no acaban en esos TLD (`Node.js`,
 * `Vue.js`), las versiones (`v2.0`) y las abreviaturas (`e.g.`) no encajan en ninguna rama.
 */
const URL_PATTERN = new RegExp(
  [
    String.raw`\bhttps?://[^\s<>"'\x60]+`,
    String.raw`${HOST_START}www\.(?:${DOMAIN_LABEL}\.)+[a-z]{2,}${HOST_END}${URL_TAIL}`,
    String.raw`${HOST_START}(?<bare>(?:${DOMAIN_LABEL}\.)+(?:${BARE_DOMAIN_TLDS.join('|')}))${HOST_END}${URL_TAIL}`,
  ].join('|'),
  'giu',
);

/**
 * Nombres de tecnologías que son, letra por letra, un dominio sin esquema con TLD de `BARE_DOMAIN_TLDS`. Se comparan
 * sin distinguir mayúsculas contra el host completo escrito sin `www.` ni esquema, con o sin lo que le siga
 * (`ASP.NET/MVC`): `socket.io` y `Socket.IO` no se redactan; `anaperez.io`, `my.socket.io`, `www.socket.io` y
 * `https://socket.io` sí. Lista cerrada a propósito: un nombre técnico que falte se redacta de más (y se reinyecta en la
 * salida); una regla por contexto o por mayúsculas dejaría pasar dominios personales escritos en mayúsculas o junto a
 * términos técnicos.
 */
const TECHNOLOGY_NAMES_LIKE_DOMAINS: ReadonlySet<string> = new Set([
  'asp.net',
  'ado.net',
  'vb.net',
  'ml.net',
  'json.net',
  'rx.net',
  'akka.net',
  'socket.io',
  'hangfire.io',
]);

/**
 * TLD escrito como palabra que empieza frase: mayúscula inicial y el resto en minúsculas (`Me`, `Co`, `Dev`). Un TLD
 * en minúsculas (`Anaperez.dev es…`) o todo en mayúsculas (`ANAPEREZ.DEV es…`) no cuenta: ante la duda se redacta.
 */
const SENTENCE_START_TLD = /^\p{Lu}\p{Ll}*$/u;

/** Tras el host: un espacio y una letra, como la palabra siguiente de una frase. */
const FOLLOWED_BY_WORD = /^\p{Zs}\p{L}/u;

/** Puntuación final que acompaña a una URL en prosa y no forma parte de ella. */
const TRAILING_PUNCTUATION = /[.,;:!?'"]$/;

const detectEmails: Detector = (text, markers) =>
  text.replace(EMAIL_PATTERN, (email) => markers.markerFor('EMAIL', email));

const detectUrls: Detector = (text, markers) =>
  text.replace(
    URL_PATTERN,
    (match, ...args: unknown[]) => {
      const groups = args.at(-1) as UrlGroups;
      const source = args.at(-2) as string;
      const offset = args.at(-3) as number;
      const bare = groups.bare;
      if (bare === undefined) return markUrl(match, markers);
      const notADomain =
        TECHNOLOGY_NAMES_LIKE_DOMAINS.has(bare.toLowerCase()) ||
        isSentenceWithoutSpace(bare, match, source.slice(offset + match.length));
      return notADomain ? match : markUrl(match, markers);
    },
  );

/**
 * Fin de frase sin espacio tras el punto (`NestJS.Me encargué`, `Angular.Co mencé`), solo en la rama sin esquema ni
 * `www.` (D11): el host no lleva puerto ni ruta, su TLD tiene mayúscula inicial y le siguen un espacio y una letra.
 * `anaperez.Me` al final, seguido de `,` o de `/`, y `Anaperez.dev es mi sitio` se siguen redactando.
 */
function isSentenceWithoutSpace(
  bare: string,
  match: string,
  after: string,
): boolean {
  const tld = bare.slice(bare.lastIndexOf('.') + 1);
  return (
    match === bare &&
    SENTENCE_START_TLD.test(tld) &&
    FOLLOWED_BY_WORD.test(after)
  );
}

/** Grupo con nombre de `URL_PATTERN`; `undefined` si encajó otra rama. */
interface UrlGroups {
  bare?: string;
}

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

/**
 * Secuencia máxima de grupos de dígitos separados por un único espacio, guion o punto, con un prefijo de área opcional
 * de 2 a 4 dígitos entre paréntesis (`(011) 4123-4567`) que cuenta como su primer grupo.
 */
const DIGIT_RUN_PATTERN =
  /(?<![\p{L}\p{N}+])(?:\(\d{2,4}\)[\p{Zs}.-]?)?\d+(?:[\p{Zs}.-]\d+)*/gu;

const LOCAL_MIN_DIGITS = 8;
const LOCAL_MAX_DIGITS = 11;
const LOCAL_MIN_GROUPS = 2;
const LOCAL_MAX_GROUPS = 4;
const YEAR_GROUP = /^(?:19|20)\d{2}$/;

/**
 * Números locales LatAm: 8 a 11 dígitos en 2 a 4 grupos separados por espacio, guion o punto (`11 1234-5678`,
 * `55 1234 5678`, `9 1234 5678`, `(011) 4123-4567`, donde el prefijo entre paréntesis es un grupo más). Dentro de una secuencia más larga se redacta, desde cada grupo, la ventana más
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
  // El prefijo de área entre paréntesis es el primer grupo e incluye los paréntesis: se redacta con el número.
  const areaCode = groups[0];
  if (run.startsWith('(') && areaCode !== undefined) {
    areaCode.start = 0;
    areaCode.end = run.indexOf(')') + 1;
  }
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
  patterns: readonly RegExp[],
  detect: (masked: string) => string,
): string {
  if (text.includes(MASK_OPEN)) return detect(text);
  const excluded: string[] = [];
  const masked = patterns.reduce(
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
  withExclusionsMasked(text, PHONE_EXCLUSION_PATTERNS, (masked) =>
    [
      detectBolivianMobiles,
      detectInternationalNumbers,
      detectLocalNumbers,
    ].reduce((current, detect) => detect(current, markers), masked),
  );

// --- Documento de identidad (D8; antes del teléfono) -----------------------------------------------

const BO_DEPT_EXT = 'LP|CB|SC|OR|PT|TJ|CH|BE|PD';
/** 5–10 dígitos, con o sin puntos de millar (`4567890`, `45.678.901`). */
const ID_DIGITS = String.raw`(?:\d{1,3}(?:\.\d{3}){1,3}|\d{5,10})`;

/**
 * Rama de extensión: dígitos seguidos de extensión departamental boliviana o de guion y control alfanumérico.
 * No forma parte de una palabra o número más largos.
 */
const ID_EXTENSION_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(${ID_DIGITS})(?:\p{Zs}+(?:${BO_DEPT_EXT})|-[\p{L}\p{N}]+)(?![\p{L}\p{N}])`,
  'giu',
);

/**
 * Palabras clave de documento, las más largas primero para no cortar `cédula de identidad` en `cédula`.
 * Misma línea y a no más de 30 caracteres por delante del número.
 */
const ID_KEYWORD_PATTERN = new RegExp(
  [
    String.raw`c[eé]dula\p{Zs}+de\p{Zs}+identidad`,
    String.raw`documento\p{Zs}+de\p{Zs}+identidad`,
    String.raw`pasaporte`,
    String.raw`c[eé]dula`,
    String.raw`carnet`,
    String.raw`carn[eé]`,
    String.raw`C\.I\.`,
    String.raw`CI`,
    String.raw`DNI`,
  ].join('|'),
  'giu',
);

const ID_KEYWORD_GAP = 30;
const PASSPORT_ALNUM = /[A-Za-z0-9]{6,10}/;

const detectIds: Detector = (text, markers) =>
  withExclusionsMasked(text, [MARKER_PATTERN], (masked) => {
    const afterExtension = masked.replace(ID_EXTENSION_PATTERN, (id) =>
      markers.markerFor('ID', id),
    );
    return redactIdsByKeyword(afterExtension, markers);
  });

function redactIdsByKeyword(text: string, markers: MarkerTable): string {
  let result = '';
  let cursor = 0;

  for (const keyword of text.matchAll(ID_KEYWORD_PATTERN)) {
    const keywordStart = keyword.index;
    const keywordEnd = keywordStart + keyword[0].length;
    if (keywordStart < cursor) continue;

    const lineEnd = text.indexOf('\n', keywordEnd);
    const lineLimit = lineEnd === -1 ? text.length : lineEnd;
    const windowEnd = Math.min(keywordEnd + ID_KEYWORD_GAP, lineLimit);
    const window = text.slice(keywordEnd, windowEnd);
    const number = idNumberAfterKeyword(window, keyword[0]);
    if (number === undefined) continue;

    const numberStart = keywordEnd + number.offset;
    const numberEnd = numberStart + number.value.length;
    result += text.slice(cursor, numberStart) + markers.markerFor('ID', number.value);
    cursor = numberEnd;
  }

  return result + text.slice(cursor);
}

/** Número (o pasaporte alfanumérico) tras la palabra clave, con `:` y espacios opcionales. */
function idNumberAfterKeyword(
  window: string,
  keyword: string,
): { value: string; offset: number } | undefined {
  const prefix = window.match(/^[^\S\n]*:?[^\S\n]*/);
  const offset = prefix?.[0].length ?? 0;
  const rest = window.slice(offset);
  const digits = rest.match(new RegExp(String.raw`^${ID_DIGITS}`));
  if (digits) return { value: digits[0], offset };

  if (/^pasaporte$/iu.test(keyword.trim())) {
    const alnum = rest.match(PASSPORT_ALNUM);
    if (alnum && alnum.index === 0) return { value: alnum[0], offset };
  }
  return undefined;
}

// --- Dirección postal (D8) -------------------------------------------------------------------------

/** Separadores fuertes que cortan el fragmento de dirección (no el fin de línea). */
const ADDRESS_STRONG_SEP = /[|·—–\t]/;

/** Precedido de inicio de línea o separador (espacio, coma, `;`, `:`, tab, separador fuerte). */
function isAddressBoundaryBefore(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text[index - 1];
  return prev !== undefined && /[\s,;:\t|·—–]/.test(prev);
}

/** Tras el indicador: separador, no letra ni símbolo pegado (`C/` exige espacio; `C/C++` no cuenta). */
function isAddressBoundaryAfter(text: string, index: number): boolean {
  const next = text[index];
  return next !== undefined && /[\s,;:\t|·—–]/.test(next);
}

interface AddressIndicator {
  readonly pattern: RegExp;
  readonly numeric: boolean;
}

/** Indicadores de vía (dígito en cualquier punto del fragmento). El punto de abreviatura es opcional. */
const STREET_INDICATORS: readonly AddressIndicator[] = [
  { pattern: /Calle/iu, numeric: false },
  { pattern: /C\//iu, numeric: false },
  { pattern: /Avenida/iu, numeric: false },
  { pattern: /Av\.?/iu, numeric: false },
  { pattern: /Pasaje/iu, numeric: false },
  { pattern: /Psje\.?/iu, numeric: false },
  { pattern: /Camino/iu, numeric: false },
  { pattern: /Carretera/iu, numeric: false },
  { pattern: /Urbanizaci[oó]n/iu, numeric: false },
  { pattern: /Condominio/iu, numeric: false },
  { pattern: /Edificio/iu, numeric: false },
];

/**
 * Indicadores numéricos: el dígito ha de ser lo primero que los siga, separado como mucho por un espacio, un punto
 * de abreviatura o dos puntos (D8).
 */
const NUMERIC_INDICATORS: readonly AddressIndicator[] = [
  { pattern: /Km/iu, numeric: true },
  { pattern: /Zona/iu, numeric: true },
  { pattern: /Barrio/iu, numeric: true },
  { pattern: /Manzana/iu, numeric: true },
  { pattern: /Mz/iu, numeric: true },
  { pattern: /Torre/iu, numeric: true },
  { pattern: /Nro\.?/iu, numeric: true },
  { pattern: /N°/iu, numeric: true },
  { pattern: /Piso/iu, numeric: true },
  { pattern: /Depto\.?/iu, numeric: true },
];

/** `#` solo cuenta como `#` + dígitos inmediatos, no como indicador suelto (`C#` / `F#` no disparan). */
const HASH_ADDRESS_PATTERN = /#\d+/g;

const ALL_ADDRESS_INDICATORS: readonly AddressIndicator[] = [
  ...STREET_INDICATORS,
  ...NUMERIC_INDICATORS,
];

const detectAddresses: Detector = (text, markers) =>
  withExclusionsMasked(text, [MARKER_PATTERN], (masked) =>
    masked
      .split(/(\n)/)
      .map((part) => (part === '\n' ? part : redactAddressesInLine(part, markers)))
      .join(''),
  );

function redactAddressesInLine(line: string, markers: MarkerTable): string {
  let result = '';
  let cursor = 0;

  while (cursor < line.length) {
    const next = nextAddressStart(line, cursor);
    if (next === undefined) {
      result += line.slice(cursor);
      break;
    }
    const fragEnd = addressFragmentEnd(line, next.start);
    let fragment = line.slice(next.start, fragEnd);
    // Conservar el espacio delante del separador fuerte (`500 — cargo` → `[ADDRESS_1] — cargo`).
    const withoutTrailingSpace = fragment.replace(/\s+$/u, '');
    fragment = withoutTrailingSpace;
    if (!/\d/.test(fragment)) {
      result += line.slice(cursor, next.start + 1);
      cursor = next.start + 1;
      continue;
    }
    if (next.numeric && !numericDigitFollows(line, next.start + next.length)) {
      result += line.slice(cursor, next.start + 1);
      cursor = next.start + 1;
      continue;
    }
    result +=
      line.slice(cursor, next.start) + markers.markerFor('ADDRESS', fragment);
    cursor = next.start + fragment.length;
  }

  return result;
}

interface AddressStart {
  start: number;
  length: number;
  numeric: boolean;
}

/** Primer indicador o `#digits` válido a partir de `from`. */
function nextAddressStart(line: string, from: number): AddressStart | undefined {
  let best: AddressStart | undefined;

  for (const indicator of ALL_ADDRESS_INDICATORS) {
    indicator.pattern.lastIndex = 0;
    const slice = line.slice(from);
    const flags = indicator.pattern.flags.includes('g')
      ? indicator.pattern.flags
      : `${indicator.pattern.flags}g`;
    const global = new RegExp(indicator.pattern.source, flags);
    for (const match of slice.matchAll(global)) {
      const start = from + (match.index ?? 0);
      const length = match[0].length;
      if (!isAddressBoundaryBefore(line, start)) continue;
      if (!isAddressBoundaryAfter(line, start + length)) continue;
      if (best === undefined || start < best.start) {
        best = { start, length, numeric: indicator.numeric };
      }
      break;
    }
  }

  HASH_ADDRESS_PATTERN.lastIndex = 0;
  const hashSlice = line.slice(from);
  for (const match of hashSlice.matchAll(HASH_ADDRESS_PATTERN)) {
    const start = from + (match.index ?? 0);
    if (!isAddressBoundaryBefore(line, start)) continue;
    const candidate: AddressStart = {
      start,
      length: match[0].length,
      numeric: false,
    };
    if (best === undefined || start < best.start) best = candidate;
    break;
  }

  return best;
}

function addressFragmentEnd(line: string, from: number): number {
  for (let i = from; i < line.length; i++) {
    if (ADDRESS_STRONG_SEP.test(line[i] ?? '')) return i;
  }
  return line.length;
}

/** Tras un indicador numérico: dígito separado como mucho por espacio, punto de abreviatura o `:`. */
function numericDigitFollows(text: string, afterIndicator: number): boolean {
  return /^(?:[.:]|\p{Zs}){0,2}\d/u.test(text.slice(afterIndicator));
}

// --- Nombre propio (ADR-030 §14) -------------------------------------------------------------------

/**
 * Partículas de topónimo: un fragmento precedido inmediatamente de una de ellas no se sustituye. Cuando un apellido
 * coincide con una ciudad prevalece la ciudad (ADR-030 §14): el nombre no aporta señal de encaje y la ubicación sí.
 */
const TOPONYM_PARTICLES = [
  'La',
  'Las',
  'El',
  'Los',
  'San',
  'Santa',
  'Villa',
  'Puerto',
] as const;

/** Lista cerrada de ciudades y departamentos reconocidos; un fragmento que forme parte de uno no se sustituye. */
const TOPONYMS = [
  'La Paz',
  'El Alto',
  'Santa Cruz de la Sierra',
  'Santa Cruz',
  'Cochabamba',
  'Oruro',
  'Potosí',
  'Tarija',
  'Sucre',
  'Chuquisaca',
  'Beni',
  'Trinidad',
  'Pando',
  'Cobija',
  'Montero',
] as const;

const ORG_DESIGNATORS = [
  'S\\.A\\.',
  'SA',
  'S\\.R\\.L\\.',
  'SRL',
  'Ltda\\.',
  'S\\.A\\.S\\.',
  'Inc\\.',
  'LLC',
  '&\\s*C[ií]a\\.',
] as const;

const ORG_WORDS = [
  'Banco',
  'Constructora',
  'Consultora',
  'Cooperativa',
  'Empresa',
  'Grupo',
  'Fundación',
  'Universidad',
  'Colegio',
  'Instituto',
  'Clínica',
  'Hospital',
  'Ministerio',
  'Agencia',
  'Editorial',
] as const;

/**
 * Palabras corrientes en minúscula: ante la duda entre redactar un fragmento del nombre y conservar una de ellas,
 * no se redacta. Solo afecta al detector de nombre.
 */
const COMMON_LOWERCASE_WORDS: ReadonlySet<string> = new Set([
  'paz',
  'cruz',
  'flores',
  'campos',
  'torres',
  'luna',
  'rosa',
  'león',
  'prado',
  'castillo',
  'nieves',
  'mar',
]);

const ORG_DESIGNATOR_PATTERN = new RegExp(
  ORG_DESIGNATORS.map((d) => `(?:${d})`).join('|'),
  'iu',
);

/**
 * Nombre propio, solo con `redactName: true` y un `personName` no vacío: el nombre completo se sustituye siempre; un
 * fragmento suelto solo si pasa las exclusiones de topónimo, organización y palabra corriente (ADR-030 §14).
 */
function nameDetector(options: RedactionOptions): Detector | undefined {
  const parts = options.personName?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (options.redactName !== true || parts.length === 0) return undefined;
  const identity = parts.join(' ').toLocaleLowerCase();
  const fullPattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${parts.map(escapeRegExp).join('\\s+')}(?![\\p{L}\\p{N}])`,
    'giu',
  );
  const partPatterns = parts.map(
    (part) =>
      new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegExp(part)}(?![\\p{L}\\p{N}])`,
        'giu',
      ),
  );

  return (text, markers) => {
    let current = withExclusionsMasked(text, [MARKER_PATTERN], (masked) =>
      masked.replace(fullPattern, (name) =>
        markers.markerFor('NAME', name, identity),
      ),
    );

    for (const pattern of partPatterns) {
      current = withExclusionsMasked(current, [MARKER_PATTERN], (masked) =>
        masked.replace(pattern, (match, offset: number) => {
          if (isExcludedNameFragment(masked, offset, match)) return match;
          return markers.markerFor('NAME', match, identity);
        }),
      );
    }
    return current;
  };
}

/**
 * Desempate declarado (ADR-030 §14): ante la duda entre redactar un fragmento del nombre y conservar un topónimo, un
 * empleador o una palabra corriente, no se redacta.
 */
function isExcludedNameFragment(
  text: string,
  start: number,
  match: string,
): boolean {
  const end = start + match.length;
  if (
    COMMON_LOWERCASE_WORDS.has(match) &&
    match === match.toLocaleLowerCase()
  ) {
    return true;
  }
  if (isToponymContext(text, start, end)) return true;
  if (isOrganizationContext(text, start, end)) return true;
  return false;
}

function isToponymContext(text: string, start: number, end: number): boolean {
  const before = text.slice(0, start);
  for (const particle of TOPONYM_PARTICLES) {
    if (new RegExp(`${escapeRegExp(particle)}\\s+$`, 'iu').test(before)) {
      return true;
    }
  }
  for (const toponym of TOPONYMS) {
    const pattern = new RegExp(escapeRegExp(toponym), 'giu');
    for (const hit of text.matchAll(pattern)) {
      const hitStart = hit.index ?? 0;
      const hitEnd = hitStart + hit[0].length;
      if (hitStart <= start && hitEnd >= end) return true;
    }
  }
  return false;
}

function isOrganizationContext(
  text: string,
  start: number,
  end: number,
): boolean {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const newline = text.indexOf('\n', end);
  const lineEnd = newline === -1 ? text.length : newline;
  const line = text.slice(lineStart, lineEnd);
  const localStart = start - lineStart;

  if (ORG_DESIGNATOR_PATTERN.test(line)) return true;

  for (const word of ORG_WORDS) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`,
      'giu',
    );
    for (const hit of line.matchAll(pattern)) {
      if ((hit.index ?? 0) < localStart) return true;
    }
  }
  return false;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Documento antes que teléfono; dirección tras URL; nombre al final y solo con interruptor. */
const BASE_DETECTORS: readonly Detector[] = [
  detectEmails,
  detectUrls,
  detectIds,
  detectAddresses,
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
    // La tabla se rellena al redactar: hay que emitir el set después de `mapStrings`.
    const value = mapStrings(input, redactText);

    return {
      value,
      emittedMarkers: markers.emitted(),
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

function visitStrings(value: unknown, visit: (text: string) => void): void {
  if (typeof value === 'string') {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitStrings(item, visit);
    return;
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) visitStrings(item, visit);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
