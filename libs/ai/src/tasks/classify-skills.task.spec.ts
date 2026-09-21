import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { outputLanguageOf } from '../domain/run-context';
import { FilePromptRegistry } from '../infrastructure/prompt-registry/file-prompt-registry';
import {
  classifySkillsInputSchema,
  classifySkillsOutputSchema,
  classifySkillsTask,
  sampleClassifySkills,
} from './classify-skills.task';

// D13 de ai-gateway-core; escenarios "Prompt renderizado con el input" e "Idioma por defecto" (task-execution).

/**
 * Directorio real de prompts resuelto desde este archivo: `nx test ai` ejecuta Vitest con cwd = libs/ai, así que
 * la ruta por defecto de D7 (relativa a la raíz del workspace) no sirve aquí.
 */
const PROMPTS_DIR = join(import.meta.dirname, '../infrastructure/prompts');

const CLASSIFY_V1 = {
  taskName: classifySkillsTask.name,
  promptVersion: classifySkillsTask.promptVersion,
};

/** PRNG de prueba que devuelve una secuencia fija. */
function sequenceRng(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

describe('classify-skills schemas', () => {
  it.each([
    ['empty text', { text: '' }],
    ['text over 20000 characters', { text: 'a'.repeat(20_001) }],
    ['missing text', {}],
    ['non-string text', { text: 42 }],
  ])('rejects input with %s', (_label, input) => {
    expect(classifySkillsInputSchema.safeParse(input).success).toBe(false);
  });

  it('accepts text up to 20000 characters and strips unknown keys', () => {
    const parsed = classifySkillsInputSchema.parse({
      text: 'a'.repeat(20_000),
      extra: true,
    });

    expect(parsed).toEqual({ text: 'a'.repeat(20_000) });
  });

  it('accepts a valid output', () => {
    expect(
      classifySkillsOutputSchema.safeParse({
        skills: [
          { name: 'TypeScript', category: 'language' },
          { name: 'Inglés', category: 'other' },
        ],
      }).success,
    ).toBe(true);
  });

  it.each([
    ['unknown category', { skills: [{ name: 'Go', category: 'lang' }] }],
    ['empty name', { skills: [{ name: '', category: 'tool' }] }],
    ['name over 60', { skills: [{ name: 'x'.repeat(61), category: 'tool' }] }],
    [
      'more than 60 skills',
      {
        skills: Array.from({ length: 61 }, (_, i) => ({
          name: `s${i}`,
          category: 'tool',
        })),
      },
    ],
    ['missing skills', {}],
  ])('rejects output with %s', (_label, output) => {
    expect(classifySkillsOutputSchema.safeParse(output).success).toBe(false);
  });

  it('declares the task contract of D13', () => {
    expect(classifySkillsTask).toMatchObject({
      name: 'classify-skills',
      promptVersion: 'v1',
      dataSensitivity: 'personal',
      cacheable: false,
      requires: { jsonMode: true, maxContextTokens: 8_000 },
      temperature: 0,
      budget: { maxTokens: 1_024, maxAttempts: 2 },
    });
    expect(classifySkillsTask.degrade).toBeUndefined();
  });
});

describe('classify-skills prompt v1', () => {
  it('loads the real prompt file with matching front-matter', async () => {
    const registry = new FilePromptRegistry({ promptsDir: PROMPTS_DIR });

    await expect(
      registry.ensure({ taskName: 'classify-skills', promptVersion: 'v1' }),
    ).resolves.toBeUndefined();
  });

  it('Prompt renderizado con el input', async () => {
    const registry = new FilePromptRegistry({ promptsDir: PROMPTS_DIR });
    const text = 'Buscamos dev "senior" con TypeScript & NestJS <remoto>';

    const prompt = await registry.render(CLASSIFY_V1, {
      input: { text },
      outputLanguage: 'en',
    });

    expect(prompt.user).toContain(text);
    expect(prompt.user).not.toMatch(/&amp;|&quot;|&lt;|&#/);
    expect(prompt.user).toContain('Idioma de salida: en');
    expect(prompt.system).toContain('Idioma de salida: en');
  });

  it('Idioma por defecto', async () => {
    const registry = new FilePromptRegistry({ promptsDir: PROMPTS_DIR });

    const prompt = await registry.render(CLASSIFY_V1, {
      input: { text: 'TypeScript' },
      outputLanguage: outputLanguageOf({}),
    });

    expect(prompt.user).toContain('Idioma de salida: es');
    expect(prompt.system).toContain('Idioma de salida: es');
  });
});

describe('classify-skills sample', () => {
  it('detects known skills in order of appearance with their category', () => {
    const output = sampleClassifySkills(
      {
        text: 'Backend con NestJS y TypeScript sobre Node.js; MongoDB, Docker. Inglés B2 y trabajo en equipo.',
      },
      sequenceRng([0.5]),
    );

    expect(output.skills).toEqual([
      { name: 'NestJS', category: 'framework' },
      { name: 'TypeScript', category: 'language' },
      { name: 'Node.js', category: 'platform' },
      { name: 'MongoDB', category: 'tool' },
      { name: 'Docker', category: 'tool' },
      { name: 'Inglés', category: 'other' },
      { name: 'Trabajo en equipo', category: 'soft' },
    ]);
    expect(classifySkillsOutputSchema.safeParse(output).success).toBe(true);
  });

  it('is deterministic for the same input and seed sequence', () => {
    const input = { text: 'TypeScript, Angular, Redis y Git' };

    expect(sampleClassifySkills(input, sequenceRng([0.1, 0.9]))).toEqual(
      sampleClassifySkills(input, sequenceRng([0.1, 0.9])),
    );
  });

  it('never invents skills absent from the input', () => {
    const texts = [
      'Cocinero con experiencia en repostería',
      'JavaScripting y Mongoose no son skills de la lista',
      'Contacto: [EMAIL_1]',
    ];

    for (const text of texts) {
      expect(sampleClassifySkills({ text }, sequenceRng([0.3])).skills).toEqual(
        [],
      );
    }
  });

  it('only returns names whose alias appears in the text', () => {
    const text = 'Stack: java, react.js, postgres, k8s y english';

    const names = sampleClassifySkills({ text }, sequenceRng([0.7])).skills.map(
      (skill) => skill.name,
    );

    expect(names).toEqual([
      'Java',
      'React',
      'PostgreSQL',
      'Kubernetes',
      'Inglés',
    ]);
  });

  it('lists each skill once even if several aliases appear', () => {
    const text = 'Node.js (nodejs) y Mongo/MongoDB';

    expect(
      sampleClassifySkills({ text }, sequenceRng([0.2])).skills.map(
        (s) => s.name,
      ),
    ).toEqual(['Node.js', 'MongoDB']);
  });
});
