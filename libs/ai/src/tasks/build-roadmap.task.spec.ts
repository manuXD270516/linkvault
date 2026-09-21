import {
  buildRoadmapInputSchema,
  type BuildRoadmapInput,
} from '@linkvault/shared';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidTaskRegistration, TaskRegistry } from '../application/task-registry';
import { FilePromptRegistry } from '../infrastructure/prompt-registry/file-prompt-registry';
import { searchCatalog } from '../infrastructure/catalog/search-catalog';
import {
  buildRoadmapFromCatalogOnly,
  buildRoadmapOutputSchema,
  buildRoadmapTask,
  sampleBuildRoadmap,
} from './build-roadmap.task';

const PROMPTS_DIR = join(import.meta.dirname, '../infrastructure/prompts');

const BASE_INPUT: BuildRoadmapInput = {
  missingSkills: [
    { name: 'Kafka', importance: 'must' },
    { name: 'Redis', importance: 'nice' },
  ],
  job: {
    title: 'Backend NestJS',
    skills: [
      { name: 'TypeScript', importance: 'must' },
      { name: 'Kafka', importance: 'must' },
      { name: 'Redis', importance: 'nice' },
    ],
  },
};

describe('buildRoadmapTask', () => {
  it('declares personal explicitly and is not cacheable', () => {
    expect(buildRoadmapTask).toMatchObject({
      name: 'build-roadmap',
      promptVersion: 'v1',
      temperature: 0,
      dataSensitivity: 'personal',
      cacheable: false,
      budget: { maxAttempts: 2 },
      requires: { jsonMode: true, maxContextTokens: 8_000 },
    });
    expect(buildRoadmapTask.cacheable).toBe(false);
    expect(buildRoadmapTask.degrade).toBeUndefined();
  });

  it('Tarea personal declarada cacheable', () => {
    expect(
      () =>
        new TaskRegistry([
          {
            ...buildRoadmapTask,
            cacheable: true,
          },
        ]),
    ).toThrow(InvalidTaskRegistration);
    expect(
      () =>
        new TaskRegistry([
          {
            ...buildRoadmapTask,
            cacheable: true,
          },
        ]),
    ).toThrow(/build-roadmap/);
  });

  it('sample is deterministic and prefers catalog hits as verified', () => {
    const a = sampleBuildRoadmap(BASE_INPUT, () => 0.1);
    const b = sampleBuildRoadmap(BASE_INPUT, () => 0.1);
    expect(a).toEqual(b);
    expect(buildRoadmapOutputSchema.safeParse(a).success).toBe(true);
    const kafka = a.items.find((item) => item.skill === 'Kafka');
    expect(kafka?.resources.some((r) => r.verified)).toBe(true);
    expect(
      kafka?.resources.every(
        (r) => r.verified === searchCatalog('Kafka').some((c) => c.url === r.url),
      ),
    ).toBe(true);
  });

  it('sample marks invented resources as not verified', () => {
    const input = buildRoadmapInputSchema.parse({
      missingSkills: [{ name: 'ObscureSkillXYZ', importance: 'must' }],
      job: { title: 'Role', skills: [] },
    });
    const sample = sampleBuildRoadmap(input, () => 0.2);
    expect(sample.items).toHaveLength(1);
    expect(sample.items[0]?.resources[0]?.verified).toBe(false);
  });
});

describe('buildRoadmapFromCatalogOnly', () => {
  it('devuelve roadmap cuando el catálogo cubre todas las skills', () => {
    const roadmap = buildRoadmapFromCatalogOnly(BASE_INPUT);
    expect(roadmap).not.toBeNull();
    expect(roadmap!.items.map((i) => i.skill)).toEqual(['Kafka', 'Redis']);
    expect(
      roadmap!.items.every((item) =>
        item.resources.every((r) => r.verified === true),
      ),
    ).toBe(true);
  });

  it('devuelve null si alguna skill no está en el catálogo', () => {
    expect(
      buildRoadmapFromCatalogOnly({
        missingSkills: [
          { name: 'Kafka', importance: 'must' },
          { name: 'ObscureSkillXYZ', importance: 'nice' },
        ],
        job: BASE_INPUT.job,
      }),
    ).toBeNull();
  });
});

describe('buildRoadmapOutputSchema verified post-process', () => {
  it('El modelo miente verified: fuerza false si no es hit de catálogo', () => {
    const parsed = buildRoadmapOutputSchema.parse({
      items: [
        {
          skill: 'TypeScript',
          priority: 1,
          estimatedWeeks: 2,
          resources: [
            {
              type: 'course',
              title: 'Curso inventado',
              url: 'https://example.com/fake',
              provider: 'example.com',
              free: true,
              verified: true,
            },
            {
              ...searchCatalog('TypeScript')[0]!,
              verified: false,
            },
          ],
        },
      ],
    });

    expect(parsed.items[0]?.resources[0]?.verified).toBe(false);
    expect(parsed.items[0]?.resources[1]?.verified).toBe(true);
  });
});

describe('build-roadmap prompt v1', () => {
  it('loads the real prompt file with matching front-matter', async () => {
    const registry = new FilePromptRegistry({ promptsDir: PROMPTS_DIR });
    await expect(
      registry.ensure({
        taskName: 'build-roadmap',
        promptVersion: 'v1',
      }),
    ).resolves.toBeUndefined();
  });

  it('Prompt renderizado con el input', async () => {
    const registry = new FilePromptRegistry({ promptsDir: PROMPTS_DIR });
    const prompt = await registry.render(
      { taskName: 'build-roadmap', promptVersion: 'v1' },
      { input: BASE_INPUT, outputLanguage: 'es' },
    );

    expect(prompt.system).toContain('planificador de estudio');
    expect(prompt.user).toContain('Kafka');
    expect(prompt.user).toContain(BASE_INPUT.job.title);
  });
});
