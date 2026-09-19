import type {
  JobModality,
  JobSalary,
  JobSeniority,
  Platform,
  PreviewAuthor,
  PreviewFieldName,
  ResolvedPreviewSources,
} from '@linkvault/shared';

/**
 * Identificador del extractor de IA (D3). La tarjeta lo trata distinto del resto de extractores automáticos: lo que la
 * IA dedujo no se presenta como si estuviera escrito en la página.
 */
export const AI_EXTRACTOR_ID = 'ai:extract-job';

/** Procedencia de un campo tal y como sale por la API, sea cual sea el campo. */
export type PreviewSourceEntry = NonNullable<ResolvedPreviewSources[keyof ResolvedPreviewSources]>;

/**
 * De dónde salió un dato, en los orígenes que la persona distingue: leído de la página, deducido por la IA, sacado de
 * la descripción que alguien pegó o escrito por alguien. La diferencia entre los dos primeros importa —un salario
 * deducido es el peor dato para equivocarse— y los dos últimos llevan nombre, porque el link es compartido.
 */
export type PreviewFieldOrigin =
  | { kind: 'page'; extractor: string }
  | { kind: 'ai' }
  | { kind: 'pasted'; by: PreviewAuthor }
  | { kind: 'manual'; by: PreviewAuthor };

/** Procedencia de un campo, o `null` si nadie lo ha escrito todavía. */
export function fieldOrigin(entry: PreviewSourceEntry | undefined): PreviewFieldOrigin | null {
  if (entry === undefined) {
    return null;
  }
  if (entry.source === 'manual') {
    return { kind: 'manual', by: entry.by };
  }
  if (entry.source === 'pasted') {
    return { kind: 'pasted', by: entry.by };
  }
  return entry.extractor === AI_EXTRACTOR_ID ? { kind: 'ai' } : { kind: 'page', extractor: entry.extractor };
}

/** Nombre de cada plataforma con canonicalizador propio; son marcas, así que no se traducen. */
const PLATFORM_NAMES: Record<Exclude<Platform, 'generic'>, string> = {
  linkedin: 'LinkedIn',
  computrabajo: 'Computrabajo',
  indeed: 'Indeed',
  trabajopolis: 'Trabajopolis',
  getonboard: 'Get on Board',
};

/** Extensión de fichero al final del último segmento (`.html`, `.aspx`…): ruido para la etiqueta. */
const FILE_EXTENSION = /\.[a-z0-9]{1,5}$/i;

/** Milisegundos de un día, para contar cuántos van desde que se publicó la oferta. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Etiqueta legible de un link: el último segmento del path des-slugificado (sin guiones ni extensión) o, si el path no
 * tiene segmentos, el dominio sin `www.`. Se deriva de `displayUrl`, la URL tal como la escribió una persona, porque la
 * normalizada pierde el slug con el puesto y la empresa. Una cadena que no es una URL se muestra tal cual.
 *
 * Solo se usa cuando el preview no trae título: en cuanto la oferta se pudo leer, la tarjeta dice su título de verdad.
 */
export function linkLabel(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  const lastSegment = parsed.pathname.split('/').filter((segment) => segment.length > 0).at(-1);
  if (lastSegment === undefined) {
    return host;
  }
  const label = deslugify(lastSegment);
  return label.length === 0 ? host : label;
}

function deslugify(segment: string): string {
  return decodeSegment(segment)
    .replace(FILE_EXTENSION, '')
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // Un porcentaje suelto no se puede decodificar: se muestra el segmento tal cual.
    return segment;
  }
}

export function platformName(platform: Platform): string {
  return platform === 'generic' ? $localize`:@@links.platform.generic:Otra web` : PLATFORM_NAMES[platform];
}

/**
 * Modalidad en palabras. `unknown` devuelve `null` y no `"Desconocida"`: la página no lo dijo, y una tarjeta que repite
 * "Desconocida" en cada oferta ocupa sitio sin decir nada.
 */
export function modalityLabel(modality: JobModality | undefined): string | null {
  switch (modality) {
    case 'remote':
      return $localize`:@@links.modality.remote:Remoto`;
    case 'hybrid':
      return $localize`:@@links.modality.hybrid:Híbrido`;
    case 'onsite':
      return $localize`:@@links.modality.onsite:Presencial`;
    default:
      return null;
  }
}

/** Seniority en palabras, con el mismo criterio que la modalidad para `unknown`. */
export function seniorityLabel(seniority: JobSeniority | undefined): string | null {
  switch (seniority) {
    case 'intern':
      return $localize`:@@links.seniority.intern:Prácticas`;
    case 'junior':
      return $localize`:@@links.seniority.junior:Junior`;
    case 'mid':
      return $localize`:@@links.seniority.mid:Intermedio`;
    case 'senior':
      return $localize`:@@links.seniority.senior:Senior`;
    case 'lead':
      return $localize`:@@links.seniority.lead:Líder`;
    default:
      return null;
  }
}

/**
 * Salario en una línea: "8.000 – 12.000 BOB al mes", "Desde 8.000 BOB" o "Hasta 12.000 BOB al mes". Sin ninguna cifra no
 * hay nada que decir, aunque la página haya dejado la moneda: "BOB al mes" no es un salario.
 *
 * Los números se agrupan con `Intl`, que no necesita los datos de locale de Angular y da el mismo resultado en el
 * navegador y en los tests.
 */
