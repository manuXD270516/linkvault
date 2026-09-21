import { MATCH_CV_FRAGMENT_MAX_CHARS, MATCH_SUGGESTIONS_MAX } from '@linkvault/shared';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FilePromptRegistry } from '../infrastructure/prompt-registry/file-prompt-registry';
import {
  degradeMatchCv,
  MATCH_CV_CV_TEXT_MAX_LENGTH,
  matchCvInputSchema,
  matchCvOutputSchema,
  matchCvTask,
  sampleMatchCv,
  type MatchCvInput,
} from './match-cv.task';

const PROMPTS_DIR = join(import.meta.dirname, '../infrastructure/prompts');

function sequenceRng(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

const BASE_INPUT: MatchCvInput = {
  job: {
    title: 'Backend Senior',
    text: 'Buscamos backend con TypeScript, NestJS y Kubernetes.',
    skills: [
      { name: 'TypeScript', importance: 'must' },
      { name: 'NestJS', importance: 'must' },
      { name: 'Kubernetes', importance: 'nice' },
    ],
  },
  cv: {
    text: 'Ana Pérez. 3 años con TypeScript y NestJS en producción.',
  },
};

describe('match-cv schemas', () => {
  it('rejects an empty CV', () => {
    expect(
      matchCvInputSchema.safeParse({
        job: BASE_INPUT.job,
        cv: { text: '' },
      }).success,
    ).toBe(false);
  });

  it('trims long job and CV texts instead of rejecting them', () => {
    const parsed = matchCvInputSchema.parse({
      job: {
        ...BASE_INPUT.job,
        text: 'a'.repeat(MATCH_CV_CV_TEXT_MAX_LENGTH + 500),
      },
      cv: { text: 'b'.repeat(MATCH_CV_CV_TEXT_MAX_LENGTH + 500) },
    });
    expect(parsed.job.text).toHaveLength(MATCH_CV_CV_TEXT_MAX_LENGTH);
    expect(parsed.cv.text).toHaveLength(MATCH_CV_CV_TEXT_MAX_LENGTH);
  });

  it.each([
    [
      'Una sugerencia sin de dónde sale',
      {
        score: 50,
        matchedSkills: [],
        missingSkills: [{ name: 'Go', importance: 'must' as const }],
        suggestions: [
          {
            section: 'skills',
            after: 'Añadir Go',
            reason: 'Falta',
            evidence: {
              jobRequirement: '',
              importance: 'must' as const,
              cvFragment: null,
            },
          },
        ],
      },
    ],
    [
      'Una sugerencia sin el peso de su requisito',
      {
        score: 50,
        matchedSkills: [],
        missingSkills: [{ name: 'Go', importance: 'must' as const }],
        suggestions: [
          {
            section: 'skills',
            after: 'Añadir Go',
            reason: 'Falta',
            evidence: {
              jobRequirement: 'Go',
              cvFragment: null,
            },
          },
        ],
      },
    ],
    [
      'Trece sugerencias',
      {
        score: 10,
        matchedSkills: [],
        missingSkills: [],
        suggestions: Array.from({ length: MATCH_SUGGESTIONS_MAX + 1 }, (_, i) => ({
          section: 'skills',
          after: `Sugerencia ${i}`,
          reason: 'Falta',
          evidence: {
            jobRequirement: `Skill${i}`,
            importance: 'nice' as const,
            cvFragment: null,
          },
        })),
      },
    ],
    [
      'Un fragmento demasiado largo',
      {
        score: 50,
        matchedSkills: [],
        missingSkills: [{ name: 'Go', importance: 'must' as const }],
        suggestions: [
          {
            section: 'skills',
            after: 'Añadir Go',
            reason: 'Falta',
            evidence: {
              jobRequirement: 'Go',
              importance: 'must' as const,
              cvFragment: 'x'.repeat(MATCH_CV_FRAGMENT_MAX_CHARS + 1),
            },
          },
        ],
      },
    ],
  ])('%s', (_label, output) => {
    expect(matchCvOutputSchema.safeParse(output).success).toBe(false);
  });
});

describe('matchCvTask', () => {
  it('declares personal explicitly and is not cacheable', () => {
    expect(matchCvTask).toMatchObject({
      name: 'match-cv',
      promptVersion: 'v1',
      temperature: 0,
      dataSensitivity: 'personal',
      cacheable: false,
      budget: { maxAttempts: 2 },
      requires: { jsonMode: true, maxContextTokens: 8_000 },
    });
    expect(matchCvTask.dataSensitivity).toBe('personal');
    expect(matchCvTask.cacheable).toBe(false);
  });

  it('Toda la cadena falló / Sin IA configurada: degrade returns empty suggestions', () => {
    const output = degradeMatchCv(BASE_INPUT);
    expect(output.suggestions).toEqual([]);
    expect(matchCvOutputSchema.safeParse(output).success).toBe(true);
    expect(output.matchedSkills).toEqual(['TypeScript', 'NestJS']);
    expect(output.missingSkills).toEqual([
      { name: 'Kubernetes', importance: 'nice' },
    ]);
  });

  it('degrade is deterministic for the same input', () => {
    expect(degradeMatchCv(BASE_INPUT)).toEqual(degradeMatchCv(BASE_INPUT));
  });

  it('sample is deterministic for the same seed', () => {
    const a = sampleMatchCv(BASE_INPUT, sequenceRng([0.1, 0.2, 0.3]));
    const b = sampleMatchCv(BASE_INPUT, sequenceRng([0.1, 0.2, 0.3]));
    expect(a).toEqual(b);
    expect(matchCvOutputSchema.safeParse(a).success).toBe(true);
    expect(a.suggestions.length).toBeLessThanOrEqual(MATCH_SUGGESTIONS_MAX);
    for (const suggestion of a.suggestions) {
      expect(suggestion.evidence.jobRequirement.length).toBeGreaterThan(0);
      expect(['must', 'nice']).toContain(suggestion.evidence.importance);
    }
  });

  it('renders the real prompt with job and CV delimiters', async () => {
    const registry = new FilePromptRegistry({ promptsDir: PROMPTS_DIR });
    const prompt = await registry.render(
      {
        taskName: matchCvTask.name,
        promptVersion: matchCvTask.promptVersion,
      },
      { input: BASE_INPUT, outputLanguage: 'es' },
    );

    expect(prompt.user).toContain('Idioma de salida: es');
    expect(prompt.user).toContain('<oferta>');
    expect(prompt.user).toContain(BASE_INPUT.job.text);
    expect(prompt.user).toContain('<cv>');
    expect(prompt.user).toContain(BASE_INPUT.cv.text);
    expect(prompt.user).toContain('TypeScript (must)');
    expect(prompt.system).toContain('[EMAIL_1]');
    expect(prompt.system).toContain('[ADDRESS_1]');
    expect(prompt.system).toContain('[ID_1]');
    expect(prompt.system).toContain('[NAME_1]');
  });
});
