import { z } from 'zod';
import { matchStepSchema } from '../match/match-steps';

// Contratos HTTP del análisis de encaje (D1, D6, D7; specs/cv/match). El informe se valida antes de guardarse y
// antes de devolverse. El cuerpo del POST es plano; el GET reparte `latest` y `running` en dos bloques que nunca se
// mezclan.

/** Tope de sugerencias por informe. La pantalla puede mostrar menos de entrada; el contrato sigue siendo doce. */
export const MATCH_SUGGESTIONS_MAX = 12;

/** Único texto del CV persistido fuera de `cv_documents`: el fragmento de evidencia, acotado. */
export const MATCH_CV_FRAGMENT_MAX_CHARS = 300;

/** Peso de un requisito de la vacante: lo que descalifica frente a lo que suma. */
export const skillImportanceSchema = z.enum(['must', 'nice']);
export type SkillImportance = z.infer<typeof skillImportanceSchema>;

/** Habilidad pedida que no está en el CV. */
export const missingSkillSchema = z.strictObject({
  name: z.string().min(1),
  importance: skillImportanceSchema,
});
export type MissingSkill = z.infer<typeof missingSkillSchema>;

/**
 * Evidencia de una sugerencia. Sin `importance` el orden que promete la pantalla no tiene de dónde salir y **no se
 * adivina** por correspondencia de nombre con `missingSkills`.
 */
export const suggestionEvidenceSchema = z.strictObject({
  jobRequirement: z.string().min(1),
  importance: skillImportanceSchema,
  cvFragment: z.string().max(MATCH_CV_FRAGMENT_MAX_CHARS).nullable(),
});
export type SuggestionEvidence = z.infer<typeof suggestionEvidenceSchema>;

/**
 * Sugerencia de edición del CV: sección a la que se refiere, texto propuesto (`after`), motivo y evidencia.
 * `after` es el nombre del campo (D10): es el texto que la persona puede copiar.
 */
export const matchSuggestionSchema = z.strictObject({
  section: z.string().min(1),
  after: z.string().min(1),
  reason: z.string().min(1),
  evidence: suggestionEvidenceSchema,
});
export type MatchSuggestion = z.infer<typeof matchSuggestionSchema>;

/**
 * Núcleo del informe —lo que produce la tarea `match-cv`— sin marcas de degradación. Quien guarda añade `degraded` y
 * su motivo a partir del `AiResult`.
 */
export const matchReportCoreSchema = z.strictObject({
  score: z.number().int().min(0).max(100),
  matchedSkills: z.array(z.string().min(1)),
  missingSkills: z.array(missingSkillSchema),
  suggestions: z.array(matchSuggestionSchema).max(MATCH_SUGGESTIONS_MAX),
});
export type MatchReportCore = z.infer<typeof matchReportCoreSchema>;

/**
 * Motivos de degradación (D6, ADR-030 §3). Cuatro y solo cuatro: sin ellos la pantalla tendría que adivinar justo en
 * el caso que la persona puede arreglar (falta de consentimiento).
 */
export const MATCH_DEGRADED_REASONS = [
  'no_providers',
  'providers_failed',
  'quota_exceeded',
  'consent_required',
] as const;

export const matchDegradedReasonSchema = z.enum(MATCH_DEGRADED_REASONS);
export type MatchDegradedReason = z.infer<typeof matchDegradedReasonSchema>;

/**
 * Informe completo tal y como se guarda y se devuelve. `degraded: true` exige sugerencias vacías y motivo; la hora de
 * vuelta solo acompaña a la cuota de IA agotada.
 */
export const matchReportSchema = matchReportCoreSchema
  .extend({
    degraded: z.boolean(),
    degradedReason: matchDegradedReasonSchema.optional(),
    aiQuotaRetryAt: z.iso.datetime().optional(),
  })
  .superRefine((report, ctx) => {
    if (report.degraded) {
      if (report.suggestions.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['suggestions'],
          message: 'A degraded report must carry no suggestions',
        });
      }
      if (report.degradedReason === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['degradedReason'],
          message: 'A degraded report must carry its reason',
        });
      }
    } else {
      if (report.degradedReason !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['degradedReason'],
          message: 'Only a degraded report carries a reason',
        });
      }
      if (report.aiQuotaRetryAt !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['aiQuotaRetryAt'],
          message: 'Only a quota-exceeded degradation carries a retry instant',
        });
      }
    }

    if (report.degradedReason === 'quota_exceeded') {
      if (report.aiQuotaRetryAt === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['aiQuotaRetryAt'],
          message: 'quota_exceeded requires aiQuotaRetryAt',
        });
      }
    } else if (report.aiQuotaRetryAt !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['aiQuotaRetryAt'],
        message: 'aiQuotaRetryAt is only allowed with quota_exceeded',
      });
    }
  });
