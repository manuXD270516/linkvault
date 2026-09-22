import { z } from 'zod';

// Claves BYOK por vendor (change ai-byok, ADR-032). Vistas HTTP sin plaintext ni ciphertext.

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

/** Vista de una clave guardada: solo hint y metadatos. */
export const aiKeyViewSchema = z.strictObject({
  vendor: aiVendorSchema,
  keyHint: z.string().length(4),
  updatedAt: z.iso.datetime(),
});
export type AiKeyView = z.infer<typeof aiKeyViewSchema>;

/** Respuesta de `GET /api/users/me/ai-keys`. */
export const listAiKeysResponseSchema = z.strictObject({
  keys: z.array(aiKeyViewSchema),
});
export type ListAiKeysResponse = z.infer<typeof listAiKeysResponseSchema>;
