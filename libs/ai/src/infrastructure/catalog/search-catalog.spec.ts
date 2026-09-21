import { describe, expect, it } from 'vitest';
import {
  catalogSkillNames,
  isCatalogHit,
  searchCatalog,
} from './search-catalog';

describe('searchCatalog', () => {
  it('hit exacto por nombre canónico', () => {
    const hits = searchCatalog('TypeScript');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]).toMatchObject({
      type: 'doc',
      provider: 'typescriptlang.org',
      free: true,
    });
    expect(hits[0]?.url).toContain('typescriptlang.org');
  });

  it('hit case-insensitive', () => {
    expect(searchCatalog('typescript')).toEqual(searchCatalog('TypeScript'));
    expect(searchCatalog('NESTJS')).toEqual(searchCatalog('NestJS'));
  });

  it.each([
    ['ts', 'TypeScript'],
    ['nodejs', 'Node.js'],
    ['node', 'Node.js'],
    ['k8s', 'Kubernetes'],
    ['postgres', 'PostgreSQL'],
    ['golang', 'Go'],
    ['reactjs', 'React'],
  ] as const)('sinónimo %s → %s', (alias, canonical) => {
    expect(searchCatalog(alias)).toEqual(searchCatalog(canonical));
    expect(searchCatalog(alias).length).toBeGreaterThan(0);
  });

  it('miss: habilidad ausente del seed', () => {
    expect(searchCatalog('ObscureFrameworkXYZ')).toEqual([]);
    expect(searchCatalog('')).toEqual([]);
  });

  it('cubre ~30–50 skills del dominio match', () => {
    const names = catalogSkillNames();
    expect(names.length).toBeGreaterThanOrEqual(30);
    expect(names.length).toBeLessThanOrEqual(50);
    for (const required of [
      'TypeScript',
      'Node.js',
      'NestJS',
      'PostgreSQL',
      'Redis',
      'Kafka',
      'Docker',
      'Kubernetes',
      'React',
      'Angular',
      'Python',
      'Go',
      'AWS',
    ]) {
      expect(names).toContain(required);
      expect(searchCatalog(required).length).toBeGreaterThanOrEqual(1);
      expect(searchCatalog(required).length).toBeLessThanOrEqual(3);
    }
  });
});

describe('isCatalogHit', () => {
  it('reconoce un recurso idéntico al seed', () => {
    const [first] = searchCatalog('Kafka');
    expect(first).toBeDefined();
    expect(isCatalogHit('Kafka', first!)).toBe(true);
    expect(isCatalogHit('kafka', first!)).toBe(true);
  });

  it('rechaza un recurso inventado', () => {
    expect(
      isCatalogHit('TypeScript', {
        type: 'course',
        title: 'Fake TS bootcamp',
        url: 'https://example.com/fake-ts',
        provider: 'example.com',
        free: true,
      }),
    ).toBe(false);
  });
});
