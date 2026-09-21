import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidTaskRegistration, TaskRegistry } from '../application/task-registry';
import { FilePromptRegistry } from '../infrastructure/prompt-registry/file-prompt-registry';
import {
  critiqueSuggestionsTask,
  sampleCritiqueSuggestions,
  toCritiqueSuggestionsInput,
} from './critique-suggestions.task';

/**
 * Directorio real de prompts resuelto desde este archivo: `nx test ai` ejecuta Vitest con cwd = libs/ai.
 */
const PROMPTS_DIR = join(import.meta.dirname, '../infrastructure/prompts');

const JOB = {
  title: 'Backend NestJS',
  text: 'Buscamos NestJS y TypeScript. Contacto: hiring@acme.test',
  skills: [
    { name: 'TypeScript', importance: 'must' as const },
    { name: 'NestJS', importance: 'must' as const },
  ],
};

const REPORT_WITH_PII = {
  score: 70,
  matchedSkills: ['TypeScript'],
  missingSkills: [{ name: 'NestJS', importance: 'must' as const }],
  suggestions: [
    {
      section: 'skills',
      before: 'ana@example.com trabajó con Node.',
      after: 'Incluir NestJS. Contacto [EMAIL_1].',
      reason: 'La vacante lo pide.',
      evidence: {
        jobRequirement: 'NestJS',
        importance: 'must' as const,
        cvFragment: 'ana@example.com — 3 años con Node',
      },
    },
  ],
};

describe('critiqueSuggestionsTask', () => {
  it('declares personal explicitly and is not cacheable', () => {
    expect(critiqueSuggestionsTask).toMatchObject({
      name: 'critique-suggestions',
      promptVersion: 'v1',
      temperature: 0,
      dataSensitivity: 'personal',
      cacheable: false,
      budget: { maxAttempts: 2 },
      requires: { jsonMode: true, maxContextTokens: 8_000 },
    });
    expect(critiqueSuggestionsTask.cacheable).toBe(false);
  });

  it('Tarea personal declarada cacheable', () => {
    expect(
      () =>
        new TaskRegistry([
          {
            ...critiqueSuggestionsTask,
            cacheable: true,
          },
        ]),
    ).toThrow(InvalidTaskRegistration);
    expect(
      () =>
        new TaskRegistry([
          {
            ...critiqueSuggestionsTask,
            cacheable: true,
          },
        ]),
    ).toThrow(/critique-suggestions/);
  });

  it('sample is deterministic for the same input', () => {
    const input = toCritiqueSuggestionsInput(JOB, REPORT_WITH_PII);
    const a = sampleCritiqueSuggestions(input, () => 0.1);
    const b = sampleCritiqueSuggestions(input, () => 0.1);
    expect(a).toEqual(b);
    expect(critiqueSuggestionsTask.outputSchema.safeParse(a).success).toBe(
      true,
    );
  });
});

describe('toCritiqueSuggestionsInput', () => {
  it('El juez no ve fragmentos del CV', () => {
    const input = toCritiqueSuggestionsInput(JOB, REPORT_WITH_PII);
    const serialized = JSON.stringify(input);

    expect(serialized).not.toContain('ana@example.com');
    expect(serialized).not.toContain('cvFragment');
    expect(serialized).not.toContain('before');
    expect(input.report.suggestions[0]).toEqual({
      section: 'skills',
      after: 'Incluir NestJS. Contacto [EMAIL_1].',
      reason: 'La vacante lo pide.',
      evidence: {
        jobRequirement: 'NestJS',
        importance: 'must',
      },
    });
    expect(input.report.suggestions[0]?.after).toContain('[EMAIL_1]');
  });
});

describe('critique-suggestions prompt v1', () => {
  it('loads the real prompt file with matching front-matter', async () => {
    const registry = new FilePromptRegistry({ promptsDir: PROMPTS_DIR });
    await expect(
      registry.ensure({
        taskName: 'critique-suggestions',
        promptVersion: 'v1',
      }),
    ).resolves.toBeUndefined();
  });

  it('Prompt renderizado con el input', async () => {
    const registry = new FilePromptRegistry({ promptsDir: PROMPTS_DIR });
    const input = toCritiqueSuggestionsInput(JOB, REPORT_WITH_PII);
    const prompt = await registry.render(
      { taskName: 'critique-suggestions', promptVersion: 'v1' },
      { input, outputLanguage: 'es' },
    );

    expect(prompt.system).toContain('juez adversarial');
    expect(prompt.user).toContain(JOB.title);
    expect(prompt.user).toContain('[EMAIL_1]');
    expect(prompt.user).not.toContain('ana@example.com');
    expect(prompt.user).not.toContain('cvFragment');
  });
});
