import { describe, expect, it } from 'vitest';
import {
  APPLICATION_NOTES_MAX_LENGTH,
  changeStatus,
  editApplication,
  startTracking,
  type Application,
  type StatusChange,
} from './application.entity';
import type { ApplicationStatus } from './application-status';
import { InvalidNotes, InvalidStageLabel } from './errors';

const USER = '66e9a00000000000000000a1';
const LINK = '66e9a0000000000000000001';
const CREATED = new Date('2026-09-10T10:00:00.000Z');
const NOW = new Date('2026-09-19T12:00:00.000Z');

function existing(overrides: Partial<Application> = {}): Application {
  return {
    id: '66e9a0000000000000000009',
    userId: USER,
    linkId: LINK,
    status: 'interested',
    visibility: 'private',
    notes: '',
    statusChangedAt: CREATED,
    version: 1,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

function changed(change: StatusChange) {
  if (change.kind !== 'changed') {
    throw new Error('expected a change');
  }
  return change;
}

describe('startTracking', () => {
  it('is born private, with version 1, statusChangedAt and a first event without origin', () => {
    const { application, event } = startTracking({
      userId: USER,
      linkId: LINK,
      status: 'applied',
      now: NOW,
    });

    expect(application).toEqual({
      userId: USER,
      linkId: LINK,
      status: 'applied',
      visibility: 'private',
      notes: '',
      appliedAt: NOW,
      statusChangedAt: NOW,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(event).toEqual({ to: 'applied', at: NOW });
  });

  it('keeps a stage only with in_process', () => {
    const { application, event } = startTracking({
      userId: USER,
      linkId: LINK,
      status: 'in_process',
      stageLabel: '  Entrevista ',
      now: NOW,
    });

    expect(application.stageLabel).toBe('Entrevista');
    expect(event).toEqual({
      to: 'in_process',
      stageLabel: 'Entrevista',
      at: NOW,
    });
    expect(() =>
      startTracking({
        userId: USER,
        linkId: LINK,
        status: 'applied',
        stageLabel: 'Entrevista',
        now: NOW,
      }),
    ).toThrow(InvalidStageLabel);
  });

  it('has no fitScore', () => {
    const { application } = startTracking({
      userId: USER,
      linkId: LINK,
      status: 'interested',
      now: NOW,
    });

    expect(application).not.toHaveProperty('fitScore');
  });
});

describe('changeStatus', () => {
  it('Saltar etapas', () => {
    const change = changed(
      changeStatus(existing(), { status: 'in_process' }, NOW),
    );

    expect(change.next.status).toBe('in_process');
    expect(change.next.version).toBe(2);
    expect(change.write).toMatchObject({
      expectedVersion: 1,
      status: 'in_process',
      statusChangedAt: NOW,
    });
    expect(change.event).toEqual({
      from: 'interested',
      to: 'in_process',
      at: NOW,
    });
  });

  it('Retroceder para corregir', () => {
    const change = changed(
      changeStatus(
        existing({ status: 'applied', appliedAt: CREATED }),
        { status: 'interested' },
        NOW,
      ),
    );

    expect(change.next.status).toBe('interested');
    expect(change.event).toEqual({
      from: 'applied',
      to: 'interested',
      at: NOW,
    });
  });

  it.each([
    'saved',
    'interested',
    'applied',
    'in_process',
    'offer',
    'accepted',
  ] as const)(
    'Cerrar desde cualquier estado: %s → rejected',
    (from: ApplicationStatus) => {
      expect(
        changed(
          changeStatus(existing({ status: from }), { status: 'rejected' }, NOW),
        ).next.status,
      ).toBe('rejected');
    },
  );

  it('Reabrir una cerrada', () => {
    const change = changed(
      changeStatus(
        existing({ status: 'rejected' }),
        { status: 'in_process' },
        NOW,
      ),
    );

    expect(change.next.status).toBe('in_process');
  });

  it('Corregir un cierre', () => {
    const change = changed(
      changeStatus(
        existing({ status: 'rejected' }),
        { status: 'withdrawn' },
        NOW,
      ),
    );

    expect(change.event).toEqual({
      from: 'rejected',
      to: 'withdrawn',
      at: NOW,
    });
  });

  it('El mismo estado dos veces', () => {
    expect(
      changeStatus(
        existing({ status: 'applied', version: 3, appliedAt: CREATED }),
        { status: 'applied' },
        NOW,
      ),
    ).toEqual({ kind: 'unchanged' });
  });

  it('is unchanged even with a sent appliedAt', () => {
    expect(
      changeStatus(
        existing({ status: 'applied', appliedAt: CREATED }),
        { status: 'applied', appliedAt: NOW },
        NOW,
      ),
    ).toEqual({ kind: 'unchanged' });
  });

  it('Omitir la etapa la conserva', () => {
    expect(
      changeStatus(
        existing({
          status: 'in_process',
          stageLabel: 'Prueba técnica',
          version: 5,
        }),
        { status: 'in_process' },
        NOW,
      ),
    ).toEqual({ kind: 'unchanged' });
  });

  it('Borrar la etapa con null', () => {
    const change = changed(
      changeStatus(
        existing({
          status: 'in_process',
          stageLabel: 'Prueba técnica',
          version: 5,
        }),
        { status: 'in_process', stageLabel: null },
        NOW,
      ),
    );

    expect(change.next).not.toHaveProperty('stageLabel');
    expect(change.write).not.toHaveProperty('stageLabel');
    expect(change.next.version).toBe(6);
    expect(change.event).toEqual({
      from: 'in_process',
      to: 'in_process',
      fromStageLabel: 'Prueba técnica',
      at: NOW,
    });
  });

  it('Salir de «En proceso»', () => {
    const change = changed(
      changeStatus(
        existing({ status: 'in_process', stageLabel: 'Entrevista final' }),
        { status: 'offer' },
        NOW,
      ),
    );

    expect(change.next).not.toHaveProperty('stageLabel');
    expect(change.event).toEqual({
      from: 'in_process',
      to: 'offer',
      fromStageLabel: 'Entrevista final',
      at: NOW,
    });
  });

  it('Cambiar de etapa sin cambiar de estado', () => {
    const change = changed(
      changeStatus(
        existing({
          status: 'in_process',
          stageLabel: 'Prueba técnica',
          version: 2,
        }),
        { status: 'in_process', stageLabel: 'Entrevista con el equipo' },
        NOW,
      ),
    );

    expect(change.next.version).toBe(3);
    expect(change.next.statusChangedAt).toEqual(NOW);
    expect(change.event).toEqual({
      from: 'in_process',
      to: 'in_process',
      fromStageLabel: 'Prueba técnica',
      stageLabel: 'Entrevista con el equipo',
      at: NOW,
    });
  });

  it('Etapa propia', () => {
    const change = changed(
      changeStatus(
        existing({ status: 'applied', appliedAt: CREATED }),
        { status: 'in_process', stageLabel: '  Prueba técnica ' },
        NOW,
      ),
    );

    expect(change.next.stageLabel).toBe('Prueba técnica');
  });

  it('enters in_process from another status without a stage when it is omitted', () => {
    const change = changed(
      changeStatus(
        existing({ status: 'applied' }),
        { status: 'in_process' },
        NOW,
      ),
    );

    expect(change.next).not.toHaveProperty('stageLabel');
  });

  it('rejects a stage with another status', () => {
    expect(() =>
      changeStatus(
        existing(),
        { status: 'applied', stageLabel: 'Entrevista' },
        NOW,
      ),
    ).toThrow(InvalidStageLabel);
  });

  it('keeps notes, visibility and the creation date; never writes a score', () => {
    const change = changed(
      changeStatus(
        existing({ notes: 'nota', visibility: 'group' }),
        { status: 'applied' },
        NOW,
      ),
    );

    expect(change.next).toMatchObject({
      notes: 'nota',
      visibility: 'group',
      createdAt: CREATED,
    });
    expect(change.next).not.toHaveProperty('fitScore');
    expect(change.write).not.toHaveProperty('fitScore');
    expect(change.write).not.toHaveProperty('fitScoreDegraded');
  });
});

describe('editApplication', () => {
  it('Apuntar algo', () => {
    expect(
      editApplication(
        { notes: 'Piden inglés C1; escribir a RR. HH. el lunes' },
        NOW,
      ),
    ).toEqual({
      notes: 'Piden inglés C1; escribir a RR. HH. el lunes',
      updatedAt: NOW,
    });
  });

  it('never writes a fit score', () => {
    const write = editApplication(
      { notes: 'x', visibility: 'group' },
      NOW,
    );
    expect(write).not.toHaveProperty('fitScore');
    expect(write).not.toHaveProperty('fitScoreDegraded');
    expect(Object.keys(write).sort()).toEqual([
      'notes',
      'updatedAt',
      'visibility',
    ]);
  });

  it('Una nota no es un avance: no toca la versión ni statusChangedAt', () => {
    const write = editApplication({ notes: 'x', visibility: 'group' }, NOW);

    expect(Object.keys(write).sort()).toEqual([
      'notes',
      'updatedAt',
      'visibility',
    ]);
  });

  it('clears the notes with an empty string', () => {
    expect(editApplication({ notes: '' }, NOW)).toEqual({
      notes: '',
      updatedAt: NOW,
    });
  });

  it('rejects notes longer than the limit', () => {
    expect(() =>
      editApplication(
        { notes: 'a'.repeat(APPLICATION_NOTES_MAX_LENGTH + 1) },
        NOW,
      ),
    ).toThrow(InvalidNotes);
    expect(
      editApplication({ notes: 'a'.repeat(APPLICATION_NOTES_MAX_LENGTH) }, NOW)
        .notes,
    ).toHaveLength(APPLICATION_NOTES_MAX_LENGTH);
  });
});
