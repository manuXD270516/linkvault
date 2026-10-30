import { apiErrorCodeSchema } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { renderRequestError } from '../../../testing/request-error-testing';
import { API_ERROR_COPY } from './api-error-copy';

/** Vista sin tipo literal de la tabla, para recorrerla como lo hace el guardia (no como la ve el compilador). */
const table: Readonly<
  Record<string, { copy: string; reason?: string; files?: readonly string[] }>
> = API_ERROR_COPY;

describe('API_ERROR_COPY completeness', () => {
  it.each(apiErrorCodeSchema.options)(
    'every api error code has a copy decision: %s',
    (code) => {
      expect(
        Object.hasOwn(table, code),
        `falta la entrada de ${code} en API_ERROR_COPY`,
      ).toBe(true);
    },
  );

  it('the table names no code outside apiErrorCodeSchema', () => {
    const known: readonly string[] = apiErrorCodeSchema.options;
    const extra = Object.keys(table).filter((code) => !known.includes(code));
    expect(
      extra,
      `entradas para códigos que no existen: ${extra.join(', ')}`,
    ).toEqual([]);
  });

  it('every fallback or unreachable entry carries a reason', () => {
    for (const [code, entry] of Object.entries(table)) {
      if (entry.copy === 'fallback' || entry.copy === 'unreachable') {
        expect(entry.reason?.trim() ?? '', `${code} sin motivo`).not.toBe('');
      }
    }
  });

  it('every local entry names at least one file', () => {
    for (const [code, entry] of Object.entries(table)) {
      if (entry.copy === 'local') {
        expect(entry.files?.length ?? 0, `${code} sin fichero`).toBeGreaterThan(
          0,
        );
      }
    }
  });
});

const UNAVAILABLE =
  'LinkVault no está disponible en este momento. Inténtalo en unos minutos';
const UNEXPECTED = 'Algo salió mal. Inténtalo de nuevo';

const allCodes: readonly string[] = apiErrorCodeSchema.options;
const commonCodes = allCodes.filter((code) => table[code]?.copy === 'common');
const otherCodes = allCodes.filter((code) => table[code]?.copy !== 'common');

/** Coherencia en los dos sentidos entre la tabla y el componente común (ADR-062 §3). */
describe('API_ERROR_COPY against lv-request-error', () => {
  it.each(commonCodes)(
    'every common code renders an own text without reference: %s',
    (code) => {
      const view = renderRequestError({
        kind: 'api',
        status: 500,
        code,
        retryAfterMinutes: null,
      });
      expect(
        view.alert,
        `${code} es common pero el componente no le da texto propio`,
      ).not.toBe(UNEXPECTED);
      expect(
        view.alert,
        `${code} es common pero el componente no le da texto propio`,
      ).not.toBe(UNAVAILABLE);
      expect(view.reference, `${code} no debe llevar referencia`).toBeNull();
    },
  );

  it.each(otherCodes)('no other code renders an own text: %s', (code) => {
    const view = renderRequestError({
      kind: 'api',
      status: 500,
      code,
      retryAfterMinutes: null,
    });
    expect(
      view.alert,
      `${code} no es common pero el componente le da texto propio`,
    ).toBe(UNEXPECTED);
  });

  it.each([...allCodes, null])(
    'a 503 renders unavailable only for fallback codes or no code: %s',
    (code) => {
      const view = renderRequestError({
        kind: 'api',
        status: 503,
        code,
        retryAfterMinutes: null,
      });
      const entry = code === null ? undefined : table[code];
      const expectsUnavailable = code === null || entry?.copy === 'fallback';
      expect(
        view.alert === UNAVAILABLE,
        `${code ?? 'sin código'} con 503`,
      ).toBe(expectsUnavailable);
    },
  );
});
