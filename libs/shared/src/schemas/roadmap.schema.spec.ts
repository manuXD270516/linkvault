import { describe, expect, it } from 'vitest';
import {
  BUILD_ROADMAP_TITLE_MAX_LENGTH,
  buildRoadmapInputSchema,
  enforceRoadmapVerified,
  roadmapAcceptedSchema,
  roadmapItemSchema,
  roadmapResourceSchema,
  roadmapResponseSchema,
  roadmapSchema,
  type Roadmap,
  type RoadmapResource,
} from './roadmap.schema';

const catalogResource: Omit<RoadmapResource, 'verified'> = {
  type: 'doc',
  title: 'TypeScript Handbook',
  url: 'https://www.typescriptlang.org/docs/handbook/intro.html',
  provider: 'typescriptlang.org',
  free: true,
};

const validResource: RoadmapResource = {
  ...catalogResource,
  verified: true,
};

const validItem = {
  skill: 'TypeScript',
  priority: 1,
  estimatedWeeks: 2,
  resources: [validResource],
};

const validRoadmap: Roadmap = { items: [validItem] };

const validInput = {
  missingSkills: [
    { name: 'TypeScript', importance: 'must' as const },
    { name: 'Kafka', importance: 'nice' as const },
  ],
  job: {
    title: 'Backend NestJS',
    skills: [
      { name: 'TypeScript', importance: 'must' as const },
      { name: 'Kafka', importance: 'nice' as const },
    ],
  },
};

describe('roadmapResourceSchema', () => {
  it('acepta un recurso completo', () => {
    expect(roadmapResourceSchema.parse(validResource)).toEqual(validResource);
  });

  it.each([
    ['url inválida', { ...validResource, url: 'not-a-url' }],
    ['type desconocido', { ...validResource, type: 'podcast' }],
    ['title vacío', { ...validResource, title: '' }],
    ['campo inventado', { ...validResource, extra: true }],
    ['verified ausente', { ...catalogResource }],
  ] as const)('rechaza %s', (_label, value) => {
    expect(roadmapResourceSchema.safeParse(value).success).toBe(false);
  });

  it('acepta url null', () => {
    expect(
      roadmapResourceSchema.parse({ ...validResource, url: null }).url,
    ).toBeNull();
  });
});

describe('roadmapItemSchema / roadmapSchema', () => {
  it('acepta un roadmap mínimo', () => {
    expect(roadmapSchema.parse(validRoadmap)).toEqual(validRoadmap);
  });

  it.each([
    ['priority 0', { ...validItem, priority: 0 }],
    ['priority 6', { ...validItem, priority: 6 }],
    ['estimatedWeeks 0', { ...validItem, estimatedWeeks: 0 }],
    ['resources vacío', { ...validItem, resources: [] }],
    ['skill vacío', { ...validItem, skill: '' }],
  ] as const)('rechaza ítem con %s', (_label, item) => {
    expect(roadmapItemSchema.safeParse(item).success).toBe(false);
  });

  it('rechaza items que no son array', () => {
    expect(roadmapSchema.safeParse({ items: null }).success).toBe(false);
  });
});

describe('buildRoadmapInputSchema', () => {
  it('acepta missingSkills y job mínimo', () => {
    expect(buildRoadmapInputSchema.parse(validInput)).toEqual(validInput);
  });

  it('rechaza missingSkills vacío', () => {
    expect(
      buildRoadmapInputSchema.safeParse({
        ...validInput,
        missingSkills: [],
      }).success,
    ).toBe(false);
  });

  it('rechaza título demasiado largo', () => {
    expect(
      buildRoadmapInputSchema.safeParse({
        ...validInput,
        job: {
          ...validInput.job,
          title: 'a'.repeat(BUILD_ROADMAP_TITLE_MAX_LENGTH + 1),
        },
      }).success,
    ).toBe(false);
  });

  it('rechaza campos desconocidos', () => {
    expect(
      buildRoadmapInputSchema.safeParse({
        ...validInput,
        cvText: 'secreto',
      }).success,
    ).toBe(false);
  });
});

describe('enforceRoadmapVerified', () => {
  it('El modelo miente verified: solo hits del catálogo quedan true', () => {
    const lied: Roadmap = {
      items: [
        {
          skill: 'TypeScript',
          priority: 1,
          estimatedWeeks: 2,
          resources: [
            { ...catalogResource, verified: true },
            {
              type: 'course',
              title: 'Curso inventado de TypeScript',
              url: 'https://example.com/fake-ts',
              provider: 'example.com',
              free: true,
              verified: true,
            },
          ],
        },
      ],
    };

    const enforced = enforceRoadmapVerified(
      lied,
      (skill, resource) =>
        skill === 'TypeScript' &&
        resource.url === catalogResource.url &&
        resource.title === catalogResource.title,
    );

    expect(enforced.items[0]?.resources[0]?.verified).toBe(true);
    expect(enforced.items[0]?.resources[1]?.verified).toBe(false);
  });

  it('fuerza false aunque el modelo diga true sin hit', () => {
    const invented: Roadmap = {
      items: [
        {
          skill: 'ObscureSkill',
          priority: 3,
          estimatedWeeks: 1,
          resources: [
            {
              type: 'post',
              title: 'Blog random',
              url: 'https://example.com/post',
              provider: 'example.com',
              free: true,
              verified: true,
            },
          ],
        },
      ],
    };

    expect(
      enforceRoadmapVerified(invented, () => false).items[0]?.resources[0]
        ?.verified,
    ).toBe(false);
  });
});

describe('roadmapResponseSchema / roadmapAcceptedSchema', () => {
  it('acepta generating sin items', () => {
    expect(
      roadmapResponseSchema.parse({
        roadmapId: 'r1',
        analysisId: 'a1',
        status: 'generating',
      }),
    ).toEqual({
      roadmapId: 'r1',
      analysisId: 'a1',
      status: 'generating',
    });
  });

  it('exige items cuando ready', () => {
    expect(
      roadmapResponseSchema.safeParse({
        roadmapId: 'r1',
        analysisId: 'a1',
        status: 'ready',
      }).success,
    ).toBe(false);
  });

  it('acepta accepted 202', () => {
    expect(
      roadmapAcceptedSchema.parse({
        roadmapId: 'r1',
        status: 'generating',
      }),
    ).toEqual({ roadmapId: 'r1', status: 'generating' });
  });
});
