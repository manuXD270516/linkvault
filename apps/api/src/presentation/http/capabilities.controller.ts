import { Controller, Get, Header, Inject } from '@nestjs/common';
import {
  type CapabilitiesResponse,
  strictCapabilitiesResponseSchema,
} from '@linkvault/shared';
import type { ApiConfig } from '../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../infrastructure/config/app-config.module';
import { deriveCapabilities } from '../../infrastructure/config/capabilities';

/**
 * `GET /api/capabilities` (spec platform/capabilities): qué funciones opcionales tiene el despliegue. Con sesión (guard
 * global, sin marca de ruta abierta). La configuración no cambia sin reiniciar el proceso, así que el objeto se calcula una vez; el
 * `parse` estricto hace fallar el arranque si alguien le suma una clave que no es del contrato (D3). Sin caché HTTP.
 */
@Controller('capabilities')
export class CapabilitiesController {
  private readonly capabilities: CapabilitiesResponse;

  constructor(@Inject(APP_CONFIG) config: ApiConfig) {
    this.capabilities = strictCapabilitiesResponseSchema.parse(
      deriveCapabilities(config),
    );
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(): CapabilitiesResponse {
    return this.capabilities;
  }
}
