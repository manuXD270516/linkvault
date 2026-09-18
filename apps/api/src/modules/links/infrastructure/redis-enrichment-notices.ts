import {
  LINK_ENRICHED_CHANNEL,
  linkEnrichedEventSchema,
  type LinkEnrichedPayload,
} from '@linkvault/shared';
import { Logger } from '@nestjs/common';
import type { EnrichmentNotices } from '../application/ports/enrichment-notices.port';

// Adaptador ENRICHMENT_NOTICES sobre un canal de Redis (D9). Necesita **su propia conexión**: un cliente en modo
// suscripción no acepta comandos, así que no se puede compartir con el que cuenta intentos.
//
// La conexión se abre aquí, y a propósito: el cliente es `lazyConnect` y no encola comandos mientras no hay socket, así
// que suscribirse sin conectar antes se rechaza en el acto y el canal queda muerto sin que nadie lo note (los previews
// se escriben igual; lo único que no pasa es que una pantalla abierta se entere sola).
//
// Lo que llega por el canal se valida contra el contrato antes de tocar nada: por ahí puede aparecer cualquier cosa, y
// un mensaje que no cumple se descarta con un aviso sin cuerpo. Nunca se registra el contenido del mensaje.

/**
 * Lo que el adaptador necesita de un cliente Redis suscriptor. Se declara aquí, y no como un `Pick` de `Redis`, para
 * dejar dicho exactamente qué se usa y para que un doble de test no tenga que fingir las 450 propiedades de ioredis.
 */
export interface RedisSubscriber {
  /** Estado de la conexión tal y como lo publica ioredis; `wait` es "creada y todavía sin conectar" (`lazyConnect`). */
  readonly status: string;
  connect(): Promise<unknown>;
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  on(
    event: 'message',
    listener: (channel: string, message: string) => void,
  ): unknown;
  on(event: 'ready', listener: () => void): unknown;
  off(
    event: 'message',
    listener: (channel: string, message: string) => void,
  ): unknown;
  off(event: 'ready', listener: () => void): unknown;
}

/** Lo que el adaptador necesita de un logger; `Logger` de Nest lo cumple. */
export interface EnrichmentNoticesLogger {
  warn(message: string): void;
}

export class RedisEnrichmentNotices implements EnrichmentNotices {
  private warned = false;

  constructor(
    private readonly client: RedisSubscriber,
    private readonly logger: EnrichmentNoticesLogger = new Logger(
      RedisEnrichmentNotices.name,
    ),
  ) {}

  async subscribe(
    handler: (payload: LinkEnrichedPayload) => Promise<void>,
  ): Promise<() => Promise<void>> {
    const onMessage = (channel: string, message: string): void => {
      if (channel !== LINK_ENRICHED_CHANNEL) {
        return;
      }
      void this.deliver(message, handler);
    };
    // Cada vez que la conexión queda lista se vuelve a pedir el canal. ioredis reintenta conectar por su cuenta, pero
    // al reconectar solo reenvía las suscripciones que llegó a aceptar: si Redis no estaba al arrancar no hay ninguna,
    // y sin esto el canal no se recuperaría nunca. Pedir dos veces el mismo canal no cuesta nada.
    const onReady = (): void => {
      void this.listenOnChannel();
    };
    this.client.on('message', onMessage);
    this.client.on('ready', onReady);
    await this.open();
    return async () => {
      this.client.off('message', onMessage);
      this.client.off('ready', onReady);
      await this.client.unsubscribe(LINK_ENRICHED_CHANNEL);
    };
  }

  /**
   * Abre la conexión, porque el `SUBSCRIBE` va **después** de tenerla: con `lazyConnect` y sin cola de comandos,
   * suscribirse sin conexión se rechaza antes de que exista el socket, y eso dejaba el canal muerto en el arranque.
   *
   * **No se espera a que conecte.** Quien llama a esto es el arranque de `api`, y un Redis que acepta la conexión y no
   * contesta nunca dejaría el proceso colgado aquí para siempre; uno que no está tampoco puede retrasar el arranque.
   * El canal se pide en `ready`, que es donde se sabe que la conexión sirve, y por eso da igual cuánto tarde en llegar.
   */
  private async open(): Promise<void> {
    if (this.client.status === 'ready') {
      // Conexión ya en pie: nadie va a emitir `ready` por nosotros.
      await this.listenOnChannel();
      return;
    }
    if (this.client.status === 'wait') {
      // `wait` es el único estado desde el que se puede conectar: conectando, conectado o reintentando, `connect()`
      // contestaría "Redis is already connecting/connected", y un cliente ya cerrado a propósito (`end`) se queda
      // cerrado. En todos esos casos el canal se pide, o no, en el `ready` que llegue.
      this.client.connect().catch((error: unknown) => this.warnOnce(error));
    }
  }

  /** Pide el canal. Tampoco lanza: quien arranca solo necesita saber que no lo tiene, no morirse por ello. */
  private async listenOnChannel(): Promise<void> {
    try {
      await this.client.subscribe(LINK_ENRICHED_CHANNEL);
      // Vuelve a haber canal: la próxima racha sin él sí merece su renglón.
      this.warned = false;
    } catch (error) {
      this.warnOnce(error);
    }
  }

  /** Un aviso por racha: sin esto, cada reintento de ioredis escribiría el suyo. */
  private warnOnce(error: unknown): void {
    if (this.warned) {
      return;
    }
    this.warned = true;
    const name = error instanceof Error ? error.name : 'UnknownError';
    this.logger.warn(
      `Could not subscribe to enrichment notices (${name}); open screens will not update on their own until Redis is back`,
    );
  }

  private async deliver(
    message: string,
    handler: (payload: LinkEnrichedPayload) => Promise<void>,
  ): Promise<void> {
    const parsed = this.parse(message);
    if (parsed === null) {
      return;
    }
    try {
      await handler(parsed);
    } catch (error) {
      // Un fallo repartiendo no puede tirar la suscripción: el estado verdadero sigue en la base de datos.
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Could not deliver a link enriched notice (${name})`);
    }
  }

  /** `null` si el mensaje no es un aviso válido. No se registra su contenido. */
  private parse(message: string): LinkEnrichedPayload | null {
    let body: unknown;
    try {
      body = JSON.parse(message);
    } catch {
      this.logger.warn('Discarded a notice that is not valid JSON');
      return null;
    }
    const event = linkEnrichedEventSchema.safeParse(body);
    if (!event.success) {
      this.logger.warn('Discarded a notice that does not match its contract');
      return null;
    }
    return event.data.payload;
  }
}
