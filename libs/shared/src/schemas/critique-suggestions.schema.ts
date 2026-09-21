import { z } from 'zod';
import {
  MATCH_SUGGESTIONS_MAX,
  missingSkillSchema,
  skillImportanceSchema,
} from './match.schema';

// Contratos de la tarea `critique-suggestions` (cv-suggestions-review, ADR-031 §2): el juez puntúa un informe
// **sin** ver PII del CV. El input es oferta + informe sin `evidence.cvFragment` ni `before`; los `after` pueden
// llevar marcadores. La salida es score 0–1 e issues —sin inventar score si no valida.

/** Tope del texto de la vacante y del título: mismos límites que `match-cv` (contexto local ~8 000 tokens). */
export const CRITIQUE_SUGGESTIONS_JOB_TEXT_MAX_LENGTH = 12_000;
export const CRITIQUE_SUGGESTIONS_TITLE_MAX_LENGTH = 200;

const critiqueJobSkillSchema = z.strictObject({
  name: z.string().min(1).max(80),
  importance: skillImportanceSchema,
});

/**
 * Evidencia que ve el juez: requisito y peso, **sin** `cvFragment`. Un campo de más (p. ej. el fragmento) invalida.
 */
export const critiqueSuggestionEvidenceSchema = z.strictObject({
  jobRequirement: z.string().min(1),
  importance: skillImportanceSchema,
});
export type CritiqueSuggestionEvidence = z.infer<
  typeof critiqueSuggestionEvidenceSchema
>;

/**
 * Sugerencia hacia el juez: sección, texto propuesto (`after`, con marcadores si los había), motivo y evidencia
 * sin fragmento de CV. **Sin** `before`: la reinyección de PII es para el GET, no para el juez.
 */
export const critiqueSuggestionSchema = z.strictObject({
  section: z.string().min(1),
  after: z.string().min(1),
  reason: z.string().min(1),
  evidence: critiqueSuggestionEvidenceSchema,
});
export type CritiqueSuggestion = z.infer<typeof critiqueSuggestionSchema>;

/** Informe que recibe el juez: el núcleo del MatchReport sin PII del CV. */
export const critiqueMatchReportSchema = z.strictObject({
  score: z.number().int().min(0).max(100),
  matchedSkills: z.array(z.string().min(1)),
  missingSkills: z.array(missingSkillSchema),
  suggestions: z.array(critiqueSuggestionSchema).max(MATCH_SUGGESTIONS_MAX),
});
export type CritiqueMatchReport = z.infer<typeof critiqueMatchReportSchema>;

/**
 * Oferta que recibe el juez. Misma forma que el `job` de `match-cv` (título, texto, skills). El texto se recorta
 * en vez de rechazarse, igual que en esa tarea.
 */
const critiqueJobInputSchema = z
  .object({
    title: z.string().min(1).max(CRITIQUE_SUGGESTIONS_TITLE_MAX_LENGTH),
    text: z.string().min(1),
    skills: z.array(critiqueJobSkillSchema).max(60),
  })
  .transform((job) => ({
    title: job.title,
    text: job.text.slice(0, CRITIQUE_SUGGESTIONS_JOB_TEXT_MAX_LENGTH),
    skills: job.skills,
  }));

/** Entrada de `critique-suggestions`: oferta + informe sin PII del CV. */
export const critiqueSuggestionsInputSchema = z.strictObject({
  job: critiqueJobInputSchema,
  report: critiqueMatchReportSchema,
});
export type CritiqueSuggestionsInput = z.output<
  typeof critiqueSuggestionsInputSchema
>;

/**
 * Salida del juez: score en [0, 1] y lista de issues. Un score fuera de rango o un cuerpo que no sea esto
 * **no** valida —no se inventa score tras agotar la reparación.
 */
export const critiqueSuggestionsOutputSchema = z.strictObject({
  score: z.number().min(0).max(1),
  issues: z.array(z.string().min(1)),
});
export type CritiqueSuggestionsOutput = z.infer<
  typeof critiqueSuggestionsOutputSchema
>;
