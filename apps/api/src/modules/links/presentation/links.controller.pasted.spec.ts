import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import type { RunTaskFn } from '@linkvault/ai';
import {
  apiErrorResponseSchema,
  jobLinkSummarySchema,
  scrubContactDetails,
  type GroupDetail,
  type JobLinkSummary,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AttemptOutcome,
  FixedWindowCounter,
  WindowLimit,
} from '../../../infrastructure/limits/fixed-window-counter';
import { InMemoryFixedWindowCounter } from '../../../infrastructure/limits/testing/in-memory-fixed-window-counter';
import { OUTBOX_EVENTS_COLLECTION } from '../../../infrastructure/outbox/outbox-event.schemas';
import {
  createLinksTestApp,
  type LinksTestApp,
  type TestMember,
} from '../../../test-support/links-test-app';
import { pastedGoldenInput } from '../../../test-support/pasted-golden';
import { workspaceRoot } from '../../../test-support/test-config';
import { jobLinkDraft } from '../application/testing/link-fixtures';
import {
  GROUP_LINKS_COLLECTION,
  JOB_LINKS_COLLECTION,
} from '../infrastructure/link.schemas';

// `POST /api/links/:id/pasted` (tareas 5.3, 6.3 y 6.5 de paste-job-description) sobre la app completa.
//
// La IA es la de verdad de la suite: el mock en `replay`, con los fixtures que se grabaron contra Ollama para el golden
// de `extract-pasted-job`. Por eso lo que se pega son **exactamente** los inputs de ese golden (`pastedGoldenInput`):
// cualquier otro texto no tendría fixture y el test acabaría en `FixtureMissing`. Los escenarios en que la IA degrada o
// agota su cuota usan un `RUN_TASK` sustituido, nunca `synth`.

const READ_AT = new Date('2026-09-18T11:00:00.000Z');

/** El caso sembrado de 6.5 tal y como se pega, sin limpiar. Su versión limpia es el input del golden. */
const SEEDED_MARK = 'LVSEED-Q7X4-K9M2';
const SEEDED_EMAIL = 'ximena.choque@transportes-altiplano.example';
const SEEDED_PHONE = '+591 72041938';
const SEEDED_RECRUITER = 'Ximena Choque Arancibia';
const SEEDED_RAW_TEXT = [
  'Solicitud sencilla',
  'hace 3 días · 12 solicitantes',
  'Coordinador de Logística',
  'Transportes del Altiplano · El Alto, Bolivia · Híbrido',
  `Código interno de la publicación: ${SEEDED_MARK}`,
  'Coordinarás la flota de camiones y las rutas de distribución entre El Alto, Oruro y Cochabamba, y negociarás con los proveedores de transporte.',
  'Requisitos: tres años coordinando operaciones logísticas, manejo de Excel y de un sistema de gestión de flotas.',
  `Envía tu CV a ${SEEDED_RECRUITER}, reclutadora: ${SEEDED_EMAIL} o al ${SEEDED_PHONE}.`,
].join('\n');

/** Destino de logs en memoria: todas las líneas que escribió la app, para buscar lo que no debería estar. */
class MemoryDestination extends Writable {
  readonly lines: string[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: () => void,
  ): void {
    this.lines.push(chunk.toString('utf8'));
    callback();
  }
}

/** Lo que hace falta para pegar en links de un grupo con Ana, Beto y un extraño. */
interface PasteFixture {
  http: LinksTestApp;
  ana: TestMember;
  beto: TestMember;
  stranger: TestMember;
  group: GroupDetail;
}

async function pasteFixture(
  name: string,
  options: Parameters<typeof createLinksTestApp>[2] = {},
): Promise<PasteFixture> {
  const http = await createLinksTestApp(name, getMongoTestUri(), options);
  const ana = await http.authenticated('Ana');
  const beto = await http.authenticated('Beto');
  const stranger = await http.authenticated('Extraño');
  const group = await http.createGroup(ana, 'Backend Bolivia');
  await http.join(beto, group);
  return { http, ana, beto, stranger, group };
}

let jobIds = 3_811_000_000;

/**
 * Link compartido por Ana en el grupo. Por defecto, uno de LinkedIn en `failed` porque su `robots.txt` prohíbe la
 * lectura; con `preview`, uno ya leído de la página con esos campos.
 */