export type MatchReport = z.infer<typeof matchReportSchema>;

/** Cuerpo de `POST /api/links/:linkId/match`: solo `cvId` opcional. Un campo desconocido invalida. */
export const requestMatchRequestSchema = z.strictObject({
  cvId: z.string().min(1).optional(),
});
export type RequestMatchRequest = z.infer<typeof requestMatchRequestSchema>;

/**
 * Respuesta `202` del POST: cuerpo plano con identificadores y el paso inicial. Nunca lleva texto del CV, de la
 * oferta, del prompt ni credenciales.
 */
export const matchRequestAcceptedSchema = z.strictObject({
  analysisId: z.string().min(1),
  linkId: z.string().min(1),
  cvId: z.string().min(1),
  status: z.literal('running'),
  step: matchStepSchema,
  requestedAt: z.iso.datetime(),
});
export type MatchRequestAccepted = z.infer<typeof matchRequestAcceptedSchema>;

/** Código del fallo cuando el análisis terminó en `failed` (hoy solo averías de plataforma). */
export const matchFailureCodeSchema = z.enum(['internal_error']);
export type MatchFailureCode = z.infer<typeof matchFailureCodeSchema>;

/**
 * Bloque `latest` del GET: último análisis resuelto. `consentRequired` es obligatorio; `failureCode` solo con
 * `failed`; `report` solo con `done`; `aiQuotaRetryAt` solo cuando el informe degradó por cuota de IA. Nunca lleva
 * `maxAgeMs`: ese plazo solo rige mientras corre.
 */
export const matchLatestSchema = z
  .strictObject({
    analysisId: z.string().min(1),
    cvId: z.string().min(1),
    status: z.enum(['done', 'failed']),
    step: matchStepSchema,
    requestedAt: z.iso.datetime(),
    analyzedAt: z.iso.datetime(),
    stale: z.boolean(),
    cvChanged: z.boolean(),
    consentRequired: z.boolean(),
    failureCode: matchFailureCodeSchema.optional(),
    aiQuotaRetryAt: z.iso.datetime().optional(),
    report: matchReportSchema.optional(),
  })
  .superRefine((latest, ctx) => {
    if (latest.status === 'failed') {
      if (latest.failureCode === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['failureCode'],
          message: 'A failed analysis must carry its failure code',
        });
      }
      if (latest.report !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['report'],
          message: 'Only a done analysis carries a report',
        });
      }
      if (latest.aiQuotaRetryAt !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['aiQuotaRetryAt'],
          message: 'aiQuotaRetryAt only accompanies a quota-exceeded degradation',
        });
      }
    }

    if (latest.status === 'done') {
      if (latest.failureCode !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['failureCode'],
          message: 'Only a failed analysis carries a failure code',
        });
      }
      if (latest.report === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['report'],
          message: 'A done analysis must carry its report',
        });
      } else {
        const quotaRetry =
          latest.report.degraded &&
          latest.report.degradedReason === 'quota_exceeded';
        if (quotaRetry) {
          if (latest.aiQuotaRetryAt === undefined) {
            ctx.addIssue({
              code: 'custom',
              path: ['aiQuotaRetryAt'],
              message:
                'A quota-exceeded degradation must publish aiQuotaRetryAt on latest',
            });
          }
        } else if (latest.aiQuotaRetryAt !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['aiQuotaRetryAt'],
            message:
              'aiQuotaRetryAt only accompanies a quota-exceeded degradation',
          });
        }
      }
    }
  });
export type MatchLatest = z.infer<typeof matchLatestSchema>;

/**
 * Bloque `running` del GET: solo lo que existe mientras corre, más el plazo máximo antes de vencerse. Nada de
 * informe, consentimiento, código de fallo ni hora de vuelta: un análisis en curso no debe inventárselos.
 */
export const matchRunningSchema = z.strictObject({
  analysisId: z.string().min(1),
  cvId: z.string().min(1),
  status: z.literal('running'),
  step: matchStepSchema,
  requestedAt: z.iso.datetime(),
  /** Plazo (ms) antes de darse por vencido: el mismo que rige la lectura `failed` de un colgado. */
  maxAgeMs: z.number().int().positive(),
});
export type MatchRunning = z.infer<typeof matchRunningSchema>;

/**
 * Respuesta de `GET /api/links/:linkId/match`: dos bloques que nunca se mezclan. Sin ninguno de los dos la ruta
 * responde `404 analysis_not_found`; este schema describe el `200`.
 */
export const matchAnalysisResponseSchema = z.strictObject({
  linkId: z.string().min(1),
  latest: matchLatestSchema.optional(),
  running: matchRunningSchema.optional(),
});
export type MatchAnalysisResponse = z.infer<typeof matchAnalysisResponseSchema>;
