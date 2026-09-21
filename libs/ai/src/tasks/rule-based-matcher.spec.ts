import { describe, expect, it } from 'vitest';
import { matchByRules } from './rule-based-matcher';

describe('matchByRules', () => {
  it.each([
    [
      'todas coinciden',
      {
        jobSkills: [
          { name: 'TypeScript', importance: 'must' as const },
          { name: 'NestJS', importance: 'nice' as const },
        ],
        cvText: 'Experiencia con TypeScript y NestJS.',
        expected: {
          score: 100,
          matchedSkills: ['TypeScript', 'NestJS'],
          missingSkills: [],
        },
      },
    ],
    [
      'ninguna coincide',
      {
        jobSkills: [
          { name: 'TypeScript', importance: 'must' as const },
          { name: 'Go', importance: 'nice' as const },
        ],
        cvText: 'Perfil de diseño gráfico.',
        expected: {
          score: 0,
          matchedSkills: [],
          missingSkills: [
            { name: 'TypeScript', importance: 'must' },
            { name: 'Go', importance: 'nice' },
          ],
        },
      },
    ],
    [
      'solo las nice coinciden',
      {
        jobSkills: [
          { name: 'Kubernetes', importance: 'must' as const },
          { name: 'Docker', importance: 'nice' as const },
        ],
        cvText: 'Uso diario de Docker en CI.',
        // must=2, nice=1; matched nice only → 1/3 → 33
        expected: {
          score: 33,
          matchedSkills: ['Docker'],
          missingSkills: [{ name: 'Kubernetes', importance: 'must' }],
        },
      },
    ],
    [
      'vacante sin skills declaradas',
      {
        jobSkills: [],
        cvText: 'TypeScript y NestJS.',
        expected: {
          score: 100,
          matchedSkills: [],
          missingSkills: [],
        },
      },
    ],
    [
      'alias en distinta capitalización',
      {
        jobSkills: [
          { name: 'Kubernetes', importance: 'must' as const },
          { name: 'TypeScript', importance: 'must' as const },
        ],
        cvText: 'Experiencia con K8S y TYPESCRIPT en producción.',
        expected: {
          score: 100,
          matchedSkills: ['Kubernetes', 'TypeScript'],
          missingSkills: [],
        },
      },
    ],
  ])('%s', (_label, { jobSkills, cvText, expected }) => {
    expect(matchByRules({ jobSkills, cvText })).toEqual({
      ...expected,
      suggestions: [],
    });
  });
});
