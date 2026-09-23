import { z } from 'zod';
import {
  LINK_CURSOR_INPUT_MAX_LENGTH,
  LINK_PAGE_DEFAULT_LIMIT,
  LINK_PAGE_MAX_LIMIT,
} from './link.schema';

// Contratos de tags y pinned en la relación grupo↔link (D3–D5 de group-link-tags-pinned).
// Normalización compartida entre PUT y el filtro `?tag=` del listado de grupo.

/** Máximo de tags distintos tras normalizar (D3). */
export const GROUP_LINK_TAG_MAX_COUNT = 8;

/**
 * Forma de un tag ya normalizado: empieza en alfanumérico; luego alfanuméricos, guiones o espacios;
 * máximo 32 caracteres en total (D3).
 */
export const GROUP_LINK_TAG_PATTERN = /^[a-z0-9][a-z0-9\- ]{0,31}$/;

/**
 * Un tag listo para medir y guardar: trim, minúsculas y espacios internos colapsados. Idempotente.
 * Las cadenas vacías tras trim se descartan en `normalizeGroupLinkTags`, no aquí.
 */
export function normalizeGroupLinkTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Array de tags listo para caps y regex: vacíos fuera, dedupe preservando la primera aparición.
 * No aplica el tope de 8 ni el patrón: eso lo juzga el schema (400 si falla).
 */
export function normalizeGroupLinkTags(tags: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = normalizeGroupLinkTag(raw);
    if (tag.length === 0 || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

/** Un tag ya normalizado que cumple el patrón. */
const normalizedGroupLinkTagSchema = z
  .string()
  .transform(normalizeGroupLinkTag)
  .pipe(z.string().min(1).regex(GROUP_LINK_TAG_PATTERN));

/**
 * Body de `PUT .../tags`: reemplaza el array completo (`$set`). Vacío (o solo vacíos) = quitar todos.
 * Caps y patrón se aplican **después** de normalizar.
 */
export const setGroupLinkTagsRequestSchema = z.strictObject({
  tags: z
    .array(z.string())
    .transform(normalizeGroupLinkTags)
    .superRefine((tags, context) => {
      if (tags.length > GROUP_LINK_TAG_MAX_COUNT) {
        context.addIssue({
          code: 'custom',
          message: `At most ${GROUP_LINK_TAG_MAX_COUNT} tags`,
        });
        return;
      }
      for (const [index, tag] of tags.entries()) {
        if (!GROUP_LINK_TAG_PATTERN.test(tag)) {
          context.addIssue({
            code: 'custom',
            path: [index],
            message: 'Invalid tag',
          });
        }
      }
    }),
});
export type SetGroupLinkTagsRequest = z.infer<
  typeof setGroupLinkTagsRequestSchema
>;

/** Respuesta `200` slim del replace de tags (ya normalizados). */
export const setGroupLinkTagsResponseSchema = z.strictObject({
  tags: z.array(z.string()),
});
export type SetGroupLinkTagsResponse = z.infer<
  typeof setGroupLinkTagsResponseSchema
>;

/** Body de `PUT .../pinned`: fijar o desfijar. */
export const setGroupLinkPinnedRequestSchema = z.strictObject({
  pinned: z.boolean(),
});
export type SetGroupLinkPinnedRequest = z.infer<
  typeof setGroupLinkPinnedRequestSchema
>;

/** Respuesta `200` slim del toggle de pinned. */
export const setGroupLinkPinnedResponseSchema = z.strictObject({
  pinned: z.boolean(),
});
export type SetGroupLinkPinnedResponse = z.infer<
  typeof setGroupLinkPinnedResponseSchema
>;

/**
 * Query del listado de un grupo (D5). Schema **aparte** del privado: `pinned`/`tag` no entran en
 * `listLinksQuerySchema`. `pinned` es enum de strings — **prohibido** `z.coerce.boolean()` (`"false"` → true).
 * `tag` se normaliza igual que en el PUT.
 */
export const listGroupLinksQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LINK_PAGE_MAX_LIMIT)
    .default(LINK_PAGE_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(LINK_CURSOR_INPUT_MAX_LENGTH).optional(),
  pinned: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  tag: normalizedGroupLinkTagSchema.optional(),
});
export type ListGroupLinksQuery = z.infer<typeof listGroupLinksQuerySchema>;
