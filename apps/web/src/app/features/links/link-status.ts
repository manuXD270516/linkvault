import {
  type EnrichmentFailureReason,
  type JobLinkSummary,
  type Platform,
  type StoredPreview,
  isRetryableEnrichmentReason,
} from '@linkvault/shared';
import { platformName } from './link-preview';

/**
 * Lo que la tarjeta dice del estado de una oferta y qué se puede hacer con ella (spec web/links).
 *
 * El texto NO sale del nombre del estado. `manual` es procedencia, no completitud: un link que alguien terminó de
 * escribir a mano está completo y no puede decir "Faltan datos", igual que un `partial` con título y empresa ya es una
 * oferta legible. Lo que se mira son los campos que hay, el motivo del último fallo y cuándo se pidió la lectura.
 */
export interface LinkCardStatus {
  /** Texto del estado, o `null` cuando la oferta ya se explica sola y no hay nada que avisar. */
  text: string | null;
  /** `true` cuando falta información que solo una persona puede poner. */
  needsHand: boolean;
  /** `true` solo si volver a pedir la lectura puede cambiar algo (`isRetryableEnrichmentReason`). */
  canRetry: boolean;
  /** `true` cuando lo compartido no era una oferta: lo que toca ahí es quitarlo, no completarlo. */
  notAnOffer: boolean;
  /**
   * `true` cuando lo que toca es pegar la descripción: la bolsa no nos deja leerla y la oferta todavía no tiene título.
   * Entonces "Pegar la descripción" es la acción principal y completarla a mano, la secundaria (paste-job-description).
   */
  pasteFirst: boolean;
}

/**
 * Cuánto se espera a una lectura antes de dejar de prometerla (D5). Un `pending` reciente es una lectura en curso; uno
 * viejo es una lectura que no llegó, y decir "Leyendo la oferta…" para siempre sería mentir.
 */
export const READING_GRACE_MS = 10 * 60 * 1000;

/** Estado de la tarjeta de un link, contado desde `now`. */
export function linkCardStatus(link: JobLinkSummary, now: Date): LinkCardStatus {
  const preview = link.preview;
  // Con título y empresa la oferta ya es legible, la haya escrito la página, la IA o una persona.
  if (isReadable(preview)) {
    return { text: null, needsHand: false, canRetry: false, notAnOffer: false, pasteFirst: false };
  }

  const error = link.lastEnrichmentError;
  if (error !== undefined) {
    // Sin título y con una bolsa que no nos deja leer, lo único que va a completar la tarjeta es lo que la persona ya
    // tiene delante: el texto de la oferta. Decir solo "no se puede leer" dejaría la tarjeta como está.
    if (isClosedToUs(error.reason) && !filled(preview?.title)) {
      return {
        text: pasteFirstText(link.platform),
        needsHand: true,
        canRetry: false,
        notAnOffer: false,
        pasteFirst: true,
      };
    }
    const notAnOffer = error.reason === 'not_a_job';
    return {
      text: failureText(error.reason),
      needsHand: !notAnOffer,
      canRetry: isRetryableEnrichmentReason(error.reason),
      notAnOffer,
      pasteFirst: false,
    };
  }

  if (hasAnyData(preview)) {
    return {
      text: $localize`:@@links.status.missingFields:Faltan datos de esta oferta`,
      needsHand: true,
      canRetry: false,
      notAnOffer: false,
      pasteFirst: false,
    };
  }

  // Sin nada que enseñar y sin fallo: la diferencia entre "está en camino" y "no llegó" la marca el reloj.
  return isStillReading(link, now)
    ? {
        text: $localize`:@@links.status.reading:Leyendo la oferta…`,
        needsHand: false,
        canRetry: false,
        notAnOffer: false,
        pasteFirst: false,
      }
    : {
        text: $localize`:@@links.list.noPreview:Sin vista previa todavía`,
        needsHand: true,
        canRetry: false,
        notAnOffer: false,
        pasteFirst: false,
      };
}

