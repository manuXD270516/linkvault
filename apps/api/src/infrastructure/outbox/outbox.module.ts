import { Module } from '@nestjs/common';
import { OUTBOX } from '../../modules/links/application/ports/outbox.port';
import { MongoOutbox } from './mongo-outbox';
import { OUTBOX_CLOCK } from './outbox-clock.port';
import { SystemOutboxClock } from './system-outbox-clock';

/**
 * Escritura del outbox (D6 de job-links). Se importa siempre: escribir el evento es parte de la transacción del alta y
 * no depende de que el relay esté encendido. Usa la conexión Mongoose por defecto de la app, así que quien lo importe
 * debe registrar `MongooseModule.forRoot*`.
 */
@Module({
  providers: [
    { provide: OUTBOX_CLOCK, useClass: SystemOutboxClock },
    MongoOutbox,
    { provide: OUTBOX, useExisting: MongoOutbox },
  ],
  exports: [OUTBOX, OUTBOX_CLOCK, MongoOutbox],
})
export class OutboxModule {}
