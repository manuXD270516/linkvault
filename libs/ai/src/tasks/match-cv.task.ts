import {
  MATCH_SUGGESTIONS_MAX,
  matchReportCoreSchema,
  type MatchReportCore,
  type MatchSuggestion,
  type SkillImportance,
} from '@linkvault/shared';
import { z } from 'zod';
import type { AiTask, Rng } from '../domain/task';
import { matchByRules } from './rule-based-matcher';

// Tarea `match-cv` (cv-match-suggestions, ADR-030): encaje de un CV con una vacante y sugerencias de edición.
// `personal` y no cacheable: el input lleva texto de CV; cachearlo compartiría PII reinyectada entre procesos.

/**
 * Tope del texto de la vacante y del CV. Coherente con `maxContextTokens` 8 000 del Ollama local: pedir más
 * dejaría a la tarea sin proveedor elegible en local. Recortar en vez de rechazar evita convertir un CV largo en
 * un `ZodError` (misma razón que `extract-job`).
 */
export const MATCH_CV_JOB_TEXT_MAX_LENGTH = 12_000;
export const MATCH_CV_CV_TEXT_MAX_LENGTH = 12_000;
export const MATCH_CV_TITLE_MAX_LENGTH = 200;

const jobSkillInputSchema = z.strictObject({
  name: z.string().min(1).max(80),
  importance: z.enum(['must', 'nice']),
});

export const matchCvInputSchema = z
  .object({
    job: z.object({
      title: z.string().min(1).max(MATCH_CV_TITLE_MAX_LENGTH),
      text: z.string().min(1),
      skills: z.array(jobSkillInputSchema).max(60),
    }),
    cv: z.object({
      text: z.string().min(1),
    }),
  })
  .transform(({ job, cv }) => ({
    job: {
      title: job.title,
      text: job.text.slice(0, MATCH_CV_JOB_TEXT_MAX_LENGTH),
      skills: job.skills,
    },
    cv: {
      text: cv.text.slice(0, MATCH_CV_CV_TEXT_MAX_LENGTH),
    },
  }));
export type MatchCvInput = z.output<typeof matchCvInputSchema>;

/** Salida del modelo / degrade: el núcleo del informe, sin marcas de degradación. */
export const matchCvOutputSchema = matchReportCoreSchema;
export type MatchCvOutput = MatchReportCore;

/** Degradación honesta: cruce por reglas, siempre sin sugerencias. */
export function degradeMatchCv(input: MatchCvInput): MatchCvOutput {
  return matchByRules({
    jobSkills: input.job.skills,
    cvText: input.cv.text,
  });
}

/**
 * Muestra determinista para el modo `synth`. No inventa habilidades ausentes del CV o de la vacante. Cada
 * sugerencia lleva evidencia con `jobRequirement`, `importance` y un `cvFragment` literal del CV o `null`.
 */
export function sampleMatchCv(input: MatchCvInput, rng: Rng): MatchCvOutput {
  const base = degradeMatchCv(input);
  const suggestions: MatchSuggestion[] = base.missingSkills
    .slice(0, MATCH_SUGGESTIONS_MAX)
    .map((missing) => {
      const fragment = pickCvFragment(input.cv.text, missing.name, rng);
      return {
        section: 'skills',
        after: `Incluir experiencia con ${missing.name}.`,
        reason:
          missing.importance === 'must'
            ? `La vacante exige ${missing.name} y no aparece en el CV.`
            : `La vacante valora ${missing.name} y no aparece en el CV.`,
        evidence: {
          jobRequirement: missing.name,
          importance: missing.importance as SkillImportance,
          cvFragment: fragment,
        },
      };
    });

  return {
    ...base,
    suggestions,
  };
}

export const matchCvTask: AiTask<MatchCvInput, MatchCvOutput> = {
  name: 'match-cv',
  promptVersion: 'v1',
  inputSchema: matchCvInputSchema,
  outputSchema: matchCvOutputSchema,
  // 8 000 tokens = contexto del Ollama local; pedir más degrada siempre en local.
  requires: { jsonMode: true, maxContextTokens: 8_000 },
  temperature: 0,
  budget: { maxTokens: 2_048, maxAttempts: 2 },
  dataSensitivity: 'personal',
  cacheable: false,
  degrade: degradeMatchCv,
  sample: sampleMatchCv,
};

/**
 * Fragmento literal del CV para la evidencia. En `synth` siempre `null`: copiar el inicio del CV metería PII en
 * fixtures de tareas `personal` (6.15: la grabación rechaza salidas que el redactor externo cambiaría).
 */
function pickCvFragment(
  _cvText: string,
  _skillName: string,
  rng: Rng,
): string | null {
  // Consume el RNG para no desplazar muestras futuras si se amplía `sample`.
  rng();
  return null;
}
