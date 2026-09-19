import {
  PASTED_PREVIEW_EXTRACTOR,
  type PreviewSources,
} from '@linkvault/shared';

// Casos de "qué se guarda en `replaced`" cuando una persona sustituye un campo del preview —escribiéndolo a mano o
// pegando la descripción— y de a qué vuelve "Volver a lo anterior" (D4 de link-enrichment, D3 de
// paste-job-description, ADR-010), como tabla de datos.
//
// La regla: quien sustituye un campo guarda en `replaced` la entrada desplazada **completa** —valor, origen, extractor,
// autor y fecha—, sin su propio `replaced`, y volver la recupera tal cual. Deshacer llega un nivel atrás. Pegar nunca
// toca un campo escrito a mano ni lo que guardaba para deshacerse.
//
// Quién aplica cada acción:
// - `manual` y `revert`: `applyManualEdit` en `apps/api/.../domain/preview-edit.ts`, que es la que corre cuando alguien
//   edita, y el helper de test del worker que modela lo que `api` escribe.
// - `pasted`: solo `api`, con `applyPastedPreview` (tarea 3.4 de paste-job-description). El worker no pega nunca.
//
// Lo que se comparte son los casos, no el código: el spec de cada lado itera esta tabla contra su propia función. Lo
// que impide que las dos copias del merge diverjan en **quién pisa a quién** es otra cosa, `mayOverwrite` de
// `libs/shared`; esta tabla fija lo que se guarda para deshacer.
//
// Los valores son cadenas y la tabla no dice de qué campo son: cada spec elige el suyo (todos usan `title`). Las
// entradas llevan su autor y su fecha porque `replaced` los guarda; quien actúa y cuándo son `CASE_ACTOR` y
// `CASE_ACTED_AT`, que cada spec usa al ejecutar la acción para que lo esperado sea un dato y no un cálculo.

/** Ana escribió o pegó lo que había guardado. */
export const CASE_ANA = '66e9a00000000000000000a1';

/** Beto pegó o escribió lo que había antes todavía. */
export const CASE_BETO = '66e9a00000000000000000b2';

/** Quien actúa en cada caso: escribe, pega o pide volver. */
export const CASE_ACTOR = '66e9a00000000000000000c3';

/** Cuándo se escribió lo que el campo guardaba para deshacerse. */
export const CASE_EARLIER = '2026-09-10T10:00:00.000Z';

/** Cuándo se escribió lo que el campo tiene ahora. */
export const CASE_BEFORE = '2026-09-15T10:00:00.000Z';

/** Cuándo actúa `CASE_ACTOR`. */
export const CASE_ACTED_AT = '2026-09-18T12:00:00.000Z';

/** Una entrada de procedencia de `title`, tal y como se guarda. */
export type TitleSourceEntry = NonNullable<PreviewSources['title']>;

/**
 * Un `replaced` de antes de paste-job-description: `{ value, extractor }`, sin origen ni fecha, siempre de un valor
 * automático. Siguen en la base de datos y se leen como `auto`.
 */
export interface LegacyReplaced {
  readonly value: string;
  readonly extractor: string;
}

/** Lo que el campo tenía antes de actuar. Ausente significa un campo que nadie había escrito todavía. */
export type ReplacedCaseStored =
  | TitleSourceEntry
  | {
      readonly value: string;
      readonly source: 'manual';
      readonly by: string;
      readonly at: string;
      readonly replaced: LegacyReplaced;
    };

/** Un caso: lo que había, lo que se hace y cómo queda la entrada del campo. */
export type PreviewReplacedCase =
  | {
      readonly name: string;
      readonly stored?: ReplacedCaseStored;
      /** `CASE_ACTOR` escribe (`manual`) o pega (`pasted`) `value` en `CASE_ACTED_AT`. */
      readonly action: 'manual' | 'pasted';
      readonly value: string;
      /** La entrada completa del campo después de actuar. */
      readonly expected: TitleSourceEntry;
    }
  | {
      readonly name: string;
      readonly stored?: ReplacedCaseStored;
      /** `CASE_ACTOR` pide volver a lo anterior en `CASE_ACTED_AT`. */
      readonly action: 'revert';
      /** La entrada del campo después de volver; ausente cuando el campo queda sin valor ni procedencia. */
      readonly expected?: TitleSourceEntry;
    };

