import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PublicSlugGenerator } from '../application/ports/public-slug-generator.port';
import { PUBLIC_SLUG_ALPHABET, PUBLIC_SLUG_LENGTH } from '../domain/public-slug';

/**
 * Generador real de slugs públicos (D2): 12 símbolos del alfabeto del dominio con `randomInt` de `node:crypto`, que
 * sortea un entero uniforme en `[0, max)` y **no tiene el sesgo de módulo** de `Math.random() * n | 0` ni el de
 * `byte % 30`, que con 256 valores favorecería a los seis primeros símbolos del alfabeto.
 *
 * Es puro: no consulta la base de datos, así que dos slugs pueden coincidir; de eso se encargan el índice único parcial
 * y el reintento del repositorio.
 */
@Injectable()
export class RandomPublicSlugGenerator implements PublicSlugGenerator {
  next(): string {
    let slug = '';
    for (let position = 0; position < PUBLIC_SLUG_LENGTH; position += 1) {
      slug += PUBLIC_SLUG_ALPHABET.charAt(randomInt(PUBLIC_SLUG_ALPHABET.length));
    }
    return slug;
  }
}