async function sharedLink(
  { http, ana, group }: PasteFixture,
  preview?: { title: string; company: string },
): Promise<string> {
  jobIds += 1;
  const draft = jobLinkDraft(`https://www.linkedin.com/jobs/view/${jobIds}/`, {
    createdBy: ana.userId,
    now: READ_AT,
  });
  const at = READ_AT.toISOString();
  const linkId = new mongoose.Types.ObjectId();
  await http.connection.collection(JOB_LINKS_COLLECTION).insertOne({
    _id: linkId,
    normalizedUrl: draft.normalizedUrl,
    urlHash: draft.urlHash,
    dedupeKey: draft.dedupeKey,
    platform: draft.platform,
    ...(draft.externalJobId === undefined
      ? {}
      : { externalJobId: draft.externalJobId }),
    displayUrl: draft.displayUrl,
    originalUrls: [...draft.originalUrls],
    ...(preview === undefined
      ? {
          previewStatus: 'failed',
          lastEnrichmentError: { reason: 'robots_disallowed', at },
        }
      : {
          previewStatus: 'enriched',
          preview,
          previewSources: {
            title: {
              value: preview.title,
              source: 'auto',
              extractor: 'json-ld',
              at,
            },
            company: {
              value: preview.company,
              source: 'auto',
              extractor: 'metadata',
              at,
            },
          },
        }),
    previewVersion: 2,
    previewRequestedAt: READ_AT,
    createdBy: new mongoose.Types.ObjectId(ana.userId),
    createdAt: READ_AT,
    updatedAt: READ_AT,
  });
  await http.connection.collection(GROUP_LINKS_COLLECTION).insertOne({
    groupId: new mongoose.Types.ObjectId(group.id),
    linkId,
    sharedBy: new mongoose.Types.ObjectId(ana.userId),
    sharedAt: READ_AT,
  });
  return linkId.toHexString();
}

function paste(
  { http }: PasteFixture,
  member: TestMember,
  linkId: string,
  body: unknown,
) {
  return http.request('POST', `/api/links/${linkId}/pasted`, {
    authorization: member.authorization,
    body,
  });
}

async function storedLink(
  { http }: PasteFixture,
  linkId: string,
): Promise<Record<string, unknown> | null> {
  return await http.connection
    .collection(JOB_LINKS_COLLECTION)
    .findOne({ _id: new mongoose.Types.ObjectId(linkId) });
}

