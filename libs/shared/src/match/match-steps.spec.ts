import { describe, expect, it } from 'vitest';
import {
  MATCH_DEGRADED_SEQUENCE,
  MATCH_FINAL_STEPS,
  MATCH_FULL_SEQUENCE,
  MATCH_PROGRESS_STEPS,
  MATCH_STEPS,
  isMatchFinalStep,
  isMatchStepRegression,
  matchStepOrder,
  matchStepSchema,
} from './match-steps';

describe('matchStepSchema', () => {
  it('admite exactamente los pasos del conjunto cerrado', () => {
    expect(MATCH_STEPS).toEqual([
      'reading-job',
      'comparing-cv',
      'drafting-suggestions',
      'critiquing-suggestions',
      'revising-suggestions',
      'done',
      'done-degraded',
      'failed',
    ]);
    expect(matchStepSchema.options).toEqual([...MATCH_STEPS]);
  });

  it('rechaza un paso inventado', () => {
    expect(matchStepSchema.safeParse('thinking').success).toBe(false);
    expect(matchStepSchema.safeParse('drafting').success).toBe(false);
  });
});

describe('MATCH_FINAL_STEPS', () => {
  it('son exactamente tres', () => {
    expect(MATCH_FINAL_STEPS).toHaveLength(3);
    expect(MATCH_FINAL_STEPS).toEqual(['done', 'done-degraded', 'failed']);
  });

  it.each(MATCH_FINAL_STEPS)('reconoce %s como final', (step) => {
    expect(isMatchFinalStep(step)).toBe(true);
  });

  it.each(MATCH_PROGRESS_STEPS)('no trata %s como final', (step) => {
    expect(isMatchFinalStep(step)).toBe(false);
  });
});

describe('secuencias canónicas', () => {
  it('declara la secuencia completa aquí y no en api, worker ni web', () => {
    expect(MATCH_FULL_SEQUENCE).toEqual([
      'reading-job',
      'comparing-cv',
      'drafting-suggestions',
      'critiquing-suggestions',
      'revising-suggestions',
      'done',
    ]);
  });

  it('declara la secuencia degradada saltándose drafting y el juez por contrato', () => {
    expect(MATCH_DEGRADED_SEQUENCE).toEqual([
      'reading-job',
      'comparing-cv',
      'done-degraded',
    ]);
    expect(MATCH_DEGRADED_SEQUENCE).not.toContain('drafting-suggestions');
    expect(MATCH_DEGRADED_SEQUENCE).not.toContain('critiquing-suggestions');
    expect(MATCH_DEGRADED_SEQUENCE).not.toContain('revising-suggestions');
  });
});

describe('orden declarado', () => {
  it('avanza en los pasos de progreso', () => {
    expect(matchStepOrder('reading-job')).toBe(0);
    expect(matchStepOrder('comparing-cv')).toBe(1);
    expect(matchStepOrder('drafting-suggestions')).toBe(2);
    expect(matchStepOrder('critiquing-suggestions')).toBe(3);
    expect(matchStepOrder('revising-suggestions')).toBe(4);
  });

  it('pone los tres finales al mismo tope', () => {
    expect(matchStepOrder('done')).toBe(5);
    expect(matchStepOrder('done-degraded')).toBe(5);
    expect(matchStepOrder('failed')).toBe(5);
  });

  it.each([
    ['reading-job', 'comparing-cv', false],
    ['comparing-cv', 'drafting-suggestions', false],
    ['drafting-suggestions', 'critiquing-suggestions', false],
    ['critiquing-suggestions', 'revising-suggestions', false],
    ['comparing-cv', 'done-degraded', false],
    ['revising-suggestions', 'done', false],
    ['comparing-cv', 'reading-job', true],
    ['drafting-suggestions', 'comparing-cv', true],
    ['critiquing-suggestions', 'drafting-suggestions', true],
    ['revising-suggestions', 'critiquing-suggestions', true],
    ['done', 'comparing-cv', true],
    ['done-degraded', 'done', true],
    ['failed', 'reading-job', true],
    ['done', 'done', false],
  ] as const)(
    'de %s a %s es regresión: %s',
    (from, to, regression) => {
      expect(isMatchStepRegression(from, to)).toBe(regression);
    },
  );
});
