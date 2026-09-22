import {
  applicationListResponseSchema,
  applicationSchema,
  applicationTimelineResponseSchema,
  trackLinkResponseSchema,
  type Application,
  type ApplicationStatus,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createApplicationsTestApp,
  type ApplicationsTestApp,
} from '../../../test-support/applications-test-app';
import type { TestMember } from '../../../test-support/links-test-app';
import { sampleReport } from '../../match/application/testing/match-test-doubles';
import { AI_ANALYSES_COLLECTION } from '../../match/infrastructure/analysis.schemas';
import {
  APPLICATION_EVENTS_COLLECTION,
  APPLICATIONS_COLLECTION,
} from '../infrastructure/application.schemas';

// Endpoints de las postulaciones propias por HTTP (tareas 5.9 y 5.10 de applications-tracking), contra la app real y el
// MongoMemoryReplSet del preset de @linkvault/testing.

const UNKNOWN_ID = new mongoose.Types.ObjectId().toHexString();
const MALFORMED_ID = 'no-es-un-id';
const DAY = 24 * 60 * 60 * 1000;
let urlCounter = 3_811_000_000;

/** URL de una oferta distinta en cada llamada. */
function jobUrl(): string {
  urlCounter += 1;
  return `https://www.linkedin.com/jobs/view/${urlCounter}/`;
}