const readFromPage = {
  value: 'Arquitecto(a) de Soluciones',
  source: 'auto',
  extractor: 'json-ld',
  at: CASE_EARLIER,
} as const satisfies TitleSourceEntry;

const pastedByBeto = {
  value: 'Arquitecto de Soluciones',
  source: 'pasted',
  extractor: PASTED_PREVIEW_EXTRACTOR,
  by: CASE_BETO,
  at: CASE_EARLIER,
} as const satisfies TitleSourceEntry;

const writtenByBeto = {
  value: 'Lo de Beto',
  source: 'manual',
  by: CASE_BETO,
  at: CASE_EARLIER,
} as const satisfies TitleSourceEntry;

export const PREVIEW_REPLACED_CASES: readonly PreviewReplacedCase[] = [
  // Escribir a mano.
  {
    name: 'manual sobre automático: se guarda la entrada leída de la página, completa',
    stored: { ...readFromPage, at: CASE_BEFORE },
    action: 'manual',
    value: 'Arquitecto de Soluciones (Java)',
    expected: {
      value: 'Arquitecto de Soluciones (Java)',
      source: 'manual',
      by: CASE_ACTOR,
      at: CASE_ACTED_AT,
      replaced: { ...readFromPage, at: CASE_BEFORE },
    },
  },
  {
    name: 'manual sobre pegado: se guarda lo pegado, con quien lo pegó, sin lo que eso guardaba',
    stored: {
      ...pastedByBeto,
      by: CASE_ANA,
      at: CASE_BEFORE,
      replaced: readFromPage,
    },
    action: 'manual',
    value: 'Arquitecto de Soluciones (Java)',
    expected: {
      value: 'Arquitecto de Soluciones (Java)',
      source: 'manual',
      by: CASE_ACTOR,
      at: CASE_ACTED_AT,
      replaced: { ...pastedByBeto, by: CASE_ANA, at: CASE_BEFORE },
    },
  },
  // Escribir a mano sobre lo que ya escribió otra persona NO desplaza nada nuevo: el campo sigue guardando lo que dijo
  // la página o el pegado. "Volver" desde un campo escrito a mano devuelve a la fuente, no a una corrección intermedia:
  // es la regla que `link-enrichment` ya publicó y probó, y cambiarla sin decidirlo sería peor que no tenerla.
  {
    name: 'manual sobre otra edición: se conserva lo que dijo la fuente, no la corrección anterior',
    stored: {
      value: 'Lo de Ana',
      source: 'manual',
      by: CASE_ANA,
      at: CASE_BEFORE,
      replaced: readFromPage,
    },
    action: 'manual',
    value: 'Lo de Carla',
    expected: {
      value: 'Lo de Carla',
      source: 'manual',
      by: CASE_ACTOR,
      at: CASE_ACTED_AT,
      replaced: readFromPage,
    },
  },
  {
    name: 'manual sobre una edición antigua: su replaced sin origen se conserva, leído como automático',
    stored: {
      value: 'Lo de Ana',
      source: 'manual',
      by: CASE_ANA,
      at: CASE_BEFORE,
      replaced: { value: 'Arquitecto(a) de Soluciones', extractor: 'json-ld' },
    },
    action: 'manual',
    value: 'Lo de Carla',
    expected: {
      value: 'Lo de Carla',
      source: 'manual',
      by: CASE_ACTOR,
      at: CASE_ACTED_AT,
      replaced: {
        value: 'Arquitecto(a) de Soluciones',
        source: 'auto',
        extractor: 'json-ld',
      },
    },
  },
  {
    name: 'manual sobre un campo que nadie había escrito: no hay nada que guardar',
    action: 'manual',
    value: 'Lo de Carla',
    expected: {
      value: 'Lo de Carla',
      source: 'manual',
      by: CASE_ACTOR,
      at: CASE_ACTED_AT,
    },
  },

  // Pegar la descripción.
  {
    name: 'pegado sobre automático: se guarda la entrada leída de la página, completa',
    stored: { ...readFromPage, at: CASE_BEFORE },
    action: 'pasted',
    value: 'Arquitecto de Soluciones',
    expected: {
      value: 'Arquitecto de Soluciones',
      source: 'pasted',
      extractor: PASTED_PREVIEW_EXTRACTOR,
      by: CASE_ACTOR,
      at: CASE_ACTED_AT,
      replaced: { ...readFromPage, at: CASE_BEFORE },
    },
  },
  {
    name: 'pegado sobre pegado: se guarda lo que pegó el anterior, sin lo que eso guardaba',
    stored: {
      ...pastedByBeto,
      at: CASE_BEFORE,
      replaced: readFromPage,
    },
    action: 'pasted',
    value: 'Arquitecta de Datos',
    expected: {
      value: 'Arquitecta de Datos',
      source: 'pasted',
      extractor: PASTED_PREVIEW_EXTRACTOR,
      by: CASE_ACTOR,
      at: CASE_ACTED_AT,
      replaced: { ...pastedByBeto, at: CASE_BEFORE },
    },
  },
  {
    name: 'Pegar no pisa lo escrito a mano',
    stored: {
      value: 'Lo de Ana',
      source: 'manual',
      by: CASE_ANA,
      at: CASE_BEFORE,
      replaced: pastedByBeto,
    },
    action: 'pasted',
    value: 'Arquitecta de Datos',
    expected: {
      value: 'Lo de Ana',
      source: 'manual',
      by: CASE_ANA,
      at: CASE_BEFORE,
      replaced: pastedByBeto,
    },
  },
  {
    name: 'pegado sobre un campo que nadie había escrito: no hay nada que guardar',
    action: 'pasted',
    value: 'Arquitecto de Soluciones',
    expected: {
      value: 'Arquitecto de Soluciones',
      source: 'pasted',
      extractor: PASTED_PREVIEW_EXTRACTOR,
      by: CASE_ACTOR,
      at: CASE_ACTED_AT,
    },
  },

  // Volver a lo anterior.
  {
    name: 'Volver a lo extraído',
    stored: {
      value: 'Lo de Ana',
      source: 'manual',
      by: CASE_ANA,
      at: CASE_BEFORE,
      replaced: readFromPage,
    },
    action: 'revert',
    expected: readFromPage,
  },
  {
    name: 'Volver a lo pegado',
    stored: {
      value: 'Lo de Ana',
      source: 'manual',
      by: CASE_ANA,
      at: CASE_BEFORE,
      replaced: pastedByBeto,
    },
    action: 'revert',
    expected: pastedByBeto,
  },
  {
    name: 'Volver a lo leído de la página',
    stored: {
      ...pastedByBeto,
      by: CASE_ANA,
      at: CASE_BEFORE,
      replaced: readFromPage,
    },
    action: 'revert',
    expected: readFromPage,
  },
  {
    name: 'La oferta equivocada, deshecha',
    stored: {
      value: 'Arquitecta de Datos',
      source: 'pasted',
      extractor: PASTED_PREVIEW_EXTRACTOR,
      by: CASE_ANA,
      at: CASE_BEFORE,
      replaced: pastedByBeto,
    },
    action: 'revert',
    expected: pastedByBeto,
  },
  {
    name: 'volver a una edición anterior: vuelve con su autor',
    stored: {
      value: 'Lo de Ana',
      source: 'manual',
      by: CASE_ANA,
      at: CASE_BEFORE,
      replaced: writtenByBeto,
    },
    action: 'revert',
    expected: writtenByBeto,
  },
  {
    name: 'volver en un campo antiguo: lo automático sin fecha vuelve con la de ahora',
    stored: {
      value: 'Lo de Ana',
      source: 'manual',
      by: CASE_ANA,
      at: CASE_BEFORE,
      replaced: { value: 'Arquitecto(a) de Soluciones', extractor: 'json-ld' },
    },
    action: 'revert',
    expected: {
      value: 'Arquitecto(a) de Soluciones',
      source: 'auto',
      extractor: 'json-ld',
      at: CASE_ACTED_AT,
    },
  },
  {
    name: 'volver en un campo que no sustituyó nada: queda sin valor',
    stored: {
      value: 'Lo de Ana',
      source: 'manual',
      by: CASE_ANA,
      at: CASE_BEFORE,
    },
    action: 'revert',
  },
];
