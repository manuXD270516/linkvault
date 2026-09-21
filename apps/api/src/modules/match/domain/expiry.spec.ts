import { describe, expect, it } from 'vitest';
import { createRunningAnalysis, type MatchAnalysis } from './analysis';
import {
  effectiveFinishedAt,
  isRunningExpired,
  readAnalysis,
} from './expiry';

const MAX_AGE_MS = 60_000;
const REQUESTED = new Date('2026-09-20T12:00:00.000Z');

function running(): MatchAnalysis {
  return createRunningAnalysis({
    id: '66e9a0000000000000000m01',
    userId: '66e9a0000000000000000a01',
    linkId: '66e9a0000000000000000b01',
    cvId: '66e9a0000000000000000c01',
    previewVersion: 1,
    promptVersion: 'v1',
    requestedAt: REQUESTED,
  });
}

describe('readAnalysis / expiry', () => {
  it.each([
    [
      'dentro del plazo',
      new Date(REQUESTED.getTime() + MAX_AGE_MS - 1),
      'running' as const,
    ],
    [
      'justo en el plazo',
      new Date(REQUESTED.getTime() + MAX_AGE_MS),
      'running' as const,
    ],
    [
      'vencido por un milisegundo',
      new Date(REQUESTED.getTime() + MAX_AGE_MS + 1),
      'failed' as const,
    ],
  ])('%s → %s', (_label, now, expectedStatus) => {
    const viewed = readAnalysis(running(), MAX_AGE_MS, now);
    expect(viewed.status).toBe(expectedStatus);
    if (expectedStatus === 'failed') {
      expect(viewed).toMatchObject({
        failureCode: 'internal_error',
        step: 'failed',
        finishedAt: new Date(REQUESTED.getTime() + MAX_AGE_MS),
        durationMs: MAX_AGE_MS,
      });
    }
  });

  it('ya done: la lectura no lo convierte en failed', () => {
    const finishedAt = new Date(REQUESTED.getTime() + 5_000);
    const done: MatchAnalysis = {
      ...running(),
      status: 'done',
      step: 'done',
      report: {
        score: 50,
        matchedSkills: [],
        missingSkills: [],
        suggestions: [],
        degraded: false,
      },
      finishedAt,
      durationMs: 5_000,
    };

    const viewed = readAnalysis(
      done,
      MAX_AGE_MS,
      new Date(REQUESTED.getTime() + MAX_AGE_MS + 10_000),
    );

    expect(viewed).toBe(done);
    expect(viewed.status).toBe('done');
  });

  it('El análisis se quedó colgado', () => {
    const viewed = readAnalysis(
      running(),
      MAX_AGE_MS,
      new Date(REQUESTED.getTime() + MAX_AGE_MS + 1),
    );

    expect(viewed.status).toBe('failed');
    expect(viewed.failureCode).toBe('internal_error');
  });

  it('El plazo de la consulta no adelanta al del trabajo', () => {
    const stillRunning = readAnalysis(
      running(),
      MAX_AGE_MS,
      new Date(REQUESTED.getTime() + MAX_AGE_MS),
    );

    expect(stillRunning.status).toBe('running');
    expect(isRunningExpired(running(), MAX_AGE_MS, REQUESTED)).toBe(false);
  });

  it('la lectura no muta nada', () => {
    const original = running();
    const snapshot = { ...original };
    readAnalysis(
      original,
      MAX_AGE_MS,
      new Date(REQUESTED.getTime() + MAX_AGE_MS + 1),
    );

    expect(original).toEqual(snapshot);
    expect(original.status).toBe('running');
    expect(original.failureCode).toBeUndefined();
  });

  it('effectiveFinishedAt de un vencido es requestedAt + maxAgeMs', () => {
    expect(effectiveFinishedAt(running(), MAX_AGE_MS)).toEqual(
      new Date(REQUESTED.getTime() + MAX_AGE_MS),
    );
  });
});
