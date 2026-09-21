import { beforeEach, describe, expect, it } from 'vitest';
import type { AnalysisStepMessage, AnalysisStepPayload } from '@linkvault/shared';
import { DeliverAnalysisStep } from './deliver-analysis-step.usecase';
import type { AnalysisStepBroadcaster } from './ports/analysis-step-broadcaster.port';

// Reparto de `analysis.step` solo al dueño (tarea 3.2). Ana recibe, Beto no.

const ANA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const BETO = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ANALYSIS_ID = 'cccccccccccccccccccccccc';
const LINK_ID = 'dddddddddddddddddddddddd';

class InMemoryAnalysisStepBroadcaster implements AnalysisStepBroadcaster {
  readonly sent: { userId: string; message: AnalysisStepMessage }[] = [];
  private listening = true;

  withoutListeners(): this {
    this.listening = false;
    return this;
  }

  hasListeners(): boolean {
    return this.listening;
  }

  send(userId: string, message: AnalysisStepMessage): number {
    this.sent.push({ userId, message });
    return 1;
  }
}

let broadcaster: InMemoryAnalysisStepBroadcaster;
let deliver: DeliverAnalysisStep;

beforeEach(() => {
  broadcaster = new InMemoryAnalysisStepBroadcaster();
  deliver = new DeliverAnalysisStep(broadcaster);
});

function notice(userId: string): AnalysisStepPayload {
  return {
    analysisId: ANALYSIS_ID,
    linkId: LINK_ID,
    step: 'critiquing-suggestions',
    userId,
  };
}

describe('DeliverAnalysisStep', () => {
  it('Solo la dueña: Ana recibe y Beto no', () => {
    deliver.execute(notice(ANA));

    expect(broadcaster.sent).toHaveLength(1);
    expect(broadcaster.sent[0]?.userId).toBe(ANA);
    expect(broadcaster.sent[0]?.message).toEqual({
      analysisId: ANALYSIS_ID,
      linkId: LINK_ID,
      step: 'critiquing-suggestions',
    });
    expect(broadcaster.sent.map((e) => e.userId)).not.toContain(BETO);
  });

  it('El mensaje SSE no lleva userId ni CV', () => {
    deliver.execute(notice(ANA));
    const message = broadcaster.sent[0]?.message;
    expect(Object.keys(message ?? {}).sort()).toEqual([
      'analysisId',
      'linkId',
      'step',
    ]);
    const raw = JSON.stringify(message);
    expect(raw).not.toContain('userId');
    expect(raw).not.toContain('cvFragment');
    expect(raw).not.toContain('judgeScore');
    expect(raw).not.toMatch(/"suggestions"/);
  });

  it('Nadie escuchando', () => {
    broadcaster.withoutListeners();

    expect(deliver.execute(notice(ANA))).toBe(0);
    expect(broadcaster.sent).toEqual([]);
  });
});