describe('applications endpoints', () => {
  let http: ApplicationsTestApp;
  let ana: TestMember;
  let beto: TestMember;

  beforeAll(async () => {
    http = await createApplicationsTestApp(
      'applications-http',
      getMongoTestUri(),
    );
    ana = await http.authenticated('Ana');
    beto = await http.authenticated('Beto');
  });

  afterAll(async () => {
    await http.close();
  });

  /** Link en un grupo de Ana y Beto, que ambos ven. */
  async function groupLink(): Promise<string> {
    const group = await http.createGroup(ana, 'Backend Bolivia');
    await http.join(beto, group);
    return (await http.save(ana, jobUrl(), group)).link.id;
  }

  /** Link en la lista privada de Ana. */
  async function privateLink(member = ana): Promise<string> {
    return (await http.save(member, jobUrl())).link.id;
  }

  function changeStatus(
    member: TestMember,
    id: string,
    body: Record<string, unknown>,
  ) {
    return http.request('PATCH', `/api/applications/${id}/status`, {
      authorization: member.authorization,
      body,
    });
  }

  async function moved(
    id: string,
    status: ApplicationStatus,
    version: number,
    extra: Record<string, unknown> = {},
  ): Promise<Application> {
    const response = await changeStatus(ana, id, { status, version, ...extra });
    expect(response.statusCode).toBe(200);
    return applicationSchema.parse(response.json());
  }

  async function eventsOf(member: TestMember, id: string) {
    return http.request('GET', `/api/applications/${id}/events`, {
      authorization: member.authorization,
    });
  }

  async function eventCount(applicationId: string): Promise<number> {
    return await http.connection
      .collection(APPLICATION_EVENTS_COLLECTION)
      .countDocuments({
        applicationId: new mongoose.Types.ObjectId(applicationId),
      });
  }

  describe('POST /api/applications', () => {
    it('«Postulé» desde la tarjeta', async () => {
      const linkId = await groupLink();

      const response = await http.trackRaw(beto, { linkId, status: 'applied' });

      expect(response.statusCode).toBe(201);
      const body = trackLinkResponseSchema.parse(response.json());
      expect(body.created).toBe(true);
      expect(body.application).toMatchObject({
        linkId,
        status: 'applied',
        visibility: 'private',
        version: 1,
        link: { id: linkId, platform: 'linkedin' },
      });
      const events = applicationTimelineResponseSchema.parse(
        (await eventsOf(beto, body.application.id)).json(),
      );
      expect(events.items).toHaveLength(1);
      expect(events.items[0]).not.toHaveProperty('from');
      expect(events.items[0]?.to).toBe('applied');
    });

    it('«Me interesa» desde la lista privada', async () => {
      const linkId = await privateLink();

      const { application } = await http.track(ana, linkId, 'interested');

      expect(application.status).toBe('interested');
    });

    it('Guardar no es seguir', async () => {
      const newcomer = await http.authenticated('Nueva');
      const group = await http.createGroup(newcomer, 'Recién creado');
      await http.save(newcomer, jobUrl(), group);
      const imported = await http.request('POST', '/api/links/import', {
        authorization: newcomer.authorization,
        body: { text: `Mira esta: ${jobUrl()} y esta ${jobUrl()}` },
      });
      expect(imported.statusCode).toBe(201);

      expect(await http.mine(newcomer)).toEqual([]);
    });

    it('Oferta que no se puede ver', async () => {
      const foreign = await privateLink(beto);

      const responses = await Promise.all(
        [foreign, UNKNOWN_ID, MALFORMED_ID].map((linkId) =>
          http.trackRaw(ana, { linkId, status: 'interested' }),
        ),
      );

      for (const response of responses) {
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({
          code: 'link_not_found',
          message: 'Link not found',
        });
      }
      expect(new Set(responses.map((response) => response.body)).size).toBe(1);
      expect(
        (await http.mine(ana)).filter((item) => item.linkId === foreign),
      ).toEqual([]);
    });

    it('Ya la seguía', async () => {
      const linkId = await privateLink();
      const first = await http.track(ana, linkId, 'in_process');

      const again = await http.track(ana, linkId, 'interested');

      expect(again.created).toBe(false);
      expect(again.application).toEqual(first.application);
      expect(await eventCount(first.application.id)).toBe(1);
    });

    it('Postulé hace unos días', async () => {
      const linkId = await privateLink();
      const fourDaysAgo = new Date(Date.now() - 4 * DAY).toISOString();

      const { application } = await http.track(ana, linkId, 'applied', {
        appliedAt: fourDaysAgo,
      });

      expect(application.appliedAt).toBe(fourDaysAgo);
    });

    it('Muchas personas, una oferta', async () => {
      const group = await http.createGroup(ana, 'Tres');
      const carla = await http.authenticated('Carla');
      await http.join(beto, group);
      await http.join(carla, group);
      const linkId = (await http.save(ana, jobUrl(), group)).link.id;

      for (const member of [ana, beto, carla]) {
        expect((await http.track(member, linkId)).created).toBe(true);
      }
    });
  });

  describe('GET /api/applications', () => {
    it('Tablero con lo que sigo', async () => {
      const owner = await http.authenticated('Dueña');
      const mate = await http.authenticated('Compañero');
      const group = await http.createGroup(owner, 'Tablero');
      await http.join(mate, group);
      const first = (await http.save(owner, jobUrl(), group)).link.id;
      const second = (await http.save(owner, jobUrl(), group)).link.id;
      const third = (await http.save(owner, jobUrl(), group)).link.id;
      await http.track(owner, first);
      await http.track(owner, second);
      await http.track(mate, third);

      const response = await http.request('GET', '/api/applications', {
        authorization: owner.authorization,
      });

      expect(response.statusCode).toBe(200);
      const body = applicationListResponseSchema.parse(response.json());
      expect(body.items.map((item) => item.linkId)).toEqual([second, first]);
      expect(body.items.every((item) => item.link.displayUrl.length > 0)).toBe(
        true,
      );
    });

    it('Estado propio de una página de tarjetas', async () => {
      const links = [
        await privateLink(),
        await privateLink(),
        await privateLink(),
      ];
      await http.track(ana, links[1] ?? '');

      const items = await http.mine(ana, [...links, MALFORMED_ID]);

      expect(items.map((item) => item.linkId)).toEqual([links[1]]);
    });

    it('answers 400 naming linkIds with 51 ids', async () => {
      const ids = Array.from({ length: 51 }, () =>
        new mongoose.Types.ObjectId().toHexString(),
      );

      const response = await http.request(
        'GET',
        `/api/applications?linkIds=${ids.join(',')}`,
        { authorization: ana.authorization },
      );

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'validation_error',
        fields: ['linkIds'],
      });
    });

    it('Se fue del grupo, conserva su proceso', async () => {
      const owner = await http.authenticated('Owner');
      const leaver = await http.authenticated('Se va');
      const group = await http.createGroup(owner, 'Del que se sale');
      await http.join(leaver, group);
      const linkId = (await http.save(owner, jobUrl(), group)).link.id;
      const { application } = await http.track(leaver, linkId, 'applied');

      const left = await http.request(
        'DELETE',
        `/api/groups/${group.id}/members/me`,
        { authorization: leaver.authorization },
      );
      expect(left.statusCode).toBe(204);

      const items = await http.mine(leaver);
      expect(items).toEqual([
        expect.objectContaining({
          id: application.id,
          status: 'applied',
          link: expect.objectContaining({ id: linkId }),
        }),
      ]);
      expect((await eventsOf(leaver, application.id)).statusCode).toBe(200);
    });
  });

  describe('DELETE /api/applications/:id', () => {
    it('Dejar de seguir una oferta', async () => {
      const linkId = await privateLink();
      const { application } = await http.track(ana, linkId);
      await moved(application.id, 'applied', 1);

      const response = await http.request(
        'DELETE',
        `/api/applications/${application.id}`,
        { authorization: ana.authorization },
      );

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
      expect(
        (await http.mine(ana)).filter((item) => item.id === application.id),
      ).toEqual([]);
      expect(await eventCount(application.id)).toBe(0);
    });

    it('Volver a seguirla', async () => {
      const linkId = await privateLink();
      const { application } = await http.track(ana, linkId);
      await http.request('DELETE', `/api/applications/${application.id}`, {
        authorization: ana.authorization,
      });

      const again = await http.track(ana, linkId, 'interested');

      expect(again.created).toBe(true);
      expect(again.application.version).toBe(1);
      expect(await eventCount(again.application.id)).toBe(1);
    });

    it('Cambiar una postulación que ya no existe', async () => {
      const linkId = await privateLink();
      const { application } = await http.track(ana, linkId);
      await http.request('DELETE', `/api/applications/${application.id}`, {
        authorization: ana.authorization,
      });

      const response = await changeStatus(ana, application.id, {
        status: 'applied',
        version: 1,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        code: 'application_not_found',
        message: 'Application not found',
      });
      expect(await eventCount(application.id)).toBe(0);
    });
  });

  describe('PATCH /api/applications/:id/status', () => {
    it('Saltar etapas y Retroceder para corregir', async () => {
      const { application } = await http.track(ana, await privateLink());

      expect(await moved(application.id, 'in_process', 1)).toMatchObject({
        status: 'in_process',
        version: 2,
      });
      expect((await moved(application.id, 'interested', 2)).status).toBe(
        'interested',
      );
      expect(await eventCount(application.id)).toBe(3);
    });

    it('Cerrar, Reabrir y Corregir un cierre', async () => {
      const { application } = await http.track(ana, await privateLink());

      expect((await moved(application.id, 'rejected', 1)).status).toBe(
        'rejected',
      );
      expect((await moved(application.id, 'withdrawn', 2)).status).toBe(
        'withdrawn',
      );
      expect((await moved(application.id, 'in_process', 3)).status).toBe(
        'in_process',
      );
    });

    it('Sin cambios desde una pestaña vieja', async () => {
      const { application } = await http.track(
        ana,
        await privateLink(),
        'applied',
      );
      await moved(application.id, 'offer', 1);
      await moved(application.id, 'applied', 2);

      const same = await moved(application.id, 'applied', 1);

      expect(same.version).toBe(3);
      expect(await eventCount(application.id)).toBe(3);
    });

    it('Cambio desde una pestaña vieja', async () => {
      const { application } = await http.track(ana, await privateLink());
      await moved(application.id, 'applied', 1);

      const response = await changeStatus(ana, application.id, {
        status: 'rejected',
        version: 1,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        code: 'application_conflict',
        message: expect.any(String),
      });
      expect(await eventCount(application.id)).toBe(2);
    });

    it('Editar notas no invalida un cambio de estado', async () => {
      const { application } = await http.track(ana, await privateLink());
      await moved(application.id, 'applied', 1);
      await http.request('PATCH', `/api/applications/${application.id}`, {
        authorization: ana.authorization,
        body: { notes: 'Escribir el lunes' },
      });

      expect((await moved(application.id, 'in_process', 2)).version).toBe(3);
    });

    it('Etapa propia, Cambiar de etapa y Borrar la etapa con null', async () => {
      const { application } = await http.track(ana, await privateLink());

      expect(
        (
          await moved(application.id, 'in_process', 1, {
            stageLabel: '  Prueba técnica ',
          })
        ).stageLabel,
      ).toBe('Prueba técnica');
      const omitted = await moved(application.id, 'in_process', 2);
      expect(omitted).toMatchObject({
        stageLabel: 'Prueba técnica',
        version: 2,
      });
      await moved(application.id, 'in_process', 2, {
        stageLabel: 'Entrevista con el equipo',
      });
      const cleared = await moved(application.id, 'in_process', 3, {
        stageLabel: null,
      });

      expect(cleared).not.toHaveProperty('stageLabel');
      expect(cleared.version).toBe(4);
      const events = applicationTimelineResponseSchema.parse(
        (await eventsOf(ana, application.id)).json(),
      ).items;
      expect(events.at(-1)).toMatchObject({
        from: 'in_process',
        to: 'in_process',
        fromStageLabel: 'Entrevista con el equipo',
      });
      expect(events.at(-1)).not.toHaveProperty('stageLabel');
    });

    it('Salir de «En proceso»', async () => {
      const { application } = await http.track(
        ana,
        await privateLink(),
        'in_process',
        {
          stageLabel: 'Entrevista final',
        },
      );

      const offer = await moved(application.id, 'offer', 1);

      expect(offer).not.toHaveProperty('stageLabel');
      const events = applicationTimelineResponseSchema.parse(
        (await eventsOf(ana, application.id)).json(),
      ).items;
      expect(events.at(-1)).toMatchObject({
        fromStageLabel: 'Entrevista final',
        to: 'offer',
      });
    });

    it('Estado desconocido', async () => {
      const { application } = await http.track(ana, await privateLink());

      const response = await changeStatus(ana, application.id, {
        status: 'hired',
        version: 1,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'validation_error',
        fields: ['status'],
      });
    });

    it('Etapa fuera de «En proceso»', async () => {
      const { application } = await http.track(ana, await privateLink());

      const response = await changeStatus(ana, application.id, {
        status: 'applied',
        stageLabel: 'Entrevista',
        version: 1,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'validation_error',
        fields: ['stageLabel'],
      });
    });

    it('Fecha futura', async () => {
      const { application } = await http.track(ana, await privateLink());

      const response = await changeStatus(ana, application.id, {
        status: 'applied',
        appliedAt: new Date(Date.now() + 2 * DAY).toISOString(),
        version: 1,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        code: 'validation_error',
        message: expect.any(String),
        fields: ['appliedAt'],
      });
    });

    it('Hoy con el reloj del cliente adelantado', async () => {
      const { application } = await http.track(ana, await privateLink());
      const ahead = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

      const response = await moved(application.id, 'applied', 1, {
        appliedAt: ahead,
      });

      expect(response.appliedAt).toBe(ahead);
    });

    it('Fecha con un estado que no la admite', async () => {
      const { application } = await http.track(ana, await privateLink());

      const response = await changeStatus(ana, application.id, {
        status: 'interested',
        appliedAt: new Date(Date.now() - DAY).toISOString(),
        version: 1,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'validation_error',
        fields: ['appliedAt'],
      });
    });

    it('Deshacer un «Postulé» por error, and Reabrir sin fecha', async () => {
      const { application } = await http.track(
        ana,
        await privateLink(),
        'applied',
      );

      expect(await moved(application.id, 'interested', 1)).not.toHaveProperty(
        'appliedAt',
      );
      await moved(application.id, 'rejected', 2);
      const reopened = await moved(application.id, 'in_process', 3);
      expect(reopened.appliedAt).toBeDefined();
    });
  });

  describe('PATCH /api/applications/:id', () => {
    it('Apuntar algo', async () => {
      const { application } = await http.track(ana, await privateLink());

      const response = await http.request(
        'PATCH',
        `/api/applications/${application.id}`,
        {
          authorization: ana.authorization,
          body: { notes: 'Piden inglés C1; escribir a RR. HH. el lunes' },
        },
      );

      expect(response.statusCode).toBe(200);
      expect(applicationSchema.parse(response.json())).toMatchObject({
        notes: 'Piden inglés C1; escribir a RR. HH. el lunes',
        version: 1,
        statusChangedAt: application.statusChangedAt,
      });
      expect(await eventCount(application.id)).toBe(1);
    });

    it('Nota demasiado larga', async () => {
      const { application } = await http.track(ana, await privateLink());

      const response = await http.request(
        'PATCH',
        `/api/applications/${application.id}`,
        { authorization: ana.authorization, body: { notes: 'a'.repeat(2001) } },
      );

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'validation_error',
        fields: ['notes'],
      });
    });

    it('Dejar de compartir', async () => {
      const { application } = await http.track(ana, await privateLink());
      await http.share(ana, application.id, 'group');

      const updated = await http.share(ana, application.id, 'private');

      expect(updated).toMatchObject({ visibility: 'private', version: 1 });
    });
  });

  describe('GET /api/applications/:id/events', () => {
    it('Historial completo', async () => {
      const { application } = await http.track(ana, await privateLink());
      await moved(application.id, 'applied', 1);
      await moved(application.id, 'in_process', 2, {
        stageLabel: 'Entrevista',
      });

      const response = await eventsOf(ana, application.id);

      expect(response.statusCode).toBe(200);
      const { items } = applicationTimelineResponseSchema.parse(
        response.json(),
      );
      expect(items.map((event) => event.to)).toEqual([
        'interested',
        'applied',
        'in_process',
      ]);
      expect(items[2]?.stageLabel).toBe('Entrevista');
    });
  });

  describe('Postulación ajena', () => {
    it('answers the same 404 to change, read the history, edit and untrack, and changes nothing', async () => {
      const { application } = await http.track(ana, await privateLink());

      const responses = [
        await changeStatus(beto, application.id, {
          status: 'rejected',
          version: 1,
        }),
        await eventsOf(beto, application.id),
        await http.request('PATCH', `/api/applications/${application.id}`, {
          authorization: beto.authorization,
          body: { notes: 'x' },
        }),
        await http.request('DELETE', `/api/applications/${application.id}`, {
          authorization: beto.authorization,
        }),
        await eventsOf(ana, UNKNOWN_ID),
        await eventsOf(ana, MALFORMED_ID),
      ];

      for (const response of responses) {
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({
          code: 'application_not_found',
          message: 'Application not found',
        });
      }
      const [stored] = await http.mine(ana, [application.linkId]);
      expect(stored).toMatchObject({
        status: 'interested',
        notes: '',
        version: 1,
      });
    });
  });
});

