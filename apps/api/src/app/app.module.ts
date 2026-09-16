import { Module } from '@nestjs/common';
import { SharedProbe } from '@linkvault/shared';

// Sonda temporal (tarea 3.5 de bootstrap-monorepo): fuerza a que el build resuelva el alias
// @linkvault/shared. Se elimina junto con SharedProbe cuando llegue el primer contrato real.
export const SHARED_ALIAS_PROBE: SharedProbe = SharedProbe.Resolved;

@Module({})
export class AppModule {}
