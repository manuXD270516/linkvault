import { Module } from '@nestjs/common';
import { EventStreamRegistry } from './event-stream.registry';

/**
 * Conexiones abiertas del canal de eventos, una sola instancia por proceso (D9 de link-enrichment). Es plataforma, como
 * el outbox: lo exporta para que el módulo que reparte avisos —`links`— pueda enviar sin saber de HTTP, y para que el
 * controlador del canal pueda registrar las suyas sin saber de links.
 */
@Module({
  providers: [EventStreamRegistry],
  exports: [EventStreamRegistry],
})
export class RealtimeModule {}
