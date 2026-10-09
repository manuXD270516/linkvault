import {
  jobLinkSummarySchema,
  publicPreviewResponseSchema,
  saveLinkResponseSchema,
  type GroupDetail,
  type JobLinkSummary,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createLinksTestApp,
  type InjectResponse,
  type LinksTestApp,
  type TestMember,
} from '../../test-support/links-test-app';
import { pastedGoldenInput } from '../../test-support/pasted-golden';
import { DeliverLinkEnriched } from './application/deliver-link-enriched.usecase';
import { JOB_LINKS_COLLECTION } from './infrastructure/link.schemas';

// H1 de usage-guide-fixes (ADR-055 §2), de punta a punta con la app completa y MongoDB (replica set en memoria): el
// nombre de quien escribió o pegó un campo del preview solo sale para quien comparte algún grupo con esa persona.
//
// Escenario. Ana Quiroga completa a mano y pega en un link de su grupo (con enlace público). Beto Mamani es del mismo
// grupo. Carla Benítez no comparte ningún grupo con Ana y guarda la misma URL (dedupe de ADR-008: recibe el link
// canónico, con la procedencia de Ana). Dani Rojas comparte con Ana **otro** grupo, distinto del del link, y guarda la
// misma URL en privado: la regla es «cualquier grupo en común» (N13), no «el grupo del link».
//
// Los nombres de prueba no comparten subcadenas (nada de «Ana» dentro de otro nombre), así que `not.toContain` sobre el
// JSON **serializado** no puede dar un falso positivo ni un falso negativo.

const ANA_NAME = 'Ana Quiroga';
const BETO_NAME = 'Beto Mamani';
const CARLA_NAME = 'Carla Benítez';
const DANI_NAME = 'Dani Rojas';
const JOB_URL = 'https://www.linkedin.com/jobs/view/3811111111/';

