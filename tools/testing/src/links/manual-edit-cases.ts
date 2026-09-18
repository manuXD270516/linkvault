// Casos de "qué se guarda en `replaced`" cuando alguien escribe un campo del preview a mano (D4 de link-enrichment,
// ADR-010), como tabla de datos.
//
// La regla la aplican **dos** funciones, a propósito: `applyManualEdit` en `apps/api/.../domain/preview-edit.ts`, que
// es la que corre cuando alguien edita de verdad, y `applyManualField` en `apps/worker/.../domain/merge.ts`, que el
// worker necesita para mezclar una reextracción sin pisar lo escrito. Están duplicadas porque son dos módulos y el
// dominio de uno no puede importar el del otro; lo que no puede duplicarse es la regla, porque si divergen "Volver a
// lo extraído" devolvería a cosas distintas según quién tocara el campo.
//
// Lo que se comparte son los casos, no el código: el spec de cada lado itera esta tabla contra su propia función. Un
// cambio en una de las dos que no esté en la otra deja el spec del otro lado en rojo, que es la única forma de que la
// duplicación siga siendo deliberada y no un accidente.
//
// Los valores son cadenas y la tabla no dice de qué campo son: cada spec elige el suyo (los dos usan `title`). Quién
// edita y cuándo tampoco están aquí; los pone cada spec con sus propias constantes.

/** Procedencia del campo antes de la edición. Ausente significa un campo que nadie había escrito todavía. */
export type ManualEditStoredEntry =
  | {
      readonly source: 'auto';
      readonly value: string;
      readonly extractor: string;
    }
  | {
      readonly source: 'manual';
      readonly value: string;
      /** Lo automático que aquella edición anterior desplazó, si desplazó algo. */
      readonly replaced?: {
        readonly value: string;
        readonly extractor: string;
      };
    };

/** Un caso: lo que había, lo que se escribe encima y lo que la entrada resultante debe guardar en `replaced`. */
export interface ManualEditReplacedCase {
  readonly name: string;
  readonly stored?: ManualEditStoredEntry;
  /** El valor que la persona escribe ahora. */
  readonly edit: string;
  /** `replaced` esperado; ausente cuando no hay ningún valor automático que ofrecer. */
  readonly expected?: { readonly value: string; readonly extractor: string };
}

export const MANUAL_EDIT_REPLACED_CASES: readonly ManualEditReplacedCase[] = [
  {
    name: 'sobre un valor automático: se guarda ese valor y su extractor',
    stored: {
      source: 'auto',
      value: 'Arquitecto(a) de Soluciones',
      extractor: 'json-ld',
    },
    edit: 'Arquitecto de Soluciones (Java)',
    expected: {
      value: 'Arquitecto(a) de Soluciones',
      extractor: 'json-ld',
    },
  },
  {
    name: 'sobre otra edición: se conserva el automático original, no la edición anterior',
    stored: {
      source: 'manual',
      value: 'Lo de Ana',
      replaced: { value: 'Lo extraído', extractor: 'json-ld' },
    },
    edit: 'Lo de Beto',
    expected: { value: 'Lo extraído', extractor: 'json-ld' },
  },
  {
    name: 'sobre una edición que no desplazó nada: sigue sin haber nada que guardar',
    stored: { source: 'manual', value: 'Lo de Ana' },
    edit: 'Lo de Beto',
  },
  {
    name: 'sobre un campo que nadie había escrito: no hay nada que guardar',
    edit: 'Lo de Ana',
  },
];
