import { beforeEach, describe, expect, it } from 'vitest';
import { ApplicationNotFound, InvalidNotes } from '../domain/errors';
import {
  applicationsHarness,
  objectId,
  type ApplicationsHarness,
} from './testing/applications-test-harness';

// Casos de uso `UpdateApplication`, `GetApplicationTimeline` y `UntrackApplication` (tareas 5.4 y 5.5).

const ANA = objectId(0xa1);
const BETO = objectId(0xb2);
const LINK = objectId(1);
const HOUR = 60 * 60 * 1000;

let h: ApplicationsHarness;

beforeEach(() => {
  h = applicationsHarness();
  h.links.withLink(LINK).readableBy(ANA, LINK);
});

async function tracked() {
  const { application } = await h.trackLink.execute(ANA, {
    linkId: LINK,
    status: 'interested',
  });
  return application;
}

describe('UpdateApplication', () => {
  it('Apuntar algo', async () => {
    const application = await tracked();
    h.clock.advance(HOUR);

    const updated = await h.update.execute(ANA, application.id, {
      notes: 'Piden inglés C1; escribir a RR. HH. el lunes',
    });

    expect(updated).toMatchObject({
      notes: 'Piden inglés C1; escribir a RR. HH. el lunes',
      version: 1,
      statusChangedAt: application.statusChangedAt,
      updatedAt: h.clock.now().toISOString(),
    });
    expect((await h.timeline.execute(ANA, application.id)).items).toHaveLength(
      1,
    );
  });

  it('Una nota no es un avance', async () => {
    const application = await tracked();
    h.clock.advance(5 * 24 * HOUR);

    const updated = await h.update.execute(ANA, application.id, {
      notes: 'nota',
      visibility: 'group',
    });

    expect(updated.statusChangedAt).toBe(application.statusChangedAt);
  });

  it('Dejar de compartir', async () => {
    const application = await tracked();
    await h.update.execute(ANA, application.id, { visibility: 'group' });

    const updated = await h.update.execute(ANA, application.id, {
      visibility: 'private',
    });

    expect(updated.visibility).toBe('private');
    expect(updated.version).toBe(1);
  });

  it('rejects notes longer than the limit (defensa del dominio)', async () => {
    const application = await tracked();

    await expect(
      h.update.execute(ANA, application.id, { notes: 'a'.repeat(2001) }),
    ).rejects.toBeInstanceOf(InvalidNotes);
  });
});

describe('GetApplicationTimeline', () => {
  it('Historial completo', async () => {
    const application = await tracked();
    h.clock.advance(HOUR);
    await h.changeStatus.execute(ANA, application.id, {
      status: 'applied',
      version: 1,
    });
    h.clock.advance(HOUR);
    await h.changeStatus.execute(ANA, application.id, {
      status: 'in_process',
      stageLabel: 'Entrevista',
      version: 2,
    });

    const { items } = await h.timeline.execute(ANA, application.id);

    expect(items.map((event) => [event.from, event.to])).toEqual([
      [undefined, 'interested'],
      ['interested', 'applied'],
      ['applied', 'in_process'],
    ]);
    expect(items[0]).not.toHaveProperty('from');
    expect(items[2]).toMatchObject({ stageLabel: 'Entrevista' });
  });
});

describe('Postulación ajena', () => {
  it('answers not found to change, read the history, edit and untrack, and leaves it intact', async () => {
    const application = await tracked();

    await expect(
      h.changeStatus.execute(BETO, application.id, {
        status: 'rejected',
        version: 1,
      }),
    ).rejects.toBeInstanceOf(ApplicationNotFound);
    await expect(
      h.timeline.execute(BETO, application.id),
    ).rejects.toBeInstanceOf(ApplicationNotFound);
    await expect(
      h.update.execute(BETO, application.id, { notes: 'x' }),
    ).rejects.toBeInstanceOf(ApplicationNotFound);
    await expect(
      h.untrack.execute(BETO, application.id),
    ).rejects.toBeInstanceOf(ApplicationNotFound);

    expect(await h.repository.findOwned(application.id, ANA)).toMatchObject({
      status: 'interested',
      notes: '',
      version: 1,
    });
  });

  it('answers the same for a malformed or unknown id', async () => {
    for (const id of ['no-es-un-id', objectId(999)]) {
      await expect(h.timeline.execute(ANA, id)).rejects.toBeInstanceOf(
        ApplicationNotFound,
      );
      await expect(h.untrack.execute(ANA, id)).rejects.toBeInstanceOf(
        ApplicationNotFound,
      );
    }
  });
});

describe('UntrackApplication', () => {
  it('Dejar de seguir una oferta', async () => {
    const application = await tracked();
    await h.changeStatus.execute(ANA, application.id, {
      status: 'applied',
      version: 1,
    });

    await h.untrack.execute(ANA, application.id);

    expect((await h.listMine.execute(ANA)).items).toEqual([]);
    expect(h.repository.allEvents).toEqual([]);
  });

  it('Volver a seguirla', async () => {
    const application = await tracked();
    await h.untrack.execute(ANA, application.id);

    const again = await h.trackLink.execute(ANA, {
      linkId: LINK,
      status: 'interested',
    });

    expect(again.created).toBe(true);
    expect(again.application.version).toBe(1);
    expect(again.application.id).not.toBe(application.id);
    expect(
      (await h.timeline.execute(ANA, again.application.id)).items,
    ).toHaveLength(1);
  });

  it('Cambiar una postulación que ya no existe', async () => {
    const application = await tracked();
    await h.untrack.execute(ANA, application.id);

    await expect(
      h.update.execute(ANA, application.id, { notes: 'x' }),
    ).rejects.toBeInstanceOf(ApplicationNotFound);
    await expect(h.untrack.execute(ANA, application.id)).rejects.toBeInstanceOf(
      ApplicationNotFound,
    );
    expect(h.repository.allEvents).toEqual([]);
  });
});
