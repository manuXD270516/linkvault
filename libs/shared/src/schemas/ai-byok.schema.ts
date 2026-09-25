import { z } from 'zod';

// Claves BYOK por vendor (change ai-byok, ADR-032). Vistas HTTP sin plaintext ni ciphertext.
//
// POR DÓNDE VIAJA LA DISPONIBILIDAD (ADR-048 §6-ter, decisión humana A1). La interfaz necesita distinguir «no
// forzamos data_collection: deny» de «este vendor no está disponible en esta instancia», y la spec de `web/byok` le
// prohíbe deducirlo: el estado tiene que llegarle de la respuesta del API de claves. Había dos salidas posibles y se
// eligió **ampliar este contrato** —`available` en la vista y `vendors` en la respuesta del listado— en vez de abrir
// un endpoint de configuración de IA pública. El motivo largo, con la alternativa descartada, está en ADR-048 §6-ter.
// Lo que importa aquí: mientras este sea el único sitio por el que sale el dato, no hay dos verdades que puedan
// divergir. Añadir otra vía para lo mismo rompería justamente eso.
//
// El conjunto de campos es CERRADO (`ai/data-protection`, «Secretos BYOK fuera de logs y respuestas»): todos los
// objetos de este fichero son `strictObject` a propósito, y `available` es un booleano pelado. Ni el modelo, ni el
// motivo, ni qué valor de configuración falta: eso sería revelar la configuración del servidor por el camino.

/** Vendors admitidos para una clave BYOK. */
export const AI_VENDORS = ['anthropic', 'openai', 'openrouter'] as const;
export const aiVendorSchema = z.enum(AI_VENDORS);
export type AiVendor = z.infer<typeof aiVendorSchema>;

/** Longitud mínima de `apiKey` en el PUT (spec ai/byok). */
export const AI_BYOK_API_KEY_MIN_LENGTH = 16;

/** Cuerpo de `PUT /api/users/me/ai-keys/:vendor`. */
export const upsertAiKeyRequestSchema = z.strictObject({
  apiKey: z.string().min(AI_BYOK_API_KEY_MIN_LENGTH),
});
export type UpsertAiKeyRequest = z.infer<typeof upsertAiKeyRequestSchema>;

/**
 * Disponibilidad de un vendor: si el servidor **puede construir hoy** ese proveedor con su configuración.
 *
 * Es un hecho sobre la configuración de la instancia, no sobre la clave de nadie: no se deriva de que haya clave
 * guardada, de que se pueda descifrar, del vault ni del consentimiento externo (spec `ai/byok`). El par es cerrado a
 * propósito; un campo con el motivo diría qué le falta al servidor.
 */
export const aiVendorAvailabilitySchema = z.strictObject({
  vendor: aiVendorSchema,
  available: z.boolean(),
});
export type AiVendorAvailability = z.infer<typeof aiVendorAvailabilitySchema>;

/** Vista de una clave guardada: solo hint, metadatos y disponibilidad del vendor. */
export const aiKeyViewSchema = z.strictObject({
  vendor: aiVendorSchema,
  keyHint: z.string().length(4),
  updatedAt: z.iso.datetime(),
  available: z.boolean(),
});
export type AiKeyView = z.infer<typeof aiKeyViewSchema>;

/**
 * Cobertura exacta y sin repetidos de `AI_VENDORS`.
 *
 * Si `vendors` pudiera venir a medias, el cliente tendría que decidir qué significa un vendor ausente —¿disponible,
 * indisponible, desconocido?—, que es exactamente la deducción que `web/byok` le prohíbe. Se valida aquí, en el
 * contrato, para que ni el productor ni el consumidor tengan que acordarlo de palabra.
 */
export function coversEveryAiVendorExactlyOnce(
  entries: readonly { vendor: AiVendor }[],
): boolean {
  const seen = new Set(entries.map((entry) => entry.vendor));
  return seen.size === entries.length && AI_VENDORS.every((v) => seen.has(v));
}

/**
 * Respuesta de `GET /api/users/me/ai-keys`.
 *
 * `keys` sigue conteniendo **solo las claves guardadas** —no se fabrica una vista donde no hay clave—, y `vendors`
 * informa de los tres vendors soportados, tengan clave o no: la pantalla pinta un bloque por vendor y necesita el
 * estado también para los que están sin configurar.
 */
export const listAiKeysResponseSchema = z.strictObject({
  keys: z.array(aiKeyViewSchema),
  vendors: z
    .array(aiVendorAvailabilitySchema)
    .refine(coversEveryAiVendorExactlyOnce, {
      message:
        'vendors debe traer exactamente una entrada por cada vendor soportado, sin repetidos ni ausentes',
    }),
});
export type ListAiKeysResponse = z.infer<typeof listAiKeysResponseSchema>;
