import { HttpClient, HttpEventType } from '@angular/common/http';
import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';
import {
  GROUP_LINK_COMMENTS_EVENT_NAME,
  type GroupLinkCommentsMessage,
  LINK_ENRICHED_EVENT_NAME,
  type LinkEnrichedMessage,
} from '@linkvault/shared';
import { Observable, Subject, type Subscription } from 'rxjs';

const EVENTS_URL = '/api/events';

/** Espera antes de reconectar: crece al doble a cada intento fallido y se queda en medio minuto. */
const FIRST_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30_000;

/**
 * Primera espera antes de reconectar. Es un token para que los tests no tengan que esperar un segundo de verdad por
 * cada caída; en la aplicación vale `FIRST_RETRY_DELAY_MS`.
 */
export const EVENTS_FIRST_RETRY_DELAY_MS = new InjectionToken<number>(
  'EVENTS_FIRST_RETRY_DELAY_MS',
  { providedIn: 'root', factory: () => FIRST_RETRY_DELAY_MS },
);

/**
 * Canal de eventos del servidor (D9). Se lee con `HttpClient` (`observe: 'events'`, `responseType: 'text'`,
 * `reportProgress: true`) y **nunca con `EventSource`**: el guard de la API solo mira la cabecera `Authorization`, la
 * cookie de refresh está acotada a `/api/auth`, y un `EventSource` nativo no sabe mandar cabeceras, así que recibiría
 * `401` siempre. Un `fetch` a pelo tampoco vale: `HttpInterceptorFn` solo corre para `HttpClient`, de modo que se
 * quedaría sin token y sin renovarlo cuando caduca.
 *
 * El cuerpo llega a trozos y este servicio lo va cortando por bloques completos. El latido es un comentario SSE (una
 * línea que empieza por `:`) y se descarta sin más. Si el canal se cae, se reconecta con espera creciente; si no se
 * puede abrir, **no pasa nada visible**: la lista sigue mostrando lo que devolvió la API y se recarga al volver a la
 * pestaña.
 */
@Injectable({ providedIn: 'root' })
export class EventsChannel {
  private readonly http = inject(HttpClient);
  private readonly enriched = new Subject<LinkEnrichedMessage>();
  private readonly comments = new Subject<GroupLinkCommentsMessage>();

  private subscription: Subscription | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly firstRetryDelayMs = inject(EVENTS_FIRST_RETRY_DELAY_MS);
  /** Cuánto del cuerpo recibido ya se repartió: el trozo siguiente continúa donde acabó el anterior. */
  private consumed = 0;
  private closed = false;

  /** `true` mientras el canal está abierto. Solo informativo: la lista no depende de él para funcionar. */
  readonly connected = signal(false);

  /** Cuánto se esperará antes del próximo intento; se dobla a cada fallo y vuelve al principio al recibir datos. */
  readonly nextRetryDelayMs = signal(inject(EVENTS_FIRST_RETRY_DELAY_MS));

  /** Avisos de links enriquecidos, en el orden en que llegan. */
  readonly linkEnriched: Observable<LinkEnrichedMessage> = this.enriched.asObservable();

  /**
   * Avisos de comentarios publicados o borrados en un link de un grupo (D9 de group-comments). Solo llegan a los
   * miembros actuales de ese grupo, con el resumen de la tarjeta ya actualizado.
   */
  readonly groupLinkComments: Observable<GroupLinkCommentsMessage> = this.comments.asObservable();

  constructor() {
    // Apagado al destruirse el inyector: sin esto, una reconexión programada seguiría viva tras cerrar la aplicación.
    inject(DestroyRef).onDestroy(() => this.disconnect());
  }

  /** Abre el canal si no lo estaba. Llamarlo dos veces no abre dos conexiones. */
  connect(): void {
    this.closed = false;
    if (this.subscription !== null || this.reconnectTimer !== null) {
      return;
    }
    this.open();
  }

  /** Cierra el canal y cancela cualquier reconexión pendiente. */
  disconnect(): void {
    this.closed = true;
    this.clearReconnect();
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.connected.set(false);
  }

  private open(): void {
    this.consumed = 0;
    this.subscription = this.http
      .get(EVENTS_URL, { observe: 'events', responseType: 'text', reportProgress: true })
      .subscribe({
        next: (event) => {
          if (event.type === HttpEventType.DownloadProgress) {
            this.connected.set(true);
            this.nextRetryDelayMs.set(this.firstRetryDelayMs);
            this.consume(event.partialText ?? '');
            return;
          }
          if (event.type === HttpEventType.Response) {
            // El servidor cerró el flujo (un reinicio, un proxy): se vuelve a abrir como si se hubiera caído.
            this.reconnect();
          }
        },
        // Un canal que no se puede abrir no es un error de la pantalla: no hay nada que mostrar, solo que reintentar.
        error: () => this.reconnect(),
      });
  }