describe('pasting a description, read by the AI of the suite in replay', () => {
  const logs = new MemoryDestination();
  let fx: PasteFixture;

  beforeAll(async () => {
    fx = await pasteFixture('links-pasted-http', { logDestination: logs });
  });

  afterAll(async () => {
    await fx.http.close();
  });

  it('Oferta de LinkedIn completada pegando su texto', async () => {
    const linkId = await sharedLink(fx);
    const { text } = pastedGoldenInput('linkedin-app-sin-cabecera');

    const response = await paste(fx, fx.beto, linkId, { text });

    expect(response.statusCode).toBe(200);
    const summary = jobLinkSummarySchema.parse(response.json());
    expect(summary.preview?.title).toBe('Desarrollador Frontend Senior');
    expect(summary.previewVersion).toBe(3);
    expect(summary.previewSources?.title).toMatchObject({
      source: 'pasted',
      extractor: 'ai:extract-pasted-job',
      by: { userId: fx.beto.userId, displayName: 'Beto' },
    });
    // El cuerpo copiado de la app no trae la empresa: el link queda a medias.
    expect(summary.preview?.company).toBeUndefined();
    expect(summary.previewStatus).toBe('partial');
  });

  it('El motivo de la bolsa se conserva', async () => {
    const linkId = await sharedLink(fx);

    const response = await paste(fx, fx.beto, linkId, {
      text: pastedGoldenInput('linkedin-app-sin-cabecera').text,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<JobLinkSummary>().lastEnrichmentError?.reason).toBe(
      'robots_disallowed',
    );
    expect(
      (await storedLink(fx, linkId))?.['lastEnrichmentError'],
    ).toMatchObject({ reason: 'robots_disallowed' });
  });

  it('Pegar no deja huecos', async () => {
    const linkId = await sharedLink(fx, {
      title: 'Frontend Engineer',
      company: 'Fintech Andina S.A.',
    });

    const response = await paste(fx, fx.beto, linkId, {
      text: pastedGoldenInput('linkedin-app-sin-cabecera').text,
    });

    const summary = response.json<JobLinkSummary>();
    expect(summary.preview?.company).toBe('Fintech Andina S.A.');
    expect(summary.previewSources?.company).toMatchObject({
      source: 'auto',
      extractor: 'metadata',
    });
    expect(summary.previewSources?.title?.source).toBe('pasted');
  });

  it('Cuerpo sin cabecera, con título y empresa escritos aparte', async () => {
    const linkId = await sharedLink(fx);
    const input = pastedGoldenInput('linkedin-app-con-titulo-escrito');

    const response = await paste(fx, fx.beto, linkId, {
      text: input.text,
      title: input.knownTitle,
      company: input.knownCompany,
    });

    expect(response.statusCode).toBe(200);
    const summary = response.json<JobLinkSummary>();
    expect(summary.preview?.title).toBe('Analista Contable Senior');
    expect(summary.preview?.company).toBe('Grupo Cordillera');
    expect(summary.previewSources?.title?.source).toBe('manual');
    expect(summary.previewSources?.company?.source).toBe('manual');
    expect(summary.previewSources?.summary?.source).toBe('pasted');
    expect(summary.previewSources?.modality?.source).toBe('pasted');
  });

  it('Estado tras completar con título y empresa', async () => {
    const linkId = await sharedLink(fx);

    const response = await paste(fx, fx.beto, linkId, {
      text: pastedGoldenInput('oferta-entre-chat').text,
    });

    const summary = response.json<JobLinkSummary>();
    expect(summary.preview?.title).toBe('Ingeniero de Soporte TI');
    expect(summary.preview?.company).toBe('Distribuidora Andina');
    expect(summary.previewStatus).toBe('enriched');
  });

  it('Título precargado sin tocar no se vuelve manual', async () => {
    // El link ya tenía el título que trae el texto; el diálogo lo reenvía tal cual estaba precargado.
    const linkId = await sharedLink(fx, {
      title: 'Desarrollador Frontend Senior',
      company: 'Fintech Andina S.A.',
    });

    const response = await paste(fx, fx.beto, linkId, {
      text: pastedGoldenInput('linkedin-app-sin-cabecera').text,
      title: 'Desarrollador Frontend Senior',
    });

    expect(response.statusCode).toBe(200);
    const summary = response.json<JobLinkSummary>();
    expect(summary.previewSources?.title).toMatchObject({
      source: 'auto',
      extractor: 'json-ld',
    });
    expect(summary.previewStatus).toBe('enriched');
  });

  it('Se pegó otra cosa', async () => {
    const linkId = await sharedLink(fx);
    const before = await storedLink(fx, linkId);

    const response = await paste(fx, fx.beto, linkId, {
      text: pastedGoldenInput('conversacion-no-es-oferta').text,
    });

    expect(response.statusCode).toBe(422);
    expect(apiErrorResponseSchema.parse(response.json()).code).toBe(
      'not_a_job_posting',
    );
    expect(await storedLink(fx, linkId)).toEqual(before);
  });

  it('Solo había un teléfono', async () => {
    const linkId = await sharedLink(fx);

    const response = await paste(fx, fx.beto, linkId, {
      text: '+591 71234567',
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<{ code: string }>().code).toBe('not_a_job_posting');
  });

  it.each(['', '   \n  '])('Texto vacío: %j', async (text) => {
    const linkId = await sharedLink(fx);

    const response = await paste(fx, fx.beto, linkId, { text });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('validation_error');
  });

  it('answers text_too_long for more than 20 000 characters, before looking at the link', async () => {
    const response = await paste(fx, fx.stranger, '66e9a0000000000000000001', {
      text: 'a'.repeat(20_001),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('text_too_long');
  });

  it('Link que no se puede ver', async () => {
    const linkId = await sharedLink(fx);

    const response = await paste(fx, fx.stranger, linkId, {
      text: pastedGoldenInput('oferta-entre-chat').text,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string }>().code).toBe('link_not_found');
  });

  it('answers 401 without a token', async () => {
    const response = await fx.http.request(
      'POST',
      '/api/links/66e9a0000000000000000001/pasted',
      { body: { text: 'hola' } },
    );

    expect(response.statusCode).toBe(401);
  });

  /** Deshace todo lo que pegó alguien, como "Deshacer lo que pegó <nombre>": un `revert` de sus campos pegados. */
  async function undoPasted(linkId: string, pasted: JobLinkSummary) {
    const fields = Object.entries(pasted.previewSources ?? {})
      .filter(([, entry]) => entry?.source === 'pasted')
      .map(([field]) => field);
    expect(fields.length).toBeGreaterThan(0);
    return await fx.http.request('PATCH', `/api/links/${linkId}/preview`, {
      authorization: fx.ana.authorization,
      body: { revert: fields },
    });
  }

  it('Deshacer deja el estado que corresponde', async () => {
    const linkId = await sharedLink(fx);
    const pasted = await paste(fx, fx.beto, linkId, {
      text: pastedGoldenInput('oferta-entre-chat').text,
    });
    expect(pasted.json<JobLinkSummary>().previewStatus).toBe('enriched');

    const undone = await undoPasted(linkId, pasted.json<JobLinkSummary>());

    expect(undone.statusCode).toBe(200);
    const summary = undone.json<JobLinkSummary>();
    expect(summary.previewStatus).toBe('failed');
    expect(summary.lastEnrichmentError?.reason).toBe('robots_disallowed');
    expect(summary.preview?.title).toBeUndefined();
  });

  it('Deshacer no pierde lo escrito a mano', async () => {
    const linkId = await sharedLink(fx);
    const input = pastedGoldenInput('linkedin-app-con-titulo-escrito');
    const pasted = await paste(fx, fx.beto, linkId, {
      text: input.text,
      title: input.knownTitle,
      company: input.knownCompany,
    });

    const undone = await undoPasted(linkId, pasted.json<JobLinkSummary>());

    const summary = undone.json<JobLinkSummary>();
    expect(summary.previewStatus).toBe('manual');
    expect(summary.preview?.title).toBe('Analista Contable Senior');
    expect(summary.previewSources?.summary).toBeUndefined();
  });

  it('Texto con datos de contacto', async () => {
    // El caso sembrado del golden es exactamente este texto sin su email ni su teléfono.
    const input = pastedGoldenInput('sembrado-contacto-reclutador');
    expect(scrubContactDetails(SEEDED_RAW_TEXT)).toBe(input.text);
    expect(input.text).not.toContain(SEEDED_EMAIL);
    expect(input.text).not.toContain(SEEDED_PHONE);
    const linkId = await sharedLink(fx);

    const response = await paste(fx, fx.beto, linkId, {
      text: SEEDED_RAW_TEXT,
    });

    expect(response.statusCode).toBe(200);
    const summary = response.json<JobLinkSummary>();
    expect(summary.preview?.title).toBe('Coordinador de Logística');
    expect(summary.preview?.summary).not.toContain(SEEDED_RECRUITER);
    expect(summary.preview?.summary).not.toContain('Ximena');

    const forbidden = [
      SEEDED_RAW_TEXT,
      SEEDED_MARK,
      SEEDED_EMAIL,
      SEEDED_PHONE,
    ];
    const stored = JSON.stringify(
      await fx.http.connection
        .collection(JOB_LINKS_COLLECTION)
        .find({})
        .toArray(),
    );
    const outbox = JSON.stringify(
      await fx.http.connection
        .collection(OUTBOX_EVENTS_COLLECTION)
        .find({})
        .toArray(),
    );
    const ledger = JSON.stringify(
      await fx.http.connection.collection('ai_usage').find({}).toArray(),
    );
    const pendingPath = join(
      workspaceRoot(),
      'tmp',
      'ai-pending-fixtures.jsonl',
    );
    const pending = existsSync(pendingPath)
      ? readFileSync(pendingPath, 'utf8')
      : '';
    const logged = logs.lines.join('');
    // La lectura sí pasó por el ledger de la IA: que esté vacío no probaría nada.
    expect(ledger).toContain('extract-pasted-job');
    expect(logged).not.toBe('');
    for (const [where, content] of Object.entries({
      stored,
      outbox,
      ledger,
      pending,
      logged,
    })) {
      for (const secret of forbidden) {
        expect(
          content.includes(secret),
          `${where} contains ${secret === SEEDED_RAW_TEXT ? 'the pasted text' : secret}`,
        ).toBe(false);
      }
    }
    expect(stored).not.toContain(SEEDED_RECRUITER);
  });
});

/** Contador de intentos que se puede tirar o dar por agotado desde el test. */
class SwitchableCounter implements FixedWindowCounter {
  mode: 'up' | 'down' | 'exhausted' = 'up';
  private readonly inner = new InMemoryFixedWindowCounter();

  consume(key: string, limit: WindowLimit): Promise<AttemptOutcome | null> {
    switch (this.mode) {
      case 'down':
        return Promise.resolve(null);
      case 'exhausted':
        return Promise.resolve({ allowed: false, retryAfterSeconds: 540 });
      case 'up':
        return this.inner.consume(key, limit);
    }
  }

  reset(key: string): Promise<boolean> {
    return this.inner.reset(key);
  }

  giveBack(key: string): Promise<boolean> {
    return this.inner.giveBack(key);
  }
}

describe('pasting a description when the AI or the counter fail', () => {
  const counter = new SwitchableCounter();
  let degradeFor: 'providers_failed' | 'quota_exceeded' = 'providers_failed';
  let calls = 0;
  // `RUN_TASK` sustituido: la IA degrada con el motivo que el test elija. Nunca `synth`.
  const runTask = (() => {
    calls += 1;
    return Promise.resolve({ status: 'degraded', reason: degradeFor });
  }) as RunTaskFn;
  let fx: PasteFixture;

  beforeAll(async () => {
    fx = await pasteFixture('links-pasted-failing-http', { runTask, counter });
  });

  afterAll(async () => {
    await fx.http.close();
  });

  it('La IA no está disponible', async () => {
    counter.mode = 'up';
    degradeFor = 'providers_failed';
    const linkId = await sharedLink(fx);
    const before = await storedLink(fx, linkId);

    const response = await paste(fx, fx.beto, linkId, { text: 'Oferta.' });

    expect(response.statusCode).toBe(503);
    expect(response.json<{ code: string }>().code).toBe(
      'extraction_unavailable',
    );
    expect(response.headers['retry-after']).toBe('60');
    expect(await storedLink(fx, linkId)).toEqual(before);
  });

  it('Cuota de IA agotada', async () => {
    counter.mode = 'up';
    degradeFor = 'quota_exceeded';
    const linkId = await sharedLink(fx);

    const response = await paste(fx, fx.beto, linkId, { text: 'Oferta.' });

    expect(response.statusCode).toBe(429);
    expect(response.json<{ code: string }>().code).toBe('ai_quota_exceeded');
    expect(response.headers['retry-after']).toBe('86400');
  });

  it('Un fallo de la IA no gasta un pegado', async () => {
    counter.mode = 'up';
    degradeFor = 'providers_failed';
    const linkId = await sharedLink(fx);

    // Más intentos que los diez de la ventana: como cada 503 devuelve el suyo, ninguno llega al 429.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      statuses.push(
        (await paste(fx, fx.ana, linkId, { text: 'Oferta.' })).statusCode,
      );
    }

    expect(new Set(statuses)).toEqual(new Set([503]));
  });

  it('Ventana agotada', async () => {
    counter.mode = 'exhausted';
    const linkId = await sharedLink(fx);
    const before = calls;

    const response = await paste(fx, fx.beto, linkId, { text: 'Oferta.' });

    expect(response.statusCode).toBe(429);
    expect(response.json<{ code: string }>().code).toBe('too_many_attempts');
    expect(response.headers['retry-after']).toBe('540');
    expect(calls).toBe(before);
  });

  it('El contador no responde', async () => {
    counter.mode = 'down';
    const linkId = await sharedLink(fx);
    const before = calls;

    const response = await paste(fx, fx.beto, linkId, { text: 'Oferta.' });

    expect(response.statusCode).toBe(503);
    expect(response.json<{ code: string }>().code).toBe(
      'extraction_unavailable',
    );
    expect(response.headers['retry-after']).toBe('60');
    expect(calls).toBe(before);
  });
});
