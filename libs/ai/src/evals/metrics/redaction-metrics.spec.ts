import { describe, expect, it } from 'vitest';
import type { GoldenCase } from '../evaluable-task';
import {
  computeRedactionMetrics,
  scoreCaseRedaction,
  type RedactFn,
  defaultExternalRedact,
} from './redaction-metrics';

// Tarea 6.9: métricas de redacción.

function caseOf(
  id: string,
  partial: Partial<GoldenCase<unknown, unknown>> & {
    input: unknown;
  },
): GoldenCase<unknown, unknown> {
  return {
    line: 1,
    id,
    expected: {},
    tags: ['anonymized'],
    key: id,
    ...partial,
  };
}

describe('redaction metrics', () => {
  it('Sobre-redacción de una skill', () => {
    const redact: RedactFn = (input) => {
      const text = String((input as { text: string }).text);
      return { text: text.replace('NestJS', '[REDACTED]') };
    };
    const score = scoreCaseRedaction(
      caseOf('over', {
        input: { text: 'TypeScript y NestJS' },
        skills: ['TypeScript', 'NestJS'],
      }),
      redact,
    );
    expect(score.skillLoss).toBe(0.5);
  });

  it('Un lenguaje con símbolos no es sobre-redacción esperada', () => {
    const score = scoreCaseRedaction(
      caseOf('symbols', {
        input: {
          text: 'Experiencia con C#, C/C++, F# y .NET',
        },
        skills: ['C#', 'C/C++', 'F#', '.NET'],
      }),
    );
    expect(score.skillLoss).toBe(0);
  });

  it('Sobre-redacción del apellido que también es una ciudad', () => {
    const badNameRedact: RedactFn = (input) => {
      const text = String(
        typeof input === 'string'
          ? input
          : (input as { cv: { text: string } }).cv.text,
      );
      return text.replaceAll('Paz', '[NAME]').replaceAll('Flores', '[NAME]');
    };
    const score = scoreCaseRedaction(
      caseOf('collision-bad', {
        input: {
          cv: {
            text: 'Ana Paz Flores vive en La Paz y trabajó en Constructora Flores S.R.L.',
          },
        },
        personName: 'Ana Paz Flores',
        skills: ['La Paz', 'Constructora Flores S.R.L.'],
        pii: [{ type: 'name', value: 'Ana Paz Flores' }],
      }),
      badNameRedact,
    );
    expect(score.skillLoss).toBe(1);
  });

  it('El detector preciso no pierde la ciudad ni el empleador', () => {
    const score = scoreCaseRedaction(
      caseOf('collision-good', {
        input: {
          cv: {
            text: 'Ana Paz Flores\nLa Paz, Bolivia\nConstructora Flores S.R.L.\nTypeScript',
          },
        },
        personName: 'Ana Paz Flores',
        skills: ['La Paz', 'Constructora Flores S.R.L.'],
        pii: [{ type: 'name', value: 'Ana Paz Flores' }],
      }),
    );
    expect(score.skillLoss).toBe(0);
    expect(score.leakRate).toBe(0);
  });

  it('PII anotada que sobrevive a la redacción', () => {
    const redact: RedactFn = (input) => {
      const text = String((input as { text: string }).text);
      return {
        text: text
          .replace('a@b.io', '[EMAIL_1]')
          .replace('+591 70000001', '[PHONE_1]')
          .replace('Av. Ballivián 1234, Zona Sur', '[ADDRESS_1]'),
        // documento desnudo intacto
      };
    };
    const score = scoreCaseRedaction(
      caseOf('leak', {
        input: {
          text: 'a@b.io +591 70000001 Av. Ballivián 1234, Zona Sur 8765432',
        },
        pii: [
          { type: 'email', value: 'a@b.io' },
          { type: 'phone', value: '+591 70000001' },
          { type: 'address', value: 'Av. Ballivián 1234, Zona Sur' },
          { type: 'id', value: '8765432' },
        ],
      }),
      redact,
    );
    expect(score.leakRate).toBe(0.25);
  });

  it('Hueco conocido anotado que no rompe el suelo duro', () => {
    const redact: RedactFn = (input) => {
      const text = String((input as { text: string }).text);
      return {
        text: text
          .replace('a@b.io', '[EMAIL_1]')
          .replace('+591 70000001', '[PHONE_1]')
          .replace('Av. Ballivián 1234, Zona Sur', '[ADDRESS_1]'),
      };
    };
    const score = scoreCaseRedaction(
      caseOf('gap', {
        input: {
          text: 'a@b.io +591 70000001 Av. Ballivián 1234, Zona Sur 8765432',
        },
        pii: [
          { type: 'email', value: 'a@b.io' },
          { type: 'phone', value: '+591 70000001' },
          { type: 'address', value: 'Av. Ballivián 1234, Zona Sur' },
          {
            type: 'id',
            value: '8765432',
            knownGap: 'bare-id-without-keyword',
          },
        ],
      }),
      redact,
    );
    expect(score.leakRate).toBe(0);
    expect(score.knownGapRate).toBe(0.25);
    expect(score.observedGaps).toEqual([
      { gapId: 'bare-id-without-keyword', caseId: 'gap' },
    ]);
  });

  it('Hueco conocido que deja de filtrarse', () => {
    const redact: RedactFn = () => ({ text: '[ID_1]' });
    const score = scoreCaseRedaction(
      caseOf('closed', {
        input: { text: '8765432' },
        pii: [
          {
            type: 'id',
            value: '8765432',
            knownGap: 'bare-id-without-keyword',
          },
        ],
      }),
      redact,
    );
    expect(score.knownGapRate).toBe(0);
  });

  it('agrega medias saltando casos sin anotaciones computables', () => {
    const result = computeRedactionMetrics(
      [
        caseOf('with-skills', {
          input: { text: 'TypeScript' },
          skills: ['TypeScript'],
        }),
        caseOf('empty', { input: { text: 'nada' } }),
      ],
      defaultExternalRedact,
    );
    expect(result?.metrics.find((m) => m.name === 'redaction_skill_loss')?.value).toBe(
      0,
    );
  });
});
