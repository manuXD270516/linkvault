import type { ApplicationStatus, TrackLinkRequest } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ApplicationConflict,
  ApplicationNotFound,
  InvalidAppliedAt,
  InvalidStageLabel,
} from '../domain/errors';
import {
  applicationsHarness,
  objectId,
  type ApplicationsHarness,
} from './testing/applications-test-harness';

const ANA = objectId(0xa1);
const BETO = objectId(0xb2);
const LINK = objectId(1);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let h: ApplicationsHarness;

beforeEach(() => {
  h = applicationsHarness();
  h.links.withLink(LINK).readableBy(ANA, LINK);
});

async function tracked(
  status: ApplicationStatus,
  extra: Partial<TrackLinkRequest> = {},
) {
  const { application } = await h.trackLink.execute(ANA, {
    linkId: LINK,
    status,
    ...extra,
  });
  return application;
}

function move(
  id: string,
  status: ApplicationStatus,
  version: number,
  extra: { stageLabel?: string | null; appliedAt?: string } = {},
) {
  h.clock.advance(HOUR);
  return h.changeStatus.execute(ANA, id, { status, version, ...extra });
}

async function eventsOf(id: string) {
  return (await h.timeline.execute(ANA, id)).items;
}

describe('Estados y transiciones', () => {
  it('Saltar etapas', async () => {
    const application = await tracked('interested');

    const moved = await move(application.id, 'in_process', 1);

    expect(moved).toMatchObject({ status: 'in_process', version: 2 });
    expect((await eventsOf(application.id)).at(-1)).toMatchObject({
      from: 'interested',
      to: 'in_process',
    });
  });

  it('Retroceder para corregir', async () => {
    const application = await tracked('applied');

    const moved = await move(application.id, 'interested', 1);

    expect(moved.status).toBe('interested');
    expect((await eventsOf(application.id)).map((event) => event.to)).toEqual([
      'applied',
      'interested',
    ]);
  });

  it('Cerrar desde cualquier estado', async () => {
    const application = await tracked('interested');

    expect((await move(application.id, 'rejected', 1)).status).toBe('rejected');
  });

  it('Reabrir una cerrada', async () => {
    const application = await tracked('rejected');

    expect((await move(application.id, 'in_process', 1)).status).toBe(
      'in_process',
    );
  });

  it('Corregir un cierre', async () => {
    const application = await tracked('rejected');

    expect((await move(application.id, 'withdrawn', 1)).status).toBe(
      'withdrawn',
    );
  });

  it('El mismo estado dos veces', async () => {
    const application = await tracked('applied');
    await move(application.id, 'in_process', 1);
    await move(application.id, 'applied', 2);

    const same = await move(application.id, 'applied', 3);

    expect(same.version).toBe(3);
    expect(await eventsOf(application.id)).toHaveLength(3);
  });

  it('Sin cambios desde una pestaña vieja', async () => {
    const application = await tracked('applied');
    await move(application.id, 'in_process', 1);
    await move(application.id, 'offer', 2);
    await move(application.id, 'applied', 3);

    const same = await move(application.id, 'applied', 2);

    expect(same).toMatchObject({ status: 'applied', version: 4 });
    expect(await eventsOf(application.id)).toHaveLength(4);
  });

  it('Cambio desde una pestaña vieja', async () => {
    const application = await tracked('interested');
    await move(application.id, 'applied', 1);

    await expect(move(application.id, 'rejected', 1)).rejects.toBeInstanceOf(
      ApplicationConflict,
    );
    expect(await h.repository.findOwned(application.id, ANA)).toMatchObject({
      status: 'applied',
      version: 2,
    });
    expect(await eventsOf(application.id)).toHaveLength(2);
  });

  it('answers not found when the application disappeared between the read and the write', async () => {
    const application = await tracked('interested');
    const original = h.repository.changeStatus.bind(h.repository);
    h.repository.changeStatus = async (id, userId, write, event) => {
      await h.repository.delete(id, userId);
      return await original(id, userId, write, event);
    };

    await expect(move(application.id, 'applied', 1)).rejects.toBeInstanceOf(
      ApplicationNotFound,
    );
  });

  it('answers a conflict when another tab won between the read and the write', async () => {
    const application = await tracked('interested');
    const original = h.repository.changeStatus.bind(h.repository);
    h.repository.changeStatus = async (id, userId, write, event) => {
      h.repository.overwrite(id, { version: 7 });
      return await original(id, userId, write, event);
    };

    await expect(move(application.id, 'applied', 1)).rejects.toBeInstanceOf(
      ApplicationConflict,
    );
  });

  it('Cambiar una postulación que ya no existe', async () => {
    const application = await tracked('interested');
    await h.untrack.execute(ANA, application.id);

    await expect(move(application.id, 'applied', 1)).rejects.toBeInstanceOf(
      ApplicationNotFound,
    );
    expect(h.repository.allEvents).toEqual([]);
  });

  it('Postulación ajena: changing it answers not found', async () => {
    const application = await tracked('interested');

    await expect(
      h.changeStatus.execute(BETO, application.id, {
        status: 'applied',
        version: 1,
      }),
    ).rejects.toBeInstanceOf(ApplicationNotFound);
    await expect(
      h.changeStatus.execute(ANA, 'no-es-un-id', {
        status: 'applied',
        version: 1,
      }),
    ).rejects.toBeInstanceOf(ApplicationNotFound);
  });
});

