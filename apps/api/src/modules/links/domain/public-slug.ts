// Formato del slug del enlace público. Vive en `@linkvault/shared` (D10 de public-preview-share) porque lo comparten la
// API y el SPA, y el dominio lo reexporta desde aquí para tener una sola puerta y, sobre todo, **un solo alfabeto**: una
// segunda copia acabaría aceptando slugs que la otra rechaza.
//
// La comparación es exacta y sensible a mayúsculas: un slug con otra caja es un slug que no existe (D2).

export {
  isValidPublicSlug,
  PUBLIC_SLUG_ALPHABET,
  PUBLIC_SLUG_LENGTH,
} from '@linkvault/shared';
