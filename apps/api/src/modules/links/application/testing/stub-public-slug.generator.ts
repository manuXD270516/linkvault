import type { PublicSlugGenerator } from '../ports/public-slug-generator.port';
import {
  PUBLIC_SLUG_ALPHABET,
  PUBLIC_SLUG_LENGTH,
} from '../../domain/public-slug';

// Doble determinista del generador de slugs (D2 de public-preview-share), el gemelo de `StubInviteCodeGenerator` de
// `groups`. Un test puede fijar la secuencia entera —para provocar una colisión del índice— y, cuando se le acaba,
// sigue con slugs derivados del índice, todos con el formato del dominio.

export class StubPublicSlugGenerator implements PublicSlugGenerator {
  private index = 0;

  constructor(private readonly slugs: readonly string[] = []) {}

  /** Cuántos slugs se han pedido: distingue un reintento de un acierto a la primera. */
  get calls(): number {
    return this.index;
  }

  next(): string {
    const slug = this.slugs[this.index] ?? sequentialPublicSlug(this.index);
    this.index += 1;
    return slug;
  }
}

/** Generador que devuelve **siempre** el mismo slug: agota los reintentos del repositorio. */
export class ConstantPublicSlugGenerator implements PublicSlugGenerator {
  calls = 0;

  constructor(private readonly slug: string = sequentialPublicSlug(0)) {}

  next(): string {
    this.calls += 1;
    return this.slug;
  }
}

/** Slug con el formato del dominio a partir de un índice: `222222222222`, `222222222223`, … */
export function sequentialPublicSlug(index: number): string {
  let remaining = index;
  let slug = '';
  for (let position = 0; position < PUBLIC_SLUG_LENGTH; position += 1) {
    slug =
      PUBLIC_SLUG_ALPHABET.charAt(remaining % PUBLIC_SLUG_ALPHABET.length) +
      slug;
    remaining = Math.floor(remaining / PUBLIC_SLUG_ALPHABET.length);
  }
  return slug;
}
