/**
 * Ids de oferta únicos por spec y por ejecución. Los links de LinkedIn y Trabajopolis se deduplican por su id numérico
 * (`linkedin:<id>`), así que dos specs que arrancan en paralelo en el mismo milisegundo y usaban `Date.now()` como id
 * guardaban **la misma** oferta: la segunda se fundía con la primera y conservaba su título. Cada spec tiene su franja:
 * `Date.now() * 100 + franja * 10`, con hasta 10 ids consecutivos dentro de ella (`base`, `base + 1`…).
 */
export const JOB_ID_SLOTS = {
  links: 0,
  groups: 1,
  applications: 2,
  comments: 3,
  public: 4,
  match: 5,
} as const;

export function jobIdBase(slot: (typeof JOB_ID_SLOTS)[keyof typeof JOB_ID_SLOTS]): number {
  return Date.now() * 100 + slot * 10;
}