/**
 * `true` mientras la tarjeta dice "Leyendo la oferta…": sin título y empresa, sin error de lectura, sin ningún dato y
 * pedida hace menos de `READING_GRACE_MS`. Es el predicado que comparten la tarjeta y el aviso de "Copiar enlace"
 * (`emptyCardNotice`), para que no puedan divergir.
 */
export function isStillReading(link: JobLinkSummary, now: Date): boolean {
  const preview = link.preview;
  return (
    !isReadable(preview) &&
    link.lastEnrichmentError === undefined &&
    !hasAnyData(preview) &&
    requestedAgo(link, now) < READING_GRACE_MS
  );
}

/** Motivos en los que la bolsa, y no algo pasajero, nos impide leer la oferta: prohibirlo o bloquearnos. */
function isClosedToUs(reason: EnrichmentFailureReason): boolean {
  return reason === 'robots_disallowed' || reason === 'blocked';
}

/**
 * Qué hacer con una oferta que la bolsa no nos deja leer, con el nombre de la bolsa. Una web sin canonicalizador propio
 * no tiene un nombre que decir ("Otra web no nos deja…" no se entiende), así que ahí se habla de "esta web".
 */
function pasteFirstText(platform: Platform): string {
  return platform === 'generic'
    ? $localize`:@@links.status.pasteFirstGeneric:Esta web no nos deja leer sus ofertas. Pega su descripción para completarla`
    : $localize`:@@links.status.pasteFirst:${platformName(platform)}:PLATFORM: no nos deja leer sus ofertas. Pega su descripción para completarla`;
}

/** Texto honesto de cada motivo (D5): lo que el sitio no permite no se cuenta como un error nuestro. */
function failureText(reason: EnrichmentFailureReason): string {
  switch (reason) {
    case 'robots_disallowed':
      return $localize`:@@links.status.robotsDisallowed:Esta bolsa no permite la lectura automática de sus ofertas`;
    case 'blocked':
      return $localize`:@@links.status.blocked:Esta bolsa no nos deja leer esta oferta`;
    case 'not_a_job':
      return $localize`:@@links.status.notAJob:Esto no parece una oferta`;
    default:
      return $localize`:@@links.status.unreadable:No pudimos leer esta oferta`;
  }
}

/** Una oferta se lee sola cuando tiene título y empresa; es la misma regla con la que el worker la da por `enriched`. */
function isReadable(preview: StoredPreview | undefined): boolean {
  return filled(preview?.title) && filled(preview?.company);
}

/**
 * Si se consiguió algún dato de la vacante. `unknown`, una lista vacía y un resumen vacío son "no se sabe", no un dato:
 * un preview que solo trae eso es un preview vacío.
 */
function hasAnyData(preview: StoredPreview | undefined): boolean {
  if (preview === undefined) {
    return false;
  }
  return (
    filled(preview.title) ||
    filled(preview.company) ||
    filled(preview.location) ||
    filled(preview.summary) ||
    (preview.salary ?? null) !== null ||
    (preview.postedAt ?? null) !== null ||
    (preview.expiresAt ?? null) !== null ||
    (preview.modality !== undefined && preview.modality !== 'unknown') ||
    (preview.seniority !== undefined && preview.seniority !== 'unknown') ||
    (preview.skills?.length ?? 0) > 0 ||
    (preview.languages?.length ?? 0) > 0
  );
}

function filled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Cuánto hace que se pidió la lectura. Un link guardado antes de que existiera `previewRequestedAt` no trae la fecha:
 * ahí vale la de su guardado, que es cuando se habría pedido, y deja el link donde tiene que estar: en "no llegó".
 */
function requestedAgo(link: JobLinkSummary, now: Date): number {
  const requestedAt = Date.parse(link.previewRequestedAt ?? link.sharedAt);
  return Number.isNaN(requestedAt) ? Number.POSITIVE_INFINITY : now.getTime() - requestedAt;
}
