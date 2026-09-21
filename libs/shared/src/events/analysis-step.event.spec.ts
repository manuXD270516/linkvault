import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_STEP_CHANNEL,
  ANALYSIS_STEP_EVENT_NAME,
  ANALYSIS_STEP_EVENT_TYPE,
  analysisStepEvent,
  analysisStepEventSchema,
  analysisStepMessage,
  analysisStepMessageSchema,
  analysisStepPayloadSchema,
} from './analysis-step.event';

const payload = {
  analysisId: 'a1',
  linkId: 'l1',
  step: 'critiquing-suggestions',
  userId: 'u-ana',
} as const;

const message = {
  analysisId: 'a1',
  linkId: 'l1',
  step: 'revising-suggestions',
} as const;

describe('analysisStepEventSchema', () => {
  it('acepta un aviso completo con userId para enrutar', () => {
    const event = { type: ANALYSIS_STEP_EVENT_TYPE, payload } as const;
    expect(analysisStepEventSchema.parse(event)).toEqual(event);
  });

  it('rechaza un paso inventado y otro tipo de evento', () => {
    expect(
      analysisStepPayloadSchema.safeParse({
        ...payload,
        step: 'thinking',
      }).success,
    ).toBe(false);
    expect(
      analysisStepEventSchema.safeParse({
        type: 'AnalysisStep',
        payload,
      }).success,
    ).toBe(false);
  });

  it('rechaza un payload con campos de más (CV, score, sugerencias)', () => {
    expect(Object.keys(analysisStepPayloadSchema.shape)).toEqual([
      'analysisId',
      'linkId',
      'step',
      'userId',
    ]);
    expect(
      analysisStepEventSchema.safeParse({
        type: ANALYSIS_STEP_EVENT_TYPE,
        payload: {
          ...payload,
          cvFragment: 'SECRET_CV_FRAGMENT',
          score: 72,
          suggestions: [{ after: 'x' }],
        },
      }).success,
    ).toBe(false);
  });
});

describe('analysisStepEvent', () => {
  it('lleva el tipo versionado', () => {
    expect(analysisStepEvent(payload)).toEqual({
      type: 'AnalysisStep.v1',
      payload,
    });
  });
});

describe('canal del aviso', () => {
  it('nombra el canal de pasos de análisis', () => {
    expect(ANALYSIS_STEP_CHANNEL).toBe('events:analysis.step');
  });
});

describe('analysis.step sobre el canal SSE', () => {
  it('nombra el evento una sola vez para servidor y navegador', () => {
    expect(ANALYSIS_STEP_EVENT_NAME).toBe('analysis.step');
  });

  it('acepta solo analysisId, linkId y step', () => {
    expect(analysisStepMessageSchema.parse(analysisStepMessage(message))).toEqual(
      message,
    );
    expect(Object.keys(analysisStepMessageSchema.shape)).toEqual([
      'analysisId',
      'linkId',
      'step',
    ]);
  });

  it.each([
    ['userId', { ...message, userId: 'u-ana' }],
    ['score', { ...message, score: 0.9 }],
    ['suggestions', { ...message, suggestions: [] }],
    ['cvFragment', { ...message, cvFragment: 'SECRET' }],
    ['jobText', { ...message, jobText: 'vacante' }],
    ['prompt', { ...message, prompt: '…' }],
  ] as const)(
    'rechaza un mensaje SSE con %s de más',
    (_label, value) => {
      expect(analysisStepMessageSchema.safeParse(value).success).toBe(false);
    },
  );
});
