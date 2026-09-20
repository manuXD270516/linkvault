import {
  linkLabel,
  OG_DESCRIPTION_MAX_LENGTH,
  OG_TITLE_MAX_LENGTH,
  type JobSalary,
  type PublicJobPreview,
} from '@linkvault/shared';

// Título y descripción de las etiquetas Open Graph (D5 de public-preview-share, ADR-027 §4). Funciones puras: reciben
// la vacante ya recortada a los campos publicables y no saben nada del HTML ni de la petición.

/** Separador de los campos de la descripción. */
const SEPARATOR = ' · ';

/** Lo que se dice cuando no se pudo leer ni un campo: mejor eso que una descripción vacía. */
export const FALLBACK_DESCRIPTION = 'Oferta guardada en LinkVault';

/**
 * Título de la tarjeta: el del preview o, si la oferta aún no se ha leído, la etiqueta legible derivada de su URL. Un
 * link `pending` o `failed` —el estado normal en el instante en que alguien comparte y reparte la URL— se publica
 * igual, y la página mejora sola cuando llegue el enriquecimiento.
 */
export function ogTitle(preview: PublicJobPreview): string {
  const title = preview.title ?? labelOf(preview);
  return cut(title, OG_TITLE_MAX_LENGTH);
}

/**
 * Descripción de la tarjeta, con los campos publicables que existan y **en este orden**: empresa, ubicación, salario,
 * modalidad, nivel y cuándo cierra.
 *
 * El salario va antes que la modalidad y el nivel porque es lo que más decide si alguien abre una oferta en un chat, y
 * porque lo que va al final es justo lo que cada app se come al recortar: dejar el sueldo detrás de "Remoto · Senior"
 * equivale a no publicarlo.
 */
export function ogDescription(preview: PublicJobPreview): string {
  const parts = [
    preview.company,
    preview.location,
    salaryText(preview.salary),
    modalityText(preview.modality),
    seniorityText(preview.seniority),
    closingText(preview.expiresAt),
  ].filter((part): part is string => part !== undefined && part.length > 0);
  return parts.length === 0
    ? FALLBACK_DESCRIPTION
    : cut(parts.join(SEPARATOR), OG_DESCRIPTION_MAX_LENGTH);
}

/** Etiqueta legible de la URL publicable; si no hay ninguna, el nombre de la plataforma no dice nada útil. */
function labelOf(preview: PublicJobPreview): string {
  return preview.displayUrl === undefined
    ? FALLBACK_DESCRIPTION
    : linkLabel(preview.displayUrl);
}

/**
 * Corta a `max` **code points**, en el último espacio anterior al límite, y termina en puntos suspensivos. Se mide en
 * code points y no en unidades UTF-16 para que un emoji cuente como un carácter, el mismo criterio que zod.
 */
function cut(text: string, max: number): string {
  const points = [...text];
  if (points.length <= max) {
    return text;
  }
  // Un hueco para los puntos suspensivos, que también cuentan.
  const kept = points.slice(0, max - 1).join('');
  const lastSpace = kept.lastIndexOf(' ');
  const trimmed = lastSpace > 0 ? kept.slice(0, lastSpace) : kept;
  return `${trimmed.trimEnd()}…`;
}

/** Salario en una línea, con el mismo criterio que la tarjeta: sin ninguna cifra no hay nada que decir. */
export function salaryText(salary: JobSalary | undefined): string | undefined {
  if (salary === undefined) {
    return undefined;
  }
  const { min, max, currency, period } = salary;
  let amount: string;
  if (min !== null && max !== null) {
    amount = `${format(min)} – ${format(max)}`;
  } else if (min !== null) {
    amount = `Desde ${format(min)}`;
  } else if (max !== null) {
    amount = `Hasta ${format(max)}`;
  } else {
    // "BOB al mes" no es un salario.
    return undefined;
  }
  const withCurrency = currency === null ? amount : `${amount} ${currency}`;
  const periodText = PERIODS[period ?? 'none'];
  return periodText === undefined ? withCurrency : `${withCurrency} ${periodText}`;
}

/** Agrupación en español; `es-BO` agrupa los millares también con cuatro cifras. */
function format(value: number): string {
  return new Intl.NumberFormat('es-BO', { useGrouping: true }).format(value);
}

const PERIODS: Readonly<Record<string, string | undefined>> = {
  month: 'al mes',
  year: 'al año',
  hour: 'por hora',
  none: undefined,
};

const MODALITIES: Readonly<Record<string, string | undefined>> = {
  remote: 'Remoto',
  hybrid: 'Híbrido',
  onsite: 'Presencial',
  unknown: undefined,
};

const SENIORITIES: Readonly<Record<string, string | undefined>> = {
  intern: 'Prácticas',
  junior: 'Junior',
  mid: 'Intermedio',
  senior: 'Senior',
  lead: 'Líder',
  unknown: undefined,
};

/** `unknown` no se dice: la página no lo dijo, y repetir "Desconocida" ocupa sitio sin aportar nada. */
function modalityText(modality: string | undefined): string | undefined {
  return modality === undefined ? undefined : MODALITIES[modality];
}

function seniorityText(seniority: string | undefined): string | undefined {
  return seniority === undefined ? undefined : SENIORITIES[seniority];
}

/** Cuándo cierra, en la fecha tal y como se guarda (`YYYY-MM-DD`): es un día, no un instante. */
function closingText(expiresAt: string | undefined): string | undefined {
  return expiresAt === undefined ? undefined : `Cierra el ${expiresAt}`;
}