describe('Etapa libre solo en «En proceso»', () => {
  it('Etapa propia', async () => {
    const application = await tracked('applied');

    const moved = await move(application.id, 'in_process', 1, {
      stageLabel: '  Prueba técnica ',
    });

    expect(moved.stageLabel).toBe('Prueba técnica');
  });

  it('Cambiar de etapa sin cambiar de estado / Cambiar de etapa cuenta', async () => {
    const application = await tracked('in_process', {
      stageLabel: 'Prueba técnica',
    });

    const moved = await move(application.id, 'in_process', 1, {
      stageLabel: 'Entrevista con el equipo',
    });

    expect(moved.version).toBe(2);
    expect(moved.statusChangedAt).toBe(h.clock.now().toISOString());
    expect((await eventsOf(application.id)).at(-1)).toMatchObject({
      from: 'in_process',
      to: 'in_process',
      fromStageLabel: 'Prueba técnica',
      stageLabel: 'Entrevista con el equipo',
    });
  });

  it('Omitir la etapa la conserva', async () => {
    const application = await tracked('in_process', {
      stageLabel: 'Prueba técnica',
    });

    const same = await move(application.id, 'in_process', 1);

    expect(same).toMatchObject({ stageLabel: 'Prueba técnica', version: 1 });
    expect(await eventsOf(application.id)).toHaveLength(1);
  });

  it('Borrar la etapa con null', async () => {
    const application = await tracked('in_process', {
      stageLabel: 'Prueba técnica',
    });

    const moved = await move(application.id, 'in_process', 1, {
      stageLabel: null,
    });

    expect(moved).not.toHaveProperty('stageLabel');
    expect(moved.version).toBe(2);
    const last = (await eventsOf(application.id)).at(-1);
    expect(last).toMatchObject({ fromStageLabel: 'Prueba técnica' });
    expect(last).not.toHaveProperty('stageLabel');
  });

  it('Salir de «En proceso»', async () => {
    const application = await tracked('in_process', {
      stageLabel: 'Entrevista final',
    });

    const moved = await move(application.id, 'offer', 1);

    expect(moved).not.toHaveProperty('stageLabel');
    expect((await eventsOf(application.id)).at(-1)).toMatchObject({
      fromStageLabel: 'Entrevista final',
      to: 'offer',
    });
  });

  it('Etapa fuera de «En proceso» (defensa del dominio)', async () => {
    const application = await tracked('interested');

    await expect(
      move(application.id, 'applied', 1, { stageLabel: 'Entrevista' }),
    ).rejects.toBeInstanceOf(InvalidStageLabel);
  });
});

describe('Fecha de postulación', () => {
  it('Postular fija la fecha', async () => {
    const application = await tracked('interested');

    const moved = await move(application.id, 'applied', 1);

    expect(moved.appliedAt).toBe(h.clock.now().toISOString());
  });

  it('Saltar a «En proceso» con fecha', async () => {
    const application = await tracked('interested');
    const weekAgo = new Date(h.clock.now().getTime() - 7 * DAY).toISOString();

    const moved = await move(application.id, 'in_process', 1, {
      appliedAt: weekAgo,
    });

    expect(moved.appliedAt).toBe(weekAgo);
  });

  it('Con fecha previa, la enviada se ignora', async () => {
    const application = await tracked('applied');
    const sent = new Date(h.clock.now().getTime() + 2 * HOUR).toISOString();

    const moved = await move(application.id, 'offer', 1, { appliedAt: sent });

    expect(moved.appliedAt).toBe(application.appliedAt);
  });

  it('Fecha futura', async () => {
    const application = await tracked('interested');

    await expect(
      move(application.id, 'applied', 1, {
        appliedAt: new Date(h.clock.now().getTime() + 3 * DAY).toISOString(),
      }),
    ).rejects.toBeInstanceOf(InvalidAppliedAt);
  });

  it('Hoy con el reloj del cliente adelantado', async () => {
    const application = await tracked('interested');
    const ahead = new Date(h.clock.now().getTime() + 4 * HOUR).toISOString();

    const moved = await move(application.id, 'applied', 1, {
      appliedAt: ahead,
    });

    expect(moved.appliedAt).toBe(ahead);
  });

  it('Deshacer un «Postulé» por error', async () => {
    const application = await tracked('applied');

    const moved = await move(application.id, 'interested', 1);

    expect(moved).not.toHaveProperty('appliedAt');
  });

  it('Cerrar conserva la fecha', async () => {
    const application = await tracked('in_process');

    const moved = await move(application.id, 'rejected', 1);

    expect(moved.appliedAt).toBe(application.appliedAt);
  });

  it('Reabrir sin fecha', async () => {
    const application = await tracked('interested');
    await move(application.id, 'rejected', 1);

    const moved = await move(application.id, 'in_process', 2);

    expect(moved.appliedAt).toBe(h.clock.now().toISOString());
  });
});
