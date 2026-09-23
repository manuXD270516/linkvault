import { z } from 'zod';

// Contratos HTTP de discovery (ADR-043 / change job-discovery, D2).
// `pageSize` es el cap de hits **por board**; con `board=all` la respuesta puede tener hasta 2×pageSize.

/** Boards v1 + agregador. */
export const DISCOVERY_BOARDS = ['getonboard', 'remoteok', 'all'] as const;
export const discoveryBoardSchema = z.enum(DISCOVERY_BOARDS);
export type DiscoveryBoard = z.infer<typeof discoveryBoardSchema>;

/** Boards con adapter (sin `all`). */
export const DISCOVERY_BOARD_IDS = ['getonboard', 'remoteok'] as const;
export const discoveryBoardIdSchema = z.enum(DISCOVERY_BOARD_IDS);
export type DiscoveryBoardId = z.infer<typeof discoveryBoardIdSchema>;

/** Motivos cerrados de degradación parcial (D2). */
export const DISCOVERY_DEGRADE_REASONS = [
  'timeout',
  'upstream_429',
  'upstream_5xx',
  'egress_limited',
  'network',
] as const;
export const discoveryDegradeReasonSchema = z.enum(DISCOVERY_DEGRADE_REASONS);
export type DiscoveryDegradeReason = z.infer<
  typeof discoveryDegradeReasonSchema
>;

/** Cap duro de hits por board en la respuesta. */
export const DISCOVERY_PAGE_SIZE_MAX = 20;

/** Tamaño de página por defecto. */
export const DISCOVERY_PAGE_SIZE_DEFAULT = 10;

/** Página mínima / default. */
export const DISCOVERY_PAGE_DEFAULT = 1;

/**
 * Hit listo para guardar vía `POST /api/links`. `url` SHALL ser canónica para el registry
 * (round-trip `canonicalize`).
 */
export const discoveryHitSchema = z.strictObject({
  board: discoveryBoardIdSchema,
  title: z.string().min(1),
  company: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  url: z.string().url(),
  externalJobId: z.string().min(1).optional(),
  salaryText: z.string().min(1).optional(),
});
export type DiscoveryHit = z.infer<typeof discoveryHitSchema>;

/** Entrada de `degraded[]` cuando un board falla sin tumbar la respuesta. */
export const discoveryDegradedSchema = z.strictObject({
  board: discoveryBoardIdSchema,
  reason: discoveryDegradeReasonSchema,
});
export type DiscoveryDegraded = z.infer<typeof discoveryDegradedSchema>;

/** Respuesta de `GET /api/discovery/search`. */
export const discoverySearchResponseSchema = z.strictObject({
  results: z.array(discoveryHitSchema),
  degraded: z.array(discoveryDegradedSchema).optional(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(DISCOVERY_PAGE_SIZE_MAX),
});
export type DiscoverySearchResponse = z.infer<
  typeof discoverySearchResponseSchema
>;

/**
 * Query params tipados para `ZodValidationPipe` en `GET /api/discovery/search`.
 * `q` vacío es válido (D2): GoB omite `query`; Remote OK filtra en proceso.
 */
export const discoverySearchQuerySchema = z.strictObject({
  q: z.string().default(''),
  board: discoveryBoardSchema.default('all'),
  page: z.coerce
    .number()
    .int()
    .min(1)
    .default(DISCOVERY_PAGE_DEFAULT),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(DISCOVERY_PAGE_SIZE_MAX)
    .default(DISCOVERY_PAGE_SIZE_DEFAULT),
});
export type DiscoverySearchQuery = z.infer<typeof discoverySearchQuerySchema>;
