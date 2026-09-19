import { describe, expect, it } from 'vitest';
import type { Application } from './application.entity';
import { changeStatus, startTracking } from './application.entity';
import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from './application-status';
import { APPLIED_AT_FUTURE_MARGIN_MS, resolveAppliedAt } from './applied-at';
import { InvalidAppliedAt } from './errors';

// Regla de `appliedAt` por estado de destino (D3, ADR-024 §3), recorrida sobre todos los pares origen → destino, con y
// sin fecha previa y con y sin fecha enviada. La tabla esperada se escribe aparte de la implementación.

const NOW = new Date('2026-09-19T12:00:00.000Z');
const PREVIOUS = new Date('2026-09-03T09:00:00.000Z');
const SENT = new Date('2026-09-05T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;

type Expected = 'now' | 'sent' | 'previous' | 'none' | 'rejected';

/** Lo que dice la tabla de D3 para un destino, con y sin fecha previa y con y sin fecha enviada. */
function expectedFor(
  to: ApplicationStatus,
  hasPrevious: boolean,
  hasSent: boolean,
): Expected {
  switch (to) {
    case 'applied':
    case 'in_process':
    case 'offer':
    case 'accepted':
      if (hasPrevious) return 'previous';
      return hasSent ? 'sent' : 'now';
    case 'saved':
    case 'interested':
      return hasSent ? 'rejected' : 'none';
    case 'rejected':
    case 'withdrawn':
    case 'expired':
      if (hasSent) return 'rejected';
      return hasPrevious ? 'previous' : 'none';
  }
}

function application(
  status: ApplicationStatus,
  appliedAt: Date | undefined,
): Application {
  return {
    id: '66e9a0000000000000000009',
    userId: '66e9a00000000000000000a1',
    linkId: '66e9a0000000000000000001',
    status,
    // En `in_process` lleva etapa, para que ir de `in_process` a `in_process` sin etapa sea un cambio.
    ...(status === 'in_process' ? { stageLabel: 'Entrevista' } : {}),
    visibility: 'private',
    notes: '',
    ...(appliedAt === undefined ? {} : { appliedAt }),
    statusChangedAt: PREVIOUS,
    version: 3,
    createdAt: PREVIOUS,
    updatedAt: PREVIOUS,
  };
}

const cases = APPLICATION_STATUSES.flatMap((from) =>
  APPLICATION_STATUSES.flatMap((to) =>
    [false, true].flatMap((hasPrevious) =>
      [false, true].map((hasSent) => ({ from, to, hasPrevious, hasSent })),
    ),
  ),
);

describe('appliedAt for every pair of statuses', () => {
  it.each(cases)(
    '$from → $to, previous date: $hasPrevious, sent date: $hasSent',
    ({ from, to, hasPrevious, hasSent }) => {
      const current = application(from, hasPrevious ? PREVIOUS : undefined);
      const request = {
        status: to,
        stageLabel: null,
        ...(hasSent ? { appliedAt: SENT } : {}),
      };
      const expected = expectedFor(to, hasPrevious, hasSent);

      if (from === to && to !== 'in_process') {
        // Mismo estado y misma etapa: "sin cambios", que no toca la fecha aunque se envíe.
        expect(changeStatus(current, request, NOW)).toEqual({
          kind: 'unchanged',
        });
        return;
      }
      if (expected === 'rejected') {
        expect(() => changeStatus(current, request, NOW)).toThrow(
          InvalidAppliedAt,
        );
        return;
      }
      const change = changeStatus(current, request, NOW);
      if (change.kind !== 'changed') {
        throw new Error('expected a change');
      }
      const wanted = {
        now: NOW,
        sent: SENT,
        previous: PREVIOUS,
        none: undefined,
      }[expected];
      expect(change.write.appliedAt).toEqual(wanted);
      expect(change.next.appliedAt).toEqual(wanted);
    },
  );
});

describe('appliedAt scenarios', () => {
  it('Postular fija la fecha', () => {
    const change = changeStatus(
      application('interested', undefined),
      { status: 'applied' },
      NOW,
    );

    expect(change.kind === 'changed' && change.next.appliedAt).toEqual(NOW);
  });

  it('Postulé hace unos días', () => {
    const fourDaysAgo = new Date(NOW.getTime() - 4 * 24 * HOUR);
    const { application: created } = startTracking({
      userId: '66e9a00000000000000000a1',
      linkId: '66e9a0000000000000000001',
      status: 'applied',
      appliedAt: fourDaysAgo,
      now: NOW,
    });

    expect(created.appliedAt).toEqual(fourDaysAgo);
  });

  it('Reabrir sin fecha', () => {
    const change = changeStatus(
      application('rejected', undefined),
      { status: 'in_process' },
      NOW,
    );

    expect(change.kind === 'changed' && change.next.appliedAt).toEqual(NOW);
  });

  it('Con fecha previa, la enviada se ignora', () => {
    const change = changeStatus(
      application('applied', PREVIOUS),
      { status: 'offer', appliedAt: SENT },
      NOW,
    );

    expect(change.kind === 'changed' && change.next.appliedAt).toEqual(
      PREVIOUS,
    );
  });

  it('Fecha futura', () => {
    expect(() =>
      resolveAppliedAt({
        to: 'applied',
        requested: new Date(NOW.getTime() + 48 * HOUR),
        now: NOW,
      }),
    ).toThrow(InvalidAppliedAt);
  });

  it('rejects a future date even when a previous one would win', () => {
    expect(() =>
      resolveAppliedAt({
        to: 'offer',
        current: PREVIOUS,
        requested: new Date(NOW.getTime() + 48 * HOUR),
        now: NOW,
      }),
    ).toThrow(InvalidAppliedAt);
  });

  it('Hoy con el reloj del cliente adelantado', () => {
    const ahead = new Date(NOW.getTime() + 3 * HOUR);

    expect(
      resolveAppliedAt({ to: 'applied', requested: ahead, now: NOW }),
    ).toEqual(ahead);
  });

  it('accepts exactly 24 hours ahead and rejects one millisecond more', () => {
    const edge = new Date(NOW.getTime() + APPLIED_AT_FUTURE_MARGIN_MS);

    expect(
      resolveAppliedAt({ to: 'applied', requested: edge, now: NOW }),
    ).toEqual(edge);
    expect(() =>
      resolveAppliedAt({
        to: 'applied',
        requested: new Date(edge.getTime() + 1),
        now: NOW,
      }),
    ).toThrow(InvalidAppliedAt);
  });

  it('rejects a date that is not a date', () => {
    expect(() =>
      resolveAppliedAt({
        to: 'applied',
        requested: new Date('not a date'),
        now: NOW,
      }),
    ).toThrow(InvalidAppliedAt);
  });

  it('Deshacer un "Postulé" por error', () => {
    const change = changeStatus(
      application('applied', PREVIOUS),
      { status: 'interested' },
      NOW,
    );

    expect(change.kind === 'changed' && change.next).not.toHaveProperty(
      'appliedAt',
    );
  });

  it('Cerrar conserva la fecha', () => {
    const change = changeStatus(
      application('in_process', PREVIOUS),
      { status: 'rejected' },
      NOW,
    );

    expect(change.kind === 'changed' && change.next.appliedAt).toEqual(
      PREVIOUS,
    );
  });
});