  private reconnect(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.connected.set(false);
    if (this.closed || this.reconnectTimer !== null) {
      return;
    }
    const delay = this.nextRetryDelayMs();
    this.nextRetryDelayMs.set(Math.min(delay * 2, MAX_RETRY_DELAY_MS));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) {
        this.open();
      }
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Reparte los bloques completos que hayan llegado. `partialText` es todo el cuerpo recibido hasta ahora, así que se
   * mira solo lo nuevo y se deja para la próxima vez el bloque que aún no termina.
   */
  private consume(text: string): void {
    const pending = text.slice(this.consumed);
    const blocks = pending.split(/\r?\n\r?\n/);
    const unfinished = blocks.pop() ?? '';
    this.consumed = text.length - unfinished.length;
    for (const block of blocks) {
      this.dispatch(block);
    }
  }

  private dispatch(block: string): void {
    let name = '';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      // Comentario SSE: es el latido, que existe para que ningún intermediario cierre el canal por silencio.
      if (line.startsWith(':') || line.length === 0) {
        continue;
      }
      const separator = line.indexOf(':');
      const field = separator === -1 ? line : line.slice(0, separator);
      const value = (separator === -1 ? '' : line.slice(separator + 1)).replace(/^ /, '');
      if (field === 'event') {
        name = value;
      } else if (field === 'data') {
        data.push(value);
      }
    }
    if (data.length === 0) {
      return;
    }
    if (name === LINK_ENRICHED_EVENT_NAME) {
      const message = parseMessage(data.join('\n'));
      if (message !== null) {
        this.enriched.next(message);
      }
    } else if (name === GROUP_LINK_COMMENTS_EVENT_NAME) {
      const message = parseCommentsMessage(data.join('\n'));
      if (message !== null) {
        this.comments.next(message);
      }
    }
  }
}

/**
 * Lee el cuerpo del evento. Se comprueba la forma con una guarda y no con zod a propósito: este servicio lo usan las
 * pantallas de links, y arrastrar zod aquí lo metería en el bundle inicial (mismo motivo que en `core/api/api-error.ts`
 * y en `core/links/links.api.ts`). Un mensaje que no se entiende se descarta: el listado sigue siendo la verdad.
 */
function parseMessage(data: string): LinkEnrichedMessage | null {
  const parsed = parseJson(data);
  if (typeof parsed !== 'object' || parsed === null || !('link' in parsed)) {
    return null;
  }
  const link: unknown = (parsed as { link: unknown }).link;
  if (typeof link !== 'object' || link === null || !('id' in link)) {
    return null;
  }
  return typeof (link as { id: unknown }).id === 'string' ? (parsed as LinkEnrichedMessage) : null;
}

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Un comentario del resumen: lo justo para pintarlo en la tarjeta y en el hilo sin romper la plantilla. */
function isComment(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value['author'])) {
    return false;
  }
  return (
    isNonEmptyString(value['id']) &&
    isNonEmptyString(value['author']['userId']) &&
    isNonEmptyString(value['author']['displayName']) &&
    typeof value['authorLeft'] === 'boolean' &&
    typeof value['text'] === 'string' &&
    isNonEmptyString(value['createdAt'])
  );
}

/**
 * Lee el aviso de comentarios con una guarda de forma, sin zod, por el mismo motivo que `parseMessage`. Comprueba lo que
 * el store y las plantillas usan: los identificadores, el tipo de cambio y el resumen (`count`, `revision`, `sharedAt` y
 * hasta dos comentarios). Lo que no encaja se descarta: la lista y el hilo siguen siendo la verdad.
 */
function parseCommentsMessage(data: string): GroupLinkCommentsMessage | null {
  const parsed = parseJson(data);
  if (!isRecord(parsed) || !isRecord(parsed['comments'])) {
    return null;
  }
  const summary = parsed['comments'];
  const latest = summary['latest'];
  const valid =
    isNonEmptyString(parsed['groupId']) &&
    isNonEmptyString(parsed['linkId']) &&
    isNonEmptyString(parsed['commentId']) &&
    (parsed['change'] === 'created' || parsed['change'] === 'deleted') &&
    isCount(summary['count']) &&
    isCount(summary['revision']) &&
    isNonEmptyString(summary['sharedAt']) &&
    Array.isArray(latest) &&
    latest.length <= 2 &&
    latest.every(isComment);
  return valid ? (parsed as GroupLinkCommentsMessage) : null;
}
