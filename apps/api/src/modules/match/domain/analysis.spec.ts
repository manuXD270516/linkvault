import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MatchReport } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  MATCH_ANALYSIS_INITIAL_STEP,
  analysisInvariantViolation,
  createRunningAnalysis,
  isCvChanged,
  isStale,
  type MatchAnalysis,
} from './analysis';

const ANA = '66e9a0000000000000000a01';
const LINK = '66e9a0000000000000000b01';
const CV = '66e9a0000000000000000c01';
const OTHER_CV = '66e9a0000000000000000c02';
const NOW = new Date('2026-09-20T12:00:00.000Z');

const FULL_REPORT: MatchReport = {
  score: 70,
  matchedSkills: ['TypeScript'],
  missingSkills: [],
  suggestions: [],
  degraded: false,
};

function running(overrides: Partial<MatchAnalysis> = {}): MatchAnalysis {
  return {
    ...createRunningAnalysis({
      id: '66e9a0000000000000000m01',
      userId: ANA,
      linkId: LINK,
      cvId: CV,
      previewVersion: 1,
      promptVersion: 'v1',
      requestedAt: NOW,
    }),
    ...overrides,
  };
}

function done(overrides: Partial<MatchAnalysis> = {}): MatchAnalysis {
  const finishedAt = new Date(NOW.getTime() + 5_000);
  return {
    ...running(),
    status: 'done',
    step: 'done',
    report: FULL_REPORT,
    degraded: false,
    finishedAt,
    durationMs: 5_000,
    ...overrides,
  };
}

function failed(overrides: Partial<MatchAnalysis> = {}): MatchAnalysis {
  const finishedAt = new Date(NOW.getTime() + 5_000);
  return {
    ...running(),
    status: 'failed',
    step: 'failed',
    failureCode: 'internal_error',
    finishedAt,
    durationMs: 5_000,
    ...overrides,
  };
}

describe('createRunningAnalysis', () => {
  it('starts in running with the first progress step and no terminal fields', () => {
    const analysis = createRunningAnalysis({
      id: '66e9a0000000000000000m01',
      userId: ANA,
      linkId: LINK,
      cvId: CV,
      previewVersion: 3,
      promptVersion: 'v1',
      requestedAt: NOW,
    });

    expect(analysis).toMatchObject({
      status: 'running',
      step: MATCH_ANALYSIS_INITIAL_STEP,
      previewVersion: 3,
      promptVersion: 'v1',
      consentRequired: false,
      wentExternal: false,
    });
    expect(analysis.report).toBeUndefined();
    expect(analysis.failureCode).toBeUndefined();
    expect(analysis.finishedAt).toBeUndefined();
    expect(analysisInvariantViolation(analysis)).toBeUndefined();
  });
});

describe('analysisInvariantViolation', () => {
  it('accepts a done analysis with report and finishedAt, without failureCode', () => {
    expect(analysisInvariantViolation(done())).toBeUndefined();
  });

  it('rejects a done analysis with a failureCode', () => {
    expect(
      analysisInvariantViolation(done({ failureCode: 'internal_error' })),
    ).toMatch(/failure code/i);
  });

  it('rejects a done analysis without a report', () => {
    expect(
      analysisInvariantViolation(done({ report: undefined })),
    ).toMatch(/report/i);
  });

  it('accepts a failed analysis with failureCode and without report', () => {
    expect(analysisInvariantViolation(failed())).toBeUndefined();
  });

  it('rejects a failed analysis with a report', () => {
    expect(
      analysisInvariantViolation(failed({ report: FULL_REPORT })),
    ).toMatch(/report/i);
  });

  it('rejects a finished analysis without finishedAt', () => {
    expect(
      analysisInvariantViolation(done({ finishedAt: undefined })),
    ).toMatch(/finishedAt/i);
  });
});

describe('isStale / isCvChanged', () => {
  // Un análisis marcado stale o cvChanged se sigue devolviendo entero: las marcas avisan, no ocultan el informe.

  it.each([
    ['misma versión', 2, 2, false],
    ['versión mayor', 2, 3, true],
    ['versión menor', 3, 2, true],
  ] as const)(
    'isStale: %s → %s',
    (_label, analyzed, current, expected) => {
      expect(isStale({ previewVersion: analyzed }, current)).toBe(expected);
    },
  );

  it.each([
    ['mismo CV', CV, CV, false],
    ['otro CV marcado', CV, OTHER_CV, true],
    ['CV borrado (null)', CV, null, true],
    ['CV borrado (undefined)', CV, undefined, true],
  ] as const)(
    'isCvChanged: %s → %s',
    (_label, analyzedCvId, defaultCvId, expected) => {
      expect(isCvChanged({ cvId: analyzedCvId }, defaultCvId)).toBe(expected);
    },
  );
});

describe('domain layer isolation', () => {
  it('does not import nestjs, mongoose or bullmq', () => {
    const dir = import.meta.dirname;
    for (const file of [
      'analysis.ts',
      'errors.ts',
      'expiry.ts',
      'degraded-reason-vigencia.ts',
      'identifier.ts',
    ]) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source).not.toMatch(/@nestjs\/|mongoose|bullmq/);
    }
  });
});
