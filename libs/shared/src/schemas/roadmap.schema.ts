import { z } from 'zod';
import { missingSkillSchema, skillImportanceSchema } from './match.schema';

// Contratos del roadmap de estudio (study-roadmap, design-v0.2 §4.7): plan por habilidad faltante con
// recursos tipados. `verified` es honesto solo tras el post-proceso que ancla al catálogo curado.

/** Tipos de recurso admitidos en el roadmap y en el catálogo. */
export const roadmapResourceTypeSchema = z.enum([
  'course',
  'post',
  'book',
  'doc',
  'video',
]);
export type RoadmapResourceType = z.infer<typeof roadmapResourceTypeSchema>;

/** Recurso de estudio (salida de `build-roadmap` y documento persistido). */
export const roadmapResourceSchema = z.strictObject({
  type: roadmapResourceTypeSchema,
  title: z.string().min(1),
  url: z.string().url().nullable(),
  provider: z.string().min(1),
  free: z.boolean(),
  verified: z.boolean(),
});
export type RoadmapResource = z.infer<typeof roadmapResourceSchema>;

/** Ítem del plan: una habilidad priorizada con estimación y recursos. */
export const roadmapItemSchema = z.strictObject({
  skill: z.string().min(1),
  priority: z.number().int().min(1).max(5),
  estimatedWeeks: z.number().positive(),
  resources: z.array(roadmapResourceSchema).min(1),
});
export type RoadmapItem = z.infer<typeof roadmapItemSchema>;

/** Salida estructurada de `build-roadmap`. */
export const roadmapSchema = z.strictObject({
  items: z.array(roadmapItemSchema),
});
export type Roadmap = z.infer<typeof roadmapSchema>;

/** Tope del título de vacante en el input (mismo orden de magnitud que match-cv). */
export const BUILD_ROADMAP_TITLE_MAX_LENGTH = 200;

const buildRoadmapJobSkillSchema = z.strictObject({
  name: z.string().min(1).max(80),
  importance: skillImportanceSchema,
});

/**
 * Entrada de `build-roadmap`: habilidades faltantes priorizables + contexto mínimo de la vacante
 * (sin texto completo del CV).
 */
export const buildRoadmapInputSchema = z.strictObject({
  missingSkills: z.array(missingSkillSchema).min(1),
  job: z.strictObject({
    title: z.string().min(1).max(BUILD_ROADMAP_TITLE_MAX_LENGTH),
    skills: z.array(buildRoadmapJobSkillSchema).max(60),
  }),
});
export type BuildRoadmapInput = z.infer<typeof buildRoadmapInputSchema>;

/**
 * Post-proceso de `verified`: solo los recursos que `isCatalogHit` reconoce quedan `true`.
 * El modelo no puede mentir la marca; quien llama aporta el criterio de hit (catálogo).
 */
export function enforceRoadmapVerified(
  roadmap: Roadmap,
  isCatalogHit: (
    skill: string,
    resource: Omit<RoadmapResource, 'verified'>,
  ) => boolean,
): Roadmap {
  return {
    items: roadmap.items.map((item) => ({
      ...item,
      resources: item.resources.map((resource) => {
        const { verified: _ignored, ...candidate } = resource;
        return {
          ...resource,
          verified: isCatalogHit(item.skill, candidate),
        };
      }),
    })),
  };
}

/** Estados persistidos del documento `roadmaps` (claim-before-run). */
export const ROADMAP_STATUSES = ['generating', 'ready', 'failed'] as const;
export const roadmapStatusSchema = z.enum(ROADMAP_STATUSES);
export type RoadmapStatus = z.infer<typeof roadmapStatusSchema>;

/**
 * Cuerpo de `POST`/`GET /api/analyses/:analysisId/roadmap`.
 * `items` solo cuando `status === 'ready'`.
 */
export const roadmapResponseSchema = z
  .strictObject({
    roadmapId: z.string().min(1),
    analysisId: z.string().min(1),
    status: roadmapStatusSchema,
    items: z.array(roadmapItemSchema).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.status === 'ready') {
      if (body.items === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['items'],
          message: 'A ready roadmap must carry items',
        });
      }
    } else if (body.items !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Only a ready roadmap carries items',
      });
    }
  });
export type RoadmapResponse = z.infer<typeof roadmapResponseSchema>;

/** Aceptación de un claim nuevo (`202`). */
export const roadmapAcceptedSchema = z.strictObject({
  roadmapId: z.string().min(1),
  status: z.literal('generating'),
});
export type RoadmapAccepted = z.infer<typeof roadmapAcceptedSchema>;
