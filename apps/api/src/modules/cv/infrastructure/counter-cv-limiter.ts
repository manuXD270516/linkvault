import { Inject, Injectable } from '@nestjs/common';
import {
  FIXED_WINDOW_COUNTER,
  type FixedWindowCounter,
} from '../../../infrastructure/limits/fixed-window-counter';
import type {
  CvLimitDecision,
  CvLimitKey,
  CvLimiter,
  RefundableCvLimitKey,
} from '../application/ports/cv-limiter.port';
import {
  CV_LIMIT_WINDOW_MS,
  CV_REJECTS_PER_USER,
  CV_TEXT_PREVIEWS_PER_USER,
  CV_UPLOADS_PER_USER,
} from '../domain/limits';

// Adaptador de CV_LIMITER sobre el contador por ventana fija de `infrastructure/limits` (D5, ADR-028 §6). `cv` pone el
// nombre de cada contador, su límite y —lo que de verdad importa— qué hacer cuando el almacén no responde.
//
// **Las tres claves fallan abiertas, y cada una por su propia razón**, no por inercia:
//
// - `upload`: sin contador, una persona puede subir y borrar en bucle, que gasta tráfico pero no acumula nada, porque
//   el tope duro de almacenamiento no lo pone el contador sino el máximo de 5 documentos.
// - `text-preview`: esa ruta **solo lee lo suyo** —como mucho cinco documentos de una persona y un prefijo de 2.000
//   caracteres—, sin IA, sin red hacia fuera y sin escrituras. Lo que se permite de más con Redis caído es que alguien
//   mire su propio CV muchas veces; negárselo sería impedirle comprobar si su CV sirve por una avería nuestra.
// - `reject`: es un techo para una ráfaga de basura, no una defensa de nada que se guarde. Cerrarlo con el contador
//   caído convertiría una avería de Redis en "no puedes subir tu CV".
//
// El nombre del contador lleva el `userId`, que es un identificador interno y no un dato personal. Nunca el nombre del
// archivo, ni su tipo, ni su tamaño.

@Injectable()
export class CounterCvLimiter implements CvLimiter {
  constructor(
    @Inject(FIXED_WINDOW_COUNTER) private readonly counter: FixedWindowCounter,
  ) {}

  async consume(key: CvLimitKey): Promise<CvLimitDecision> {
    const outcome = await this.counter.consume(nameOf(key), {
      limit: limitOf(key),
      windowMs: CV_LIMIT_WINDOW_MS,
    });
    // `null` es "el contador no respondió": las tres claves siguen adelante.
    return outcome ?? { allowed: true, retryAfterSeconds: 0 };
  }

  /**
   * Devuelve el intento con `giveBack`, que no deja el contador por debajo de cero. Un contador caído no es un error:
   * el intento se queda gastado y nada más.
   *
   * El tipo del parámetro solo admite la clave de subidas. La de rechazos **no se devuelve nunca** —un rechazo
   * ocurrió—, y que eso sea imposible de escribir vale más que un comentario pidiéndolo.
   */
  async refund(key: RefundableCvLimitKey): Promise<void> {
    await this.counter.giveBack(nameOf(key));
  }
}

function nameOf(key: CvLimitKey): string {
  switch (key.kind) {
    case 'upload':
      return `cv:upload:${key.userId}`;
    case 'text-preview':
      return `cv:text-preview:${key.userId}`;
    case 'reject':
      return `cv:reject:${key.userId}`;
  }
}

function limitOf(key: CvLimitKey): number {
  switch (key.kind) {
    case 'upload':
      return CV_UPLOADS_PER_USER;
    case 'text-preview':
      return CV_TEXT_PREVIEWS_PER_USER;
    case 'reject':
      return CV_REJECTS_PER_USER;
  }
}
