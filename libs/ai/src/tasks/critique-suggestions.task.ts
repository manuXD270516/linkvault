import {
  critiqueSuggestionsInputSchema,
  critiqueSuggestionsOutputSchema,
  type CritiqueSuggestionsInput,
  type CritiqueSuggestionsOutput,
} from '@linkvault/shared';
import type { AiTask, Rng } from '../domain/task';

// Tarea `critique-suggestions` (cv-suggestions-review, ADR-031): el juez puntúa un informe sin PII del CV.
// `personal` y no cacheable: el input puede llevar marcadores de PII y no debe compartirse en caché Redis.

export type {
  CritiqueSuggestionsInput,
  CritiqueSuggestionsOutput,
} from '@linkvault/shared';

/**
 * Núcleo de informe (o informe completo) del que se puede construir el input del juez. Acepta campos de más
 * (`cvFragment`, `before`, `degraded`, …): esta función los descarta a propósito.
 */
export type CritiqueSourceReport = {
  readonly score: number;
  readonly matchedSkills: readonly string[];
  readonly missingSkills: ReadonlyArray<{
    readonly name: string;
    readonly importance: 'must' | 'nice';
  }>;
  readonly suggestions: ReadonlyArray<{
    readonly section: string;
    readonly after: string;
    readonly reason: string;
    readonly before?: string | null;
    readonly evidence: {
      readonly jobRequirement: string;
      readonly importance: 'must' | 'nice';
      readonly cvFragment?: string | null;
    };
  }>;
};

export type CritiqueSourceJob = {
  readonly title: string;
  readonly text: string;
  readonly skills: ReadonlyArray<{
    readonly name: string;
    readonly importance: 'must' | 'nice';
  }>;
};

/**
 * Construye el input del juez: oferta + informe **sin** `cvFragment` ni `before`. Los `after` se conservan tal cual
 * (marcadores incluidos). No reinyecta PII.
 */
export function toCritiqueSuggestionsInput(
  job: CritiqueSourceJob,
  report: CritiqueSourceReport,
): CritiqueSuggestionsInput {
  return critiqueSuggestionsInputSchema.parse({
    job: {
      title: job.title,
      text: job.text,
      skills: job.skills.map((skill) => ({
        name: skill.name,
        importance: skill.importance,
      })),
    },
    report: {
      score: report.score,
      matchedSkills: [...report.matchedSkills],
      missingSkills: report.missingSkills.map((skill) => ({
        name: skill.name,
        importance: skill.importance,
      })),
      suggestions: report.suggestions.map((suggestion) => ({
        section: suggestion.section,
        after: suggestion.after,
        reason: suggestion.reason,
        evidence: {
          jobRequirement: suggestion.evidence.jobRequirement,
          importance: suggestion.evidence.importance,
        },
      })),
    },
  });
}

/** Muestra determinista para `synth`: score bajo con un issue anclado al primer missing o genérico. */
export function sampleCritiqueSuggestions(
  input: CritiqueSuggestionsInput,
  rng: Rng,
): CritiqueSuggestionsOutput {
  rng();
  const firstMissing = input.report.missingSkills[0];
  if (firstMissing !== undefined) {
    return {
      score: 0.45,
      issues: [
        `La sugerencia sobre ${firstMissing.name} no ancla bien el requisito ${firstMissing.importance}.`,
      ],
    };
  }
  if (input.report.suggestions.length === 0) {
    return { score: 0.2, issues: ['El informe no aporta sugerencias accionables.'] };
  }
  return {
    score: 0.55,
    issues: ['Las sugerencias son demasiado genéricas respecto a la oferta.'],
  };
}

export const critiqueSuggestionsTask: AiTask<
  CritiqueSuggestionsInput,
  CritiqueSuggestionsOutput
> = {
  name: 'critique-suggestions',
  promptVersion: 'v1',
  inputSchema: critiqueSuggestionsInputSchema,
  outputSchema: critiqueSuggestionsOutputSchema,
  requires: { jsonMode: true, maxContextTokens: 8_000 },
  temperature: 0,
  budget: { maxTokens: 1_024, maxAttempts: 2 },
  dataSensitivity: 'personal',
  cacheable: false,
  sample: sampleCritiqueSuggestions,
};
