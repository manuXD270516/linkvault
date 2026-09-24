import type { AiVendor } from '@linkvault/shared';
import type { ByokProviderConfig } from '../config/ai-config.schema';
import { isOpenRouterModelUsable } from '../config/ai-config.schema';

// UN SOLO PREDICADO DE DISPONIBILIDAD (ADR-048 §6-ter, tarea 10-bis.3 del change deploy-image-verification).
//
// Quien decide si un vendor BYOK es construible es `ByokProviderFactory.buildProvider`. La misma pregunta la hace
// ahora la API para poblar el `available` del contrato de `libs/shared`, y la haría el SPA si se lo permitiéramos.
// Tres sitios respondiendo lo mismo por su cuenta son tres verdades que divergen el día que una cambie: la regla
// nueva entra en una y las otras dos se quedan mintiendo, que es el patrón que este change persigue entero.
//
// Por eso: esto **envuelve**, no copia. La condición de OpenRouter sigue viviendo en `isOpenRouterModelUsable`
// (`ai-config.schema.ts`), que es también quien la consulta `parseAiConfig` para emitir el aviso de arranque.

/**
 * Consulta de disponibilidad por vendor, ya atada a la configuración de la instancia.
 *
 * Es lo que el `AiModule` publica bajo el token `BYOK_VENDOR_AVAILABILITY`, para que la API no tenga que leer
 * `AiConfig.byok` por su cuenta ni volver a interpretarla.
 */
export type ByokVendorAvailability = (vendor: AiVendor) => boolean;

/**
 * ¿Puede el servidor construir hoy el proveedor BYOK de este vendor con esta configuración?
 *
 * Describe **lo que la factory hace**, no lo que convendría que hiciera: `anthropic` y `openai` se construyen
 * siempre con lo que traiga su bloque de configuración, así que aquí valen `true` sin más condición. Si algún día
 * uno de los dos gana la suya, entra aquí y la factory la hereda por llamarla, en vez de aparecer solo en un lado.
 *
 * Es un hecho sobre la configuración del servidor: no mira claves guardadas, ni el vault, ni el consentimiento
 * externo. Esas tres condiciones se suman a esta en `providersFor`, y ninguna la sustituye (spec `ai/byok`).
 */
export function isByokVendorConfigUsable(
  vendor: AiVendor,
  config: ByokProviderConfig,
): boolean {
  switch (vendor) {
    case 'anthropic':
    case 'openai':
      return true;
    case 'openrouter':
      // Invariante de `ai/byok` («OpenRouter BYOK y data_collection») y ADR-048 §6: sin modelo utilizable el
      // proveedor no se construye, porque construirlo mandaría texto de CV con `data_collection: omit`.
      return isOpenRouterModelUsable(config.openrouterModel);
    default: {
      const _exhaustive: never = vendor;
      return _exhaustive;
    }
  }
}

/** Ata el predicado a una configuración concreta. */
export function byokVendorAvailabilityOf(
  config: ByokProviderConfig,
): ByokVendorAvailability {
  return (vendor) => isByokVendorConfigUsable(vendor, config);
}
