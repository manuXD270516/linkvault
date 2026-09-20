// Puerto del generador de slugs públicos (D2 de public-preview-share, ADR-027 §2). El generador es **puro**: no
// consulta la base de datos, así que nada de check-then-insert, que no cerraría la carrera de dos publicaciones
// simultáneas. La unicidad la garantiza el índice único parcial sobre `publicShare.slug`.
//
// Lo consume el **repositorio**, no los casos de uso, igual que `INVITE_CODE_GENERATOR` en `groups`: un `E11000` no es
// un concepto de aplicación, y quien sabe qué índice rechazó la escritura es quien la hizo. Vive en `application/`
// porque lo comparten los dos adaptadores, el de Mongo y el de memoria.

export const PUBLIC_SLUG_GENERATOR = Symbol('PUBLIC_SLUG_GENERATOR');

export interface PublicSlugGenerator {
  /** Slug nuevo con el formato de `domain/public-slug` (12 símbolos del alfabeto). */
  next(): string;
}