describe('applications fitScore derived on read (12.4–12.5)', () => {
  let http: ApplicationsTestApp;
  let ana: TestMember;
  let beto: TestMember;

  beforeAll(async () => {
    http = await createApplicationsTestApp(
      'applications-fit-score',
      getMongoTestUri(),
    );
    ana = await http.authenticated('Ana');
    beto = await http.authenticated('Beto');
  });

  afterAll(async () => {
    await http.close();
  });

  async function privateLink(member = ana): Promise<string> {
    return (await http.save(member, jobUrl())).link.id;
  }

  async function seedDoneAnalysis(params: {
    userId: string;
    linkId: string;
    score: number;
    degraded?: boolean;
    finishedAt: Date;
  }): Promise<void> {
    const report = sampleReport({
      score: params.score,
      ...(params.degraded === true
        ? { degraded: true, degradedReason: 'no_providers' as const }
        : {}),
    });
    await http.connection.collection(AI_ANALYSES_COLLECTION).insertOne({
      _id: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(params.userId),
      linkId: new mongoose.Types.ObjectId(params.linkId),
      cvId: new mongoose.Types.ObjectId(),
      status: 'done',
      step: params.degraded === true ? 'done-degraded' : 'done',
      previewVersion: 1,
      promptVersion: 'v1',
      report,
      degraded: params.degraded === true,
      ...(params.degraded === true
        ? { degradedReason: 'no_providers' }
        : {}),
      consentRequired: false,
      wentExternal: false,
      requestedAt: new Date(params.finishedAt.getTime() - 1_000),
      finishedAt: params.finishedAt,
      durationMs: 1_000,
    });
  }

  it('La puntuación aparece tras el análisis', async () => {
    const linkId = await privateLink();
    const tracked = await http.track(ana, linkId);
    expect(tracked.application).not.toHaveProperty('fitScore');

    await seedDoneAnalysis({
      userId: ana.userId,
      linkId,
      score: 78,
      finishedAt: new Date('2026-09-20T12:00:00.000Z'),
    });

    const [listed] = await http.mine(ana, [linkId]);
    expect(listed).toMatchObject({ fitScore: 78, fitScoreDegraded: false });
  });

  it('Rehacer el análisis manda', async () => {
    const linkId = await privateLink();
    await http.track(ana, linkId);
    await seedDoneAnalysis({
      userId: ana.userId,
      linkId,
      score: 78,
      finishedAt: new Date('2026-09-20T12:00:00.000Z'),
    });
    await seedDoneAnalysis({
      userId: ana.userId,
      linkId,
      score: 63,
      finishedAt: new Date('2026-09-20T13:00:00.000Z'),
    });

    const [listed] = await http.mine(ana, [linkId]);
    expect(listed).toMatchObject({ fitScore: 63, fitScoreDegraded: false });
  });

  it('El análisis nuevo sale básico y el número anterior desaparece', async () => {
    const linkId = await privateLink();
    await http.track(ana, linkId);
    await seedDoneAnalysis({
      userId: ana.userId,
      linkId,
      score: 78,
      finishedAt: new Date('2026-09-20T12:00:00.000Z'),
    });
    await seedDoneAnalysis({
      userId: ana.userId,
      linkId,
      score: 41,
      degraded: true,
      finishedAt: new Date('2026-09-20T13:00:00.000Z'),
    });

    const [listed] = await http.mine(ana, [linkId]);
    expect(listed?.fitScoreDegraded).toBe(true);
    expect(listed).not.toHaveProperty('fitScore');
  });

  it('Seguir una oferta ya analizada', async () => {
    const linkId = await privateLink();
    await seedDoneAnalysis({
      userId: ana.userId,
      linkId,
      score: 81,
      finishedAt: new Date('2026-09-20T12:00:00.000Z'),
    });

    const response = await http.trackRaw(ana, {
      linkId,
      status: 'interested',
    });
    expect(response.statusCode).toBe(201);
    const body = trackLinkResponseSchema.parse(response.json());
    expect(body.application).toMatchObject({
      fitScore: 81,
      fitScoreDegraded: false,
    });
  });

  it('La puntuación no se hereda de otra persona', async () => {
    const group = await http.createGroup(ana, 'Fit score isolation');
    await http.join(beto, group);
    const linkId = (await http.save(ana, jobUrl(), group)).link.id;
    await http.track(ana, linkId);
    await http.track(beto, linkId);
    await seedDoneAnalysis({
      userId: ana.userId,
      linkId,
      score: 78,
      finishedAt: new Date('2026-09-20T12:00:00.000Z'),
    });

    const [betoApp] = await http.mine(beto, [linkId]);
    expect(betoApp).not.toHaveProperty('fitScore');
    expect(betoApp).not.toHaveProperty('fitScoreDegraded');
  });

  it('Nadie escribe la puntuación', async () => {
    const linkId = await privateLink();
    const tracked = await http.track(ana, linkId);
    const before = await http.connection
      .collection(APPLICATIONS_COLLECTION)
      .findOne({
        _id: new mongoose.Types.ObjectId(tracked.application.id),
      });

    await seedDoneAnalysis({
      userId: ana.userId,
      linkId,
      score: 78,
      finishedAt: new Date('2026-09-20T12:00:00.000Z'),
    });

    const after = await http.connection
      .collection(APPLICATIONS_COLLECTION)
      .findOne({
        _id: new mongoose.Types.ObjectId(tracked.application.id),
      });
    expect(after).toEqual(before);
    expect(after).not.toHaveProperty('fitScore');
    expect(after?.['version']).toBe(1);
  });

  it('La puntuación no pisa a las pestañas abiertas', async () => {
    const linkId = await privateLink();
    const tracked = await http.track(ana, linkId);
    await seedDoneAnalysis({
      userId: ana.userId,
      linkId,
      score: 78,
      finishedAt: new Date('2026-09-20T12:00:00.000Z'),
    });

    const response = await http.request(
      'PATCH',
      `/api/applications/${tracked.application.id}/status`,
      {
        authorization: ana.authorization,
        body: { status: 'applied', version: 1 },
      },
    );
    expect(response.statusCode).toBe(200);
    const body = applicationSchema.parse(response.json());
    expect(body.version).toBe(2);
    expect(body).toMatchObject({ fitScore: 78, fitScoreDegraded: false });

    const events = applicationTimelineResponseSchema.parse(
      (
        await http.request(
          'GET',
          `/api/applications/${tracked.application.id}/events`,
          { authorization: ana.authorization },
        )
      ).json(),
    );
    expect(events.items).toHaveLength(2);
    expect(events.items[1]?.to).toBe('applied');
  });

  it('Sin análisis, sin nada que limpiar', async () => {
    const linkId = await privateLink();
    const tracked = await http.track(ana, linkId);
    const cvId = new mongoose.Types.ObjectId();
    await http.connection.collection(AI_ANALYSES_COLLECTION).insertOne({
      _id: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(ana.userId),
      linkId: new mongoose.Types.ObjectId(linkId),
      cvId,
      status: 'done',
      step: 'done',
      previewVersion: 1,
      promptVersion: 'v1',
      report: sampleReport({ score: 78 }),
      degraded: false,
      consentRequired: false,
      wentExternal: false,
      requestedAt: new Date('2026-09-20T11:59:00.000Z'),
      finishedAt: new Date('2026-09-20T12:00:00.000Z'),
      durationMs: 1_000,
    });

    const [withScore] = await http.mine(ana, [linkId]);
    expect(withScore).toMatchObject({ fitScore: 78, fitScoreDegraded: false });

    await http.connection
      .collection(AI_ANALYSES_COLLECTION)
      .deleteMany({ cvId });

    const [without] = await http.mine(ana, [linkId]);
    expect(without).not.toHaveProperty('fitScore');
    expect(without).not.toHaveProperty('fitScoreDegraded');
    expect(without?.version).toBe(tracked.application.version);
  });
});
