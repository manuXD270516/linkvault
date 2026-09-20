import { describe, expect, it } from 'vitest';
import {
  ConstantPublicSlugGenerator,
  sequentialPublicSlug,
  StubPublicSlugGenerator,
} from '../application/testing/stub-public-slug.generator';
import {
  isValidPublicSlug,
  PUBLIC_SLUG_ALPHABET,
  PUBLIC_SLUG_LENGTH,
} from '../domain/public-slug';
import { RandomPublicSlugGenerator } from './random-public-slug.generator';

describe('RandomPublicSlugGenerator', () => {
  const generator = new RandomPublicSlugGenerator();

  it('da slugs con la longitud y el alfabeto del dominio', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const slug = generator.next();

      expect(slug).toHaveLength(PUBLIC_SLUG_LENGTH);
      expect(isValidPublicSlug(slug)).toBe(true);
    }
  });

  it('no repite: dos mil slugs son dos mil valores distintos', () => {
    const slugs = new Set<string>();
    for (let attempt = 0; attempt < 2000; attempt += 1) {
      slugs.add(generator.next());
    }

    expect(slugs.size).toBe(2000);
  });

  /**
   * Sin sesgo de módulo: `randomInt(30)` es uniforme, así que con 30 000 símbolos cada uno de los 30 aparece alrededor
   * de 1000 veces. Un `byte % 30` favorecería a los seis primeros y este margen lo delataría.
   */
  it('reparte los símbolos sin sesgo de módulo', () => {
    const counts = new Map<string, number>();
    for (let attempt = 0; attempt < 2500; attempt += 1) {
      for (const symbol of generator.next()) {
        counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
      }
    }

    expect(counts.size).toBe(PUBLIC_SLUG_ALPHABET.length);
    const expected = (2500 * PUBLIC_SLUG_LENGTH) / PUBLIC_SLUG_ALPHABET.length;
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(expected * 0.75);
      expect(count).toBeLessThan(expected * 1.25);
    }
  });
});

describe('los dobles deterministas', () => {
  it('siguen la secuencia declarada y después una derivada del índice', () => {
    const generator = new StubPublicSlugGenerator(['k7m2p9r4t6vw']);

    expect(generator.next()).toBe('k7m2p9r4t6vw');
    expect(generator.next()).toBe(sequentialPublicSlug(1));
    expect(generator.calls).toBe(2);
  });

  it('dan slugs con el formato del dominio', () => {
    expect(isValidPublicSlug(sequentialPublicSlug(0))).toBe(true);
    expect(isValidPublicSlug(sequentialPublicSlug(12_345))).toBe(true);
  });

  it('el constante repite siempre el mismo slug', () => {
    const generator = new ConstantPublicSlugGenerator('k7m2p9r4t6vw');

    expect([generator.next(), generator.next()]).toEqual([
      'k7m2p9r4t6vw',
      'k7m2p9r4t6vw',
    ]);
    expect(generator.calls).toBe(2);
  });
});
