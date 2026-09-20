import { Inject, Injectable } from '@nestjs/common';
import {
  FIXED_WINDOW_COUNTER,
  type FixedWindowCounter,
} from '../../../infrastructure/limits/fixed-window-counter';
import type {
  LinkLimitDecision,
  LinkLimitKey,
  LinkLimiter,
} from '../application/ports/link-limiter.port';
import {
  COMMENTS_PER_USER,
  ENRICH_RETRIES_PER_LINK,
  IMPORTS_PER_USER,
  LINK_LIMIT_WINDOW_MS,
  PASTE_UNAVAILABLE_RETRY_AFTER_SECONDS,
  PASTES_PER_USER,
  PUBLIC_PAGE_VIEWS,
  PUBLIC_PAGE_VIEWS_PER_SLUG,
  PUBLIC_PREVIEW_VIEWS,
} from '../domain/limits';

// Adaptador de LINK_LIMITER sobre el contador por ventana fija de `infrastructure/limits` (D13). `links` pone el nombre
// de cada contador, su límite y —lo que de verdad importa— qué hacer cuando el almacén no responde:
//
// - `import` **falla abierto**, como el de `auth`: negar una importación por un Redis lento sería peor que dejarla
//   pasar. Lo que se permite de más es escribir en nuestra propia base de datos.
// - `enrich-link` **falla cerrado**: lo que se permitiría de más es volver a descargar la página de un sitio ajeno, que
//   es justo el daño que ADR-003 quiere evitar, y negar un reintento no rompe nada: la lectura sigue pudiéndose pedir
//   más tarde y el preview se puede completar a mano.
// - `paste-description` **falla cerrado** también: sin contador, nada acotaría las llamadas a la IA que hace cada pegado.
//   Pero lo dice (`unavailable`), para que la respuesta sea "inténtalo en un rato" y no "pegaste demasiadas" (D5 de
//   paste-job-description).
// - `comment` **falla abierto**, como la importación (D6 de group-comments): lo que se permite de más es escribir en
//   nuestra base y repartir un aviso a los miembros de un grupo.
// - las **tres claves públicas** fallan abiertas (D8 de public-preview-share): con el contador caído, lo que se permite
//   de más son dos lecturas indexadas por petición; negarlo dejaría sin tarjeta todos los enlaces repartidos por
//   WhatsApp mientras durase la avería, que es justo el daño que este change existe para evitar.
//
// El nombre del contador lleva un identificador interno, que no es un dato personal: el del link en la relectura y el
// del usuario (`userId`) en la importación y el pegado, que se cuentan por persona. Nunca la URL, el email ni el texto.
// Las claves públicas son **fijas** o llevan el `slug`, que es parte de la ruta: ninguna se deriva de una cabecera de la
// petición, así que no hay nada que falsificar y no hace falta `trustProxy`.

/** Segundos que se anuncian cuando el contador no responde y el límite falla cerrado. */
const CLOSED_RETRY_AFTER_SECONDS = Math.ceil(LINK_LIMIT_WINDOW_MS / 1000);

@Injectable()
export class CounterLinkLimiter implements LinkLimiter {
  constructor(
    @Inject(FIXED_WINDOW_COUNTER) private readonly counter: FixedWindowCounter,
  ) {}

  async consume(key: LinkLimitKey): Promise<LinkLimitDecision> {
    const outcome = await this.counter.consume(nameOf(key), {
      limit: limitOf(key),
      windowMs: LINK_LIMIT_WINDOW_MS,
    });
    if (outcome !== null) {
      return outcome;
    }
    return failureDecisionOf(key);
  }

  /** Devuelve el intento con `giveBack`, que no deja el contador por debajo de cero. Un contador caído no es un error. */
  async refund(key: LinkLimitKey): Promise<void> {
    await this.counter.giveBack(nameOf(key));
  }
}

function nameOf(key: LinkLimitKey): string {
  switch (key.kind) {
    case 'enrich-link':
      return `links:enrich:${key.linkId}`;
    case 'import':
      return `links:import:${key.userId}`;
    case 'paste-description':
      return `links:paste:${key.userId}`;
    case 'comment':
      return `links:comment:${key.userId}`;
    case 'public-page':
      return 'links:public-page';
    case 'public-preview':
      return 'links:public-preview';
    case 'public-page-slug':
      return `links:public-page:${key.slug}`;
  }
}

function limitOf(key: LinkLimitKey): number {
  switch (key.kind) {
    case 'enrich-link':
      return ENRICH_RETRIES_PER_LINK;
    case 'import':
      return IMPORTS_PER_USER;
    case 'paste-description':
      return PASTES_PER_USER;
    case 'comment':
      return COMMENTS_PER_USER;
    case 'public-page':
      return PUBLIC_PAGE_VIEWS;
    case 'public-preview':
      return PUBLIC_PREVIEW_VIEWS;
    case 'public-page-slug':
      return PUBLIC_PAGE_VIEWS_PER_SLUG;
  }
}

/** Qué se responde cuando el contador no respondió: abierto para la importación, cerrado para la relectura y el pegado. */
function failureDecisionOf(key: LinkLimitKey): LinkLimitDecision {
  switch (key.kind) {
    case 'enrich-link':
      return {
        allowed: false,
        retryAfterSeconds: CLOSED_RETRY_AFTER_SECONDS,
      };
    case 'import':
    case 'comment':
    case 'public-page':
    case 'public-preview':
    case 'public-page-slug':
      return { allowed: true, retryAfterSeconds: 0 };
    case 'paste-description':
      return {
        allowed: false,
        retryAfterSeconds: PASTE_UNAVAILABLE_RETRY_AFTER_SECONDS,
        unavailable: true,
      };
  }
}
