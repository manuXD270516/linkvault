import {
  APPLICATION_STATUSES as SHARED_STATUSES,
  APPLIED_AT_STATUSES as SHARED_APPLIED_AT_STATUSES,
  CLOSED_STATUSES as SHARED_CLOSED_STATUSES,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  acceptsAppliedAt,
  APPLICATION_STATUSES,
  APPLIED_AT_STATUSES,
  clearsAppliedAt,
  CLOSED_STATUSES,
  isApplicationStatus,
  isClosedStatus,
  isSameState,
} from './application-status';

describe('application statuses', () => {
  it('match the shared contract', () => {
    expect([...APPLICATION_STATUSES]).toEqual([...SHARED_STATUSES]);
    expect([...CLOSED_STATUSES]).toEqual([...SHARED_CLOSED_STATUSES]);
    expect([...APPLIED_AT_STATUSES]).toEqual([...SHARED_APPLIED_AT_STATUSES]);
  });

  it('recognizes only the canonical statuses', () => {
    expect(isApplicationStatus('in_process')).toBe(true);
    expect(isApplicationStatus('hired')).toBe(false);
    expect(isApplicationStatus('IN_PROCESS')).toBe(false);
  });

  it.each([
    ['rejected', true],
    ['withdrawn', true],
    ['expired', true],
    ['accepted', false],
    ['offer', false],
  ] as const)('%s is a closure: %s', (status, closed) => {
    expect(isClosedStatus(status)).toBe(closed);
  });

  it('splits the statuses by what they do with appliedAt', () => {
    expect(APPLICATION_STATUSES.filter(acceptsAppliedAt)).toEqual([
      'applied',
      'in_process',
      'offer',
      'accepted',
    ]);
    expect(APPLICATION_STATUSES.filter(clearsAppliedAt)).toEqual([
      'saved',
      'interested',
    ]);
  });
});

describe('isSameState', () => {
  it('is the same status and the same stage', () => {
    expect(isSameState({ status: 'applied' }, { status: 'applied' })).toBe(
      true,
    );
    expect(
      isSameState(
        { status: 'in_process', stageLabel: 'Entrevista' },
        { status: 'in_process', stageLabel: 'Entrevista' },
      ),
    ).toBe(true);
  });

  it('differs by status or by stage', () => {
    expect(isSameState({ status: 'applied' }, { status: 'offer' })).toBe(false);
    expect(
      isSameState(
        { status: 'in_process', stageLabel: 'Prueba técnica' },
        { status: 'in_process', stageLabel: 'Entrevista' },
      ),
    ).toBe(false);
    expect(
      isSameState(
        { status: 'in_process', stageLabel: 'Prueba técnica' },
        { status: 'in_process' },
      ),
    ).toBe(false);
  });
});
