import { MATCH_FINAL_STEPS, isMatchFinalStep } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_FINAL_STEPS,
  DEGRADED_ANALYSIS_STEPS,
  FAILED_ANALYSIS_STEPS,
  FULL_ANALYSIS_STEPS,
  assertSequenceEndsWithFinal,
  stepsForOutcome,
} from './analysis-steps';

describe('analysis-steps', () => {
  it('Un análisis completo cuenta sus pasos', () => {
    expect(FULL_ANALYSIS_STEPS).toEqual([
      'reading-job',
      'comparing-cv',
      'drafting-suggestions',
      'critiquing-suggestions',
      'revising-suggestions',
      'done',
    ]);
    assertSequenceEndsWithFinal(FULL_ANALYSIS_STEPS);
    expect(stepsForOutcome('full')).toEqual(FULL_ANALYSIS_STEPS);
  });

  it('Un análisis básico se salta las sugerencias y el juez', () => {
    expect(DEGRADED_ANALYSIS_STEPS).toEqual([
      'reading-job',
      'comparing-cv',
      'done-degraded',
    ]);
    expect(DEGRADED_ANALYSIS_STEPS).not.toContain('drafting-suggestions');
    expect(DEGRADED_ANALYSIS_STEPS).not.toContain('critiquing-suggestions');
    expect(DEGRADED_ANALYSIS_STEPS).not.toContain('revising-suggestions');
    expect(DEGRADED_ANALYSIS_STEPS.at(-1)).toBe('done-degraded');
    assertSequenceEndsWithFinal(DEGRADED_ANALYSIS_STEPS);
  });

  it('Un análisis que no se pudo terminar', () => {
    expect(FAILED_ANALYSIS_STEPS.at(-1)).toBe('failed');
    assertSequenceEndsWithFinal(FAILED_ANALYSIS_STEPS);
    expect(stepsForOutcome('failed')).toEqual(FAILED_ANALYSIS_STEPS);
  });

  it('always ends with one of the three finals', () => {
    expect(ANALYSIS_FINAL_STEPS).toEqual(MATCH_FINAL_STEPS);
    for (const outcome of ['full', 'degraded', 'failed'] as const) {
      const last = stepsForOutcome(outcome).at(-1);
      expect(last !== undefined && isMatchFinalStep(last)).toBe(true);
    }
    expect(() =>
      assertSequenceEndsWithFinal(['reading-job', 'comparing-cv']),
    ).toThrow(/must end/);
  });
});
