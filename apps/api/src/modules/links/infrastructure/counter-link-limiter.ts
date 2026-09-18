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
  ENRICH_RETRIES_PER_LINK,
  IMPORTS_PER_USER,
  LINK_LIMIT_WINDOW_MS,
} from '../domain/limits';

// Adaptador de LINK_LIMITER sobre el contador por ventana fija de `infrastructure/limits` (D13). `links` pone el nombre
// de cada contador, su límite y —lo que de verdad importa— qué hacer cuando el almacén no responde:
//
// - `import` **falla abierto**, como el de `auth`: negar una importación por un Redis lento sería peor que dejarla
//   pasar. Lo que se permite de más es escribir en nuestra propia base de datos.
// - `enrich-link` **falla cerrado**: lo que se permitiría de más es volver a descargar la página de un sitio ajeno, que
//   es justo el daño que ADR-003 quiere evitar, y negar un reintento no rompe nada: la lectura sigue pudiéndose pedir
//   más tarde y el preview se puede completar a mano.
//
// El nombre del contador lleva el identificador del link, que no es un dato personal; nunca la URL ni el usuario.

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
}

function nameOf(key: LinkLimitKey): string {
  switch (key.kind) {
    case 'enrich-link':
      return `links:enrich:${key.linkId}`;
    case 'import':
      return `links:import:${key.userId}`;
  }
}

function limitOf(key: LinkLimitKey): number {
  switch (key.kind) {
    case 'enrich-link':
      return ENRICH_RETRIES_PER_LINK;
    case 'import':
      return IMPORTS_PER_USER;
  }
}

/** Qué se responde cuando el contador no respondió: abierto para la importación, cerrado para la relectura. */
function failureDecisionOf(key: LinkLimitKey): LinkLimitDecision {
  switch (key.kind) {
    case 'enrich-link':
      return {
        allowed: false,
        retryAfterSeconds: CLOSED_RETRY_AFTER_SECONDS,
      };
    case 'import':
      return { allowed: true, retryAfterSeconds: 0 };
  }
}
