import { z } from 'zod';

// Contratos HTTP de búsqueda híbrida (change search, D7). La SPA V0 no envía `mode` (siempre hybrid por
// defecto en API) ni filtros de modality/status; esos parámetros existen en API para tests/debug.

/** Tipos de documento del índice unificado `lv_content` (D2). */
export const SEARCH_DOC_TYPES = [
  'job_preview',
  'application',
  'group_comment',
  'group_link_note',
  'cv',
  'roadmap',
] as const;

export const searchDocTypeSchema = z.enum(SEARCH_DOC_TYPES);
export type SearchDocType = z.infer<typeof searchDocTypeSchema>;

/** Modos de consulta que acepta la API (SPA V0 no los expone; default hybrid). */
export const SEARCH_MODES = ['hybrid', 'fulltext', 'semantic'] as const;
export const searchModeSchema = z.enum(SEARCH_MODES);
export type SearchMode = z.infer<typeof searchModeSchema>;

/** Motivos estables de degradación hybrid → full-text (spec search/query). */
export const SEARCH_DEGRADE_REASONS = ['embeddings_unavailable'] as const;
export const searchDegradeReasonSchema = z.enum(SEARCH_DEGRADE_REASONS);
export type SearchDegradeReason = z.infer<typeof searchDegradeReasonSchema>;

/** Límite máximo de hits por página; la API clampa valores mayores (C7). */
export const SEARCH_LIMIT_MAX = 50;

/** Límite por defecto cuando el cliente no envía `limit`. */
export const SEARCH_LIMIT_DEFAULT = 20;

/**
 * Hit de búsqueda con identificadores de navegación opcionales según `docType`.
 * `title` es la etiqueta principal; `snippet` es extracto/highlight seguro (puede ser vacío).
 */
export const searchHitSchema = z.strictObject({
  id: z.string().min(1),
  docType: searchDocTypeSchema,
  title: z.string(),
  snippet: z.string().optional(),
  score: z.number(),
  linkId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  applicationId: z.string().min(1).optional(),
  cvId: z.string().min(1).optional(),
  roadmapId: z.string().min(1).optional(),
  /** Necesario para `/plan/:analysisId` cuando `docType` es `roadmap`. */
  analysisId: z.string().min(1).optional(),
});
export type SearchHit = z.infer<typeof searchHitSchema>;

/** Respuesta de `GET /api/search`. */
export const searchResponseSchema = z.strictObject({
  hits: z.array(searchHitSchema),
  degraded: z.boolean().optional(),
  degradeReason: searchDegradeReasonSchema.optional(),
  limit: z.number().int().min(1).max(SEARCH_LIMIT_MAX),
  offset: z.number().int().min(0),
  estimatedTotal: z.number().int().min(0).optional(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

/**
 * Query params tipados para el cliente. `mode` es opcional en API; la SPA V0 **no** lo envía.
 * `q` no vacío lo impone el servidor (`400 empty_query`).
 */
export const searchQueryParamsSchema = z.strictObject({
  q: z.string(),
  docType: searchDocTypeSchema.optional(),
  groupId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(SEARCH_LIMIT_MAX).optional(),
  offset: z.number().int().min(0).optional(),
  mode: searchModeSchema.optional(),
});
export type SearchQueryParams = z.infer<typeof searchQueryParamsSchema>;
