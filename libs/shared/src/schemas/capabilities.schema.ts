import { z } from 'zod';

/**
 * Cuerpo de `GET /api/capabilities` visto por el cliente (spec platform/capabilities). No es estricto a propósito:
 * zod descarta las claves desconocidas, de modo que añadir una capacidad nueva en la API no rompe un SPA ya cargado.
 */
export const capabilitiesResponseSchema = z.object({
  search: z.boolean(),
  discovery: z.boolean(),
});
export type CapabilitiesResponse = z.infer<typeof capabilitiesResponseSchema>;

/**
 * Lo mismo en modo estricto, para la API: la respuesta no puede llevar ninguna clave de más (un host, una clave, un
 * nombre de proveedor), y construirla con este schema lo hace fallar en vez de filtrarlo.
 */
export const strictCapabilitiesResponseSchema =
  capabilitiesResponseSchema.strict();