describe('provenance names outside the groups of the reader', () => {
  let http: LinksTestApp;
  let baseUrl: string;
  let ana: TestMember;
  let beto: TestMember;
  let carla: TestMember;
  let dani: TestMember;
  let group: GroupDetail;
  let linkId: string;
  let slug: string;
  const open: (() => void)[] = [];

  beforeAll(async () => {
    http = await createLinksTestApp('provenance-privacy', getMongoTestUri());
    await http.app.listen(0, '127.0.0.1');
    baseUrl = await http.app.getUrl();
    ana = await http.authenticated(ANA_NAME);
    beto = await http.authenticated(BETO_NAME);
    carla = await http.authenticated(CARLA_NAME);
    dani = await http.authenticated(DANI_NAME);
    group = await http.createGroup(ana, 'Backend Bolivia');
    await http.join(beto, group);
    // El grupo de Dani con Ana no contiene el link: solo prueba que cualquier grupo en común cuenta.
    const another = await http.createGroup(ana, 'Otro grupo de Ana');
    await http.join(dani, another);

    // Ana guarda en su grupo (nace publicado), completa a mano y pega.
    const saved = await http.request('POST', '/api/links', {
      authorization: ana.authorization,
      body: { url: JOB_URL, groupId: group.id },
    });
    expect(saved.statusCode).toBe(201);
    const body = saveLinkResponseSchema.parse(saved.json());
    linkId = body.link.id;
    if (body.link.publicShare === undefined) {
      throw new Error('A link saved in a public group is born published');
    }
    slug = body.link.publicShare.slug;

    const edited = await http.request('PATCH', `/api/links/${linkId}/preview`, {
      authorization: ana.authorization,
      body: { fields: { title: 'Backend Engineer', company: 'Acme Bolivia' } },
    });
    expect(edited.statusCode).toBe(200);
    const pasted = await http.request('POST', `/api/links/${linkId}/pasted`, {
      authorization: ana.authorization,
      body: { text: pastedGoldenInput('linkedin-app-sin-cabecera').text },
    });
    expect(pasted.statusCode).toBe(200);

    // Carla y Dani guardan la misma URL por su cuenta: la procedencia es del link canónico, compartido por todos.
    for (const member of [carla, dani]) {
      const own = await http.request('POST', '/api/links', {
        authorization: member.authorization,
        body: { url: JOB_URL },
      });
      expect(own.statusCode).toBe(201);
      expect(saveLinkResponseSchema.parse(own.json()).link.id).toBe(linkId);
    }
    // Arrancar la app completa y recorrer el escenario cuesta más que el límite por defecto con la máquina cargada.
  }, 60_000);

  afterEach(() => {
    for (const close of open.splice(0)) {
      close();
    }
  });

  afterAll(async () => {
    await http.close();
  });

  /** Ni el nombre de Ana ni su identificador en el JSON serializado, y la procedencia de Ana llega como `by: null`. */
  function expectNoAnaIn(response: InjectResponse): void {
    expect(response.statusCode).toBeLessThan(300);
    expect(response.body).not.toContain(ANA_NAME);
    expect(response.body).not.toContain(ana.userId);
  }

  /** Que `by` de los campos que Ana escribió sea `null` (y que haya procedencia: sin ella la prueba no probaría nada). */
  function expectAnaHiddenIn(link: JobLinkSummary): void {
    const sources = link.previewSources;
    expect(sources?.company).toMatchObject({ source: 'manual', by: null });
    expect(sources?.title).toMatchObject({ source: 'manual', by: null });
  }

  function linkOf(response: InjectResponse): JobLinkSummary {
    return jobLinkSummarySchema.parse(response.json());
  }

  function firstOfList(response: InjectResponse): JobLinkSummary {
    const items = response.json<{ items: unknown[] }>().items;
    return jobLinkSummarySchema.parse(items[0]);
  }

  describe('bloque A: lecturas y altas', () => {
    it('GET /api/links/mine of Carla names nobody she shares no group with', async () => {
      const response = await http.request('GET', '/api/links/mine', {
        authorization: carla.authorization,
      });

      expectNoAnaIn(response);
      expectAnaHiddenIn(firstOfList(response));
    });

    it('POST /api/links of Carla names nobody she shares no group with', async () => {
      const response = await http.request('POST', '/api/links', {
        authorization: carla.authorization,
        body: { url: JOB_URL },
      });

      expectNoAnaIn(response);
      expectAnaHiddenIn(saveLinkResponseSchema.parse(response.json()).link);
    });

    it('POST /api/links/import of Carla, from the public link, names nobody she shares no group with', async () => {
      // Carla abre el enlace público (sin sesión) y guarda la oferta con la URL que la página le da.
      const page = await http.request('GET', `/api/public/previews/${slug}`);
      expect(page.statusCode).toBe(200);
      const preview = publicPreviewResponseSchema.parse(page.json());
      expect(page.body).not.toContain(ANA_NAME);

      const response = await http.request('POST', '/api/links/import', {
        authorization: carla.authorization,
        body: { text: preview.link.displayUrl ?? JOB_URL },
      });

      expectNoAnaIn(response);
      const imported = response.json<{ links: unknown[] }>().links[0];
      expectAnaHiddenIn(jobLinkSummarySchema.parse(imported));
    });

    it('GET /api/groups/:id/links of Beto, who shares the group, names Ana', async () => {
      const response = await http.request(
        'GET',
        `/api/groups/${group.id}/links`,
        { authorization: beto.authorization },
      );

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(ANA_NAME);
      expect(firstOfList(response).previewSources?.company).toMatchObject({
        source: 'manual',
        by: { userId: ana.userId, displayName: ANA_NAME },
      });
    });

    it('GET /api/links/mine of Dani, who shares another group with Ana, names Ana (any group counts)', async () => {
      const response = await http.request('GET', '/api/links/mine', {
        authorization: dani.authorization,
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(ANA_NAME);
      expect(firstOfList(response).previewSources?.company).toMatchObject({
        source: 'manual',
        by: { userId: ana.userId, displayName: ANA_NAME },
      });
    });
  });

  describe('bloque B: escrituras y aviso en tiempo real', () => {
    function link(): ReturnType<typeof http.connection.collection> {
      return http.connection.collection(JOB_LINKS_COLLECTION);
    }

    it('PATCH /api/links/:id/preview of Carla (another field) names nobody she shares no group with', async () => {
      const response = await http.request(
        'PATCH',
        `/api/links/${linkId}/preview`,
        {
          authorization: carla.authorization,
          body: { fields: { location: 'Cochabamba, Bolivia' } },
        },
      );

      expectNoAnaIn(response);
      expectAnaHiddenIn(linkOf(response));
      // Lo que ella escribió sí lo ve con su nombre: nadie se oculta a sí mismo.
      expect(linkOf(response).previewSources?.location).toMatchObject({
        source: 'manual',
        by: { userId: carla.userId, displayName: CARLA_NAME },
      });
    });

    it('POST /api/links/:id/pasted of Carla names nobody she shares no group with', async () => {
      const response = await http.request(
        'POST',
        `/api/links/${linkId}/pasted`,
        {
          authorization: carla.authorization,
          body: { text: pastedGoldenInput('linkedin-app-sin-cabecera').text },
        },
      );

      expectNoAnaIn(response);
      expectAnaHiddenIn(linkOf(response));
    });

    it('POST /api/links/:id/reopen of Carla names nobody she shares no group with', async () => {
      await link().updateOne(
        { _id: new mongoose.Types.ObjectId(linkId) },
        {
          $set: {
            closedAt: new Date('2026-09-22T18:00:00.000Z'),
            closedReason: 'recheck',
          },
        },
      );

      const response = await http.request(
        'POST',
        `/api/links/${linkId}/reopen`,
        { authorization: carla.authorization, body: {} },
      );

      expectNoAnaIn(response);
      expectAnaHiddenIn(linkOf(response));
    });

    it('POST /api/links/:id/enrich of Carla names nobody she shares no group with', async () => {
      await link().updateOne(
        { _id: new mongoose.Types.ObjectId(linkId) },
        {
          $set: {
            previewStatus: 'failed',
            lastEnrichmentError: {
              reason: 'timeout',
              at: '2026-09-22T18:00:00.000Z',
            },
          },
        },
      );

      const response = await http.request(
        'POST',
        `/api/links/${linkId}/enrich`,
        { authorization: carla.authorization },
      );

      expectNoAnaIn(response);
      expectAnaHiddenIn(linkOf(response));
    });

    /** Canal de avisos abierto con la cabecera de esa persona; se lee hasta que llega un mensaje completo. */
    async function subscribe(member: TestMember): Promise<{
      nextMessage: () => Promise<string>;
    }> {
      const controller = new AbortController();
      open.push(() => controller.abort());
      const response = await fetch(`${baseUrl}/api/events`, {
        headers: { authorization: member.authorization },
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      if (reader === undefined) {
        throw new Error('The channel answered without a body');
      }
      const decoder = new TextDecoder();
      let received = '';
      const readUntil = async (
        test: (text: string) => boolean,
        what: string,
      ): Promise<string> => {
        const deadline = Date.now() + 5000;
        while (!test(received)) {
          if (Date.now() > deadline) {
            throw new Error(`The channel never sent ${what}`);
          }
          const chunk = await reader.read();
          if (chunk.done) {
            throw new Error(`The channel closed before sending ${what}`);
          }
          received += decoder.decode(chunk.value, { stream: true });
        }
        return received;
      };
      // El latido de apertura dice que la suscripción ya está dentro: antes no se puede repartir nada.
      await readUntil((text) => text.includes(': keep-alive'), 'the heartbeat');
      return {
        nextMessage: () =>
          readUntil(
            (text) => text.includes('event:') && text.trimEnd().endsWith('}'),
            'a complete message',
          ),
      };
    }

    it('a realtime subscriber of Carla, opened before the delivery, receives no name of Ana while Beto does', async () => {
      const carlaChannel = await subscribe(carla);
      const betoChannel = await subscribe(beto);

      // El aviso entra por donde entraría el del worker: la suscripción de Redis solo llama a este caso de uso.
      const stored = await http.connection
        .collection(JOB_LINKS_COLLECTION)
        .findOne({ _id: new mongoose.Types.ObjectId(linkId) });
      await http.app.get(DeliverLinkEnriched, { strict: false }).execute({
        linkId,
        previewStatus: 'enriched',
        previewVersion: Number(stored?.['previewVersion'] ?? 1),
      });

      const forCarla = await carlaChannel.nextMessage();
      const forBeto = await betoChannel.nextMessage();

      expect(forCarla).toContain(`"id":"${linkId}"`);
      expect(forCarla).not.toContain(ANA_NAME);
      expect(forCarla).not.toContain(ana.userId);
      expect(forBeto).toContain(ANA_NAME);
      expect(forBeto).toContain(ana.userId);
    });
  });

  it('keeps what is stored: the author of every field is still the id of the person', async () => {
    const stored = await http.connection
      .collection(JOB_LINKS_COLLECTION)
      .findOne({ _id: new mongoose.Types.ObjectId(linkId) });
    const company = (
      stored?.['previewSources'] as Record<string, { by?: unknown }> | undefined
    )?.['company'];

    // Qué se guarda no cambia (ADR-010): solo cambia quién lee el nombre.
    expect(String(company?.by)).toBe(ana.userId);
  });
});