export function formatSalary(salary: JobSalary | null | undefined, locale: string): string | null {
  if (!salary) {
    return null;
  }
  const { min, max, currency, period } = salary;
  // `useGrouping: true` significa "siempre" (es lo mismo que `'always'`, que no se puede escribir aquí porque el `lib`
  // de TypeScript del proyecto no trae todavía los tipos de esa opción). Hace falta: el español NO agrupa los números
  // de cuatro cifras, así que sin esto un rango sale "8000 – 12.000" y se lee como una errata.
  const format = (value: number): string =>
    new Intl.NumberFormat(locale, { useGrouping: true }).format(value);
  let amount: string;
  if (min !== null && max !== null) {
    amount = `${format(min)} – ${format(max)}`;
  } else if (min !== null) {
    amount = $localize`:@@links.salary.from:Desde ${format(min)}:MIN:`;
  } else if (max !== null) {
    amount = $localize`:@@links.salary.upTo:Hasta ${format(max)}:MAX:`;
  } else {
    return null;
  }
  const withCurrency = currency === null ? amount : `${amount} ${currency}`;
  const periodText = salaryPeriodLabel(period);
  return periodText === null ? withCurrency : `${withCurrency} ${periodText}`;
}

function salaryPeriodLabel(period: JobSalary['period']): string | null {
  switch (period) {
    case 'month':
      return $localize`:@@links.salary.month:al mes`;
    case 'year':
      return $localize`:@@links.salary.year:al año`;
    case 'hour':
      return $localize`:@@links.salary.hour:por hora`;
    default:
      return null;
  }
}

/**
 * Días completos transcurridos desde una fecha sin hora (`YYYY-MM-DD`), o `null` si no hay fecha o no se entiende. Una
 * fecha futura devuelve `0`: "publicada dentro de dos días" no es algo que una oferta pueda decir.
 */
export function daysSince(date: string | null | undefined, now: Date): number | null {
  if (date === null || date === undefined) {
    return null;
  }
  const published = Date.parse(date);
  if (Number.isNaN(published)) {
    return null;
  }
  return Math.max(0, Math.floor((now.getTime() - published) / DAY_MS));
}

/**
 * De dónde salió un dato, en palabras. Los orígenes se dicen distinto a propósito: "Leído de la página" es lo que pone
 * la oferta, "Deducido por la IA" es una conjetura nuestra, "Descripción pegada por Beto" es lo que leímos de un texto
 * que alguien pegó y "Escrito por Ana" es una persona que se hace responsable. Confundirlos es lo que convierte un
 * salario inventado en un salario creído. Lo pegado no dice "Pegado por": en un grupo de WhatsApp se confundiría con
 * quien pegó el link.
 */
export function originText(origin: PreviewFieldOrigin | null): string | null {
  switch (origin?.kind) {
    case 'page':
      return $localize`:@@links.origin.page:Leído de la página`;
    case 'ai':
      return $localize`:@@links.origin.ai:Deducido por la IA`;
    case 'pasted':
      return $localize`:@@links.origin.pasted:Descripción pegada por ${origin.by.displayName}:NAME:`;
    case 'manual':
      return $localize`:@@links.origin.manual:Escrito por ${origin.by.displayName}:NAME:`;
    default:
      return null;
  }
}

/** Un pegado que todavía se ve en la tarjeta: quién lo hizo, cuándo y qué campos siguen diciendo lo que él trajo. */
export interface PasteInEffect {
  by: PreviewAuthor;
  at: string;
  fields: PreviewFieldName[];
}

/**
 * El último pegado que sigue a la vista, o `null` si ningún campo sale ya de un texto pegado. Un pegado es todo lo que
 * se escribió en ese gesto, así que se deshace junto ("Deshacer lo que pegó Ana"): los campos con origen `pasted` y
 * los `manual` que comparten su autor y su fecha, que son el título y la empresa tecleados en el mismo diálogo. Sin
 * ellos, un link de LinkedIn completado con su cabecera escrita aparte seguiría en `manual` tras deshacer. Una
 * corrección a mano posterior —otro autor u otra fecha— no es parte del pegado y no se toca.
 *
 * Si quedan campos de dos pegados distintos (el segundo no trajo todos los campos del primero), se ofrece deshacer el
 * más reciente, que es el que la persona acaba de ver.
 */
export function latestPaste(sources: ResolvedPreviewSources | undefined): PasteInEffect | null {
  const entries = Object.entries(sources ?? {}) as [PreviewFieldName, PreviewSourceEntry | undefined][];
  let latest: PasteInEffect | null = null;
  for (const [, entry] of entries) {
    if (entry?.source !== 'pasted') {
      continue;
    }
    if (latest === null || Date.parse(entry.at) > Date.parse(latest.at)) {
      latest = { by: entry.by, at: entry.at, fields: [] };
    }
  }
  if (latest === null) {
    return null;
  }
  const { by, at } = latest;
  // Se recorren en el orden de las fuentes, sin separar lo pegado de lo tecleado: es un solo gesto.
  latest.fields = entries
    .filter(
      ([, entry]) =>
        (entry?.source === 'pasted' || entry?.source === 'manual') &&
        entry.at === at &&
        entry.by.userId === by.userId,
    )
    .map(([name]) => name);
  return latest;
}
