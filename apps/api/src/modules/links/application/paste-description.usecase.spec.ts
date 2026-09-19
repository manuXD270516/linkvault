import type { JobPreview } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AiQuotaExceeded,
  ExtractionUnavailable,
  LinkNotFound,
  NotAJobPosting,
  TooManyLinkAttempts,
} from '../domain/errors';
import { PasteDescription } from './paste-description.usecase';
import { RequestLinkEnrichment } from './request-link-enrichment.usecase';
import { UpdateLinkPreview } from './update-link-preview.usecase';
import { InMemoryGroupLinkRepository } from './testing/in-memory-group-link.repository';
import { InMemoryJobLinkRepository } from './testing/in-memory-job-link.repository';
import { InMemoryUserLinkRepository } from './testing/in-memory-user-link.repository';
import { jobLinkDraft, objectId } from './testing/link-fixtures';
import {
  FakePastedExtraction,
  IN_MEMORY_SESSION,
  InMemoryGroupMembership,
  InMemoryLinkEnrichedPublisher,
  InMemoryLinkLimiter,
  InMemoryLinkUserDirectory,
  InMemoryOutbox,
  MovableClock,
} from './testing/links-test-doubles';

// `POST /api/links/:id/pasted` (tareas 6.1, 6.2 y 6.4 de paste-job-description) con los dobles en memoria: el orden de
// las comprobaciones, la escritura del pegado y el aviso. Lo que la IA responde es un doble del puerto; que el mock en
// `replay` responda con los fixtures del golden lo prueban los tests por HTTP.

const ANA = objectId(1);
const BETO = objectId(2);
const STRANGER = objectId(3);
const BACKEND = objectId(10);
const LINKEDIN_JOB = 'https://www.linkedin.com/jobs/view/3811111111/';
const PASTED_TEXT =
  'Solicitud sencilla. Desarrollador Frontend Senior. Angular y TypeScript, 100 % remoto.';

/** Lo que la IA lee del texto copiado de la app: sin la empresa, que la cabecera de la app no deja copiar. */
const frontendOffer: JobPreview = {
  title: 'Desarrollador Frontend Senior',
  company: null,
  location: 'Bolivia',
  modality: 'remote',
  seniority: 'senior',
  salary: null,
  skills: [{ name: 'Angular', required: true }],
  languages: [],
  summary: 'Construye la banca móvil y web de nuestros clientes.',
  postedAt: null,
  expiresAt: null,
};

let clock: MovableClock;
let links: InMemoryJobLinkRepository;
let groupLinks: InMemoryGroupLinkRepository;
let userLinks: InMemoryUserLinkRepository;
let limiter: InMemoryLinkLimiter;
let extraction: FakePastedExtraction;
let publisher: InMemoryLinkEnrichedPublisher;
let pasteDescription: PasteDescription;

beforeEach(() => {
  clock = new MovableClock();
  links = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(links);
  userLinks = new InMemoryUserLinkRepository(links);
  limiter = new InMemoryLinkLimiter();
  extraction = new FakePastedExtraction({
    outcome: 'extracted',
    fields: frontendOffer,
  });
  publisher = new InMemoryLinkEnrichedPublisher();
  const membership = new InMemoryGroupMembership()
    .withMember(BACKEND, ANA, 'owner', 'Backend Bolivia')
    .withMember(BACKEND, BETO);
  pasteDescription = new PasteDescription(
    links,
    groupLinks,
    userLinks,
    membership,
    limiter,
    extraction,
    publisher,
    new InMemoryLinkUserDirectory().set(ANA, 'Ana').set(BETO, 'Beto'),
    clock,
  );
});

/** Link de LinkedIn en `failed` porque su `robots.txt` prohíbe la lectura, compartido por Ana en el grupo. */
async function blockedLink(): Promise<string> {
  const link = links.seed({
    ...jobLinkDraft(LINKEDIN_JOB, { createdBy: ANA, now: clock.now() }),
    previewStatus: 'failed',
    previewVersion: 2,
    lastEnrichmentError: {
      reason: 'robots_disallowed',
      at: clock.now().toISOString(),
    },
  });
  await share(link.id);
  return link.id;
}

/** Link leído de la página —título por JSON-LD y empresa por metadatos—, compartido en el grupo. */
async function readLink(): Promise<string> {
  const readAt = clock.now().toISOString();
  const link = links.seed({
    ...jobLinkDraft(LINKEDIN_JOB, { createdBy: ANA, now: clock.now() }),
    previewStatus: 'enriched',
    previewVersion: 2,
    preview: { title: 'Backend Engineer', company: 'ACME S.R.L.' },
    previewSources: {
      title: {
        value: 'Backend Engineer',
        source: 'auto',
        extractor: 'json-ld',
        at: readAt,
      },
      company: {
        value: 'ACME S.R.L.',
        source: 'auto',
        extractor: 'metadata',
        at: readAt,
      },
    },
  });
  await share(link.id);
  return link.id;
}

async function share(linkId: string): Promise<void> {
  await groupLinks.share(
    { groupId: BACKEND, linkId, sharedBy: ANA, sharedAt: clock.now() },
    IN_MEMORY_SESSION,
  );
  clock.advance(60_000);
}

describe('PasteDescription: what is checked before the AI', () => {
  it('Link que no se puede ver', async () => {
    const linkId = await blockedLink();

    await expect(
      pasteDescription.execute(STRANGER, linkId, { text: PASTED_TEXT }),
    ).rejects.toBeInstanceOf(LinkNotFound);
    expect(limiter.consumed).toEqual([]);
    expect(extraction.requests).toEqual([]);
  });

  it('answers link_not_found for an id that is not a link', async () => {
    await expect(
      pasteDescription.execute(ANA, 'no-es-un-id', { text: PASTED_TEXT }),
    ).rejects.toBeInstanceOf(LinkNotFound);
  });

  it('Solo había un teléfono', async () => {
    const linkId = await blockedLink();

    await expect(
      pasteDescription.execute(BETO, linkId, { text: '+591 71234567' }),
    ).rejects.toBeInstanceOf(NotAJobPosting);
    // Ni límite ni IA.
    expect(limiter.consumed).toEqual([]);
    expect(extraction.requests).toEqual([]);
  });

  it('Ventana agotada', async () => {
    const linkId = await blockedLink();
    limiter.exhaust({ kind: 'paste-description', userId: BETO });

    const attempt = pasteDescription.execute(BETO, linkId, {
      text: PASTED_TEXT,
    });

    await expect(attempt).rejects.toBeInstanceOf(TooManyLinkAttempts);
    await expect(attempt).rejects.toMatchObject({ retryAfterSeconds: 900 });
    expect(extraction.requests).toEqual([]);
  });

  it('El contador no responde', async () => {
    const linkId = await blockedLink();
    limiter.goDown();

    await expect(
      pasteDescription.execute(BETO, linkId, { text: PASTED_TEXT }),
    ).rejects.toBeInstanceOf(ExtractionUnavailable);
    expect(extraction.requests).toEqual([]);
    // No se consumió nada que devolver.
    expect(limiter.refunded).toEqual([]);
  });

  it('counts the pastes of whoever pastes, not of the link', async () => {
    const linkId = await blockedLink();

    await pasteDescription.execute(BETO, linkId, { text: PASTED_TEXT });

    expect(limiter.consumed).toEqual([
      { kind: 'paste-description', userId: BETO },
    ]);
  });
});

describe('PasteDescription: what the AI answers', () => {
  it('Se pegó otra cosa', async () => {
    const linkId = await readLink();
    const before = await links.findById(linkId);
    extraction.answering({ outcome: 'not_a_job_posting' });

    await expect(
      pasteDescription.execute(BETO, linkId, { text: 'hola, ¿viste esto?' }),
    ).rejects.toBeInstanceOf(NotAJobPosting);
    expect(await links.findById(linkId)).toEqual(before);
    expect(publisher.published).toEqual([]);
  });

  it('La IA no está disponible', async () => {
    const linkId = await blockedLink();
    const before = await links.findById(linkId);
    extraction.answering({ outcome: 'unavailable' });

    const attempt = pasteDescription.execute(BETO, linkId, {
      text: PASTED_TEXT,
    });

    await expect(attempt).rejects.toBeInstanceOf(ExtractionUnavailable);
    await expect(attempt).rejects.toMatchObject({ retryAfterSeconds: 60 });
    expect(await links.findById(linkId)).toEqual(before);
  });

  it('Cuota de IA agotada', async () => {
    const linkId = await blockedLink();
    extraction.answering({ outcome: 'quota_exceeded' });

    const attempt = pasteDescription.execute(BETO, linkId, {
      text: PASTED_TEXT,
    });

    await expect(attempt).rejects.toBeInstanceOf(AiQuotaExceeded);
    await expect(attempt).rejects.toMatchObject({
      retryAfterSeconds: 86_400,
    });
    // La cuota de IA no es un fallo transitorio: el intento no se devuelve.
    expect(limiter.refunded).toEqual([]);
  });

  it('Un fallo de la IA no gasta un pegado', async () => {
    const linkId = await blockedLink();
    limiter.withLimit({ kind: 'paste-description', userId: BETO }, 1);
    extraction.answering({ outcome: 'unavailable' });

    await expect(
      pasteDescription.execute(BETO, linkId, { text: PASTED_TEXT }),
    ).rejects.toBeInstanceOf(ExtractionUnavailable);

    extraction.answering({ outcome: 'extracted', fields: frontendOffer });
    const summary = await pasteDescription.execute(BETO, linkId, {
      text: PASTED_TEXT,
    });

    expect(summary.preview?.title).toBe('Desarrollador Frontend Senior');
    expect(limiter.refunded).toEqual([
      { kind: 'paste-description', userId: BETO },
    ]);
  });

  it('gives the AI the text without contact details and the title written apart as context', async () => {
    const linkId = await blockedLink();
    const controller = new AbortController();

    await pasteDescription.execute(
      BETO,
      linkId,
      {
        text: `${PASTED_TEXT} Escribe a rrhh@fintech.example o al +591 71234567.`,
        title: 'Desarrollador Frontend Senior',
      },
      controller.signal,
    );

    const request = extraction.requests[0];
    expect(request?.userId).toBe(BETO);
    expect(request?.text).not.toContain('rrhh@fintech.example');
    expect(request?.text).not.toContain('71234567');
    expect(request?.knownTitle).toBe('Desarrollador Frontend Senior');
    expect(request?.knownCompany).toBeUndefined();
    expect(request?.signal).toBe(controller.signal);
  });

  it('does not give as context a title left as the link already had it', async () => {
    const linkId = await readLink();

    await pasteDescription.execute(BETO, linkId, {
      text: PASTED_TEXT,
      title: 'Backend Engineer',
    });

    expect(extraction.requests[0]).not.toHaveProperty('knownTitle');
  });
});

describe('PasteDescription: what is written', () => {
  it('Oferta de LinkedIn completada pegando su texto', async () => {
    const linkId = await blockedLink();

    const summary = await pasteDescription.execute(BETO, linkId, {
      text: PASTED_TEXT,
    });

    expect(summary.preview?.title).toBe('Desarrollador Frontend Senior');
    expect(summary.previewVersion).toBe(3);
    expect(summary.previewSources?.title).toEqual({
      value: 'Desarrollador Frontend Senior',
      source: 'pasted',
      extractor: 'ai:extract-pasted-job',
      by: { userId: BETO, displayName: 'Beto' },
      at: clock.now().toISOString(),
    });
    // Sin empresa, el link no está completo.
    expect(summary.previewStatus).toBe('partial');
  });

  it('Pegar no deja huecos', async () => {
    const linkId = await readLink();

    const summary = await pasteDescription.execute(BETO, linkId, {
      text: PASTED_TEXT,
    });

    // Lo pegado no trae la empresa: sigue siendo la leída de la página.
    expect(summary.preview?.company).toBe('ACME S.R.L.');
    expect(summary.previewSources?.company).toMatchObject({
      source: 'auto',
      extractor: 'metadata',
    });
    expect(summary.preview?.location).toBe('Bolivia');
  });

  it('Cuerpo sin cabecera, con título y empresa escritos aparte', async () => {
    const linkId = await blockedLink();

    const summary = await pasteDescription.execute(BETO, linkId, {
      text: PASTED_TEXT,
      title: 'Desarrollador Frontend Senior (Angular)',
      company: 'Fintech Andina',
    });

    expect(summary.previewSources?.title?.source).toBe('manual');
    expect(summary.previewSources?.company?.source).toBe('manual');
    expect(summary.previewSources?.summary?.source).toBe('pasted');
    expect(summary.preview?.title).toBe(
      'Desarrollador Frontend Senior (Angular)',
    );
    expect(summary.preview?.company).toBe('Fintech Andina');
    expect(summary.previewStatus).toBe('manual');
  });

  it('Estado tras completar con título y empresa', async () => {
    const linkId = await blockedLink();
    extraction.answering({
      outcome: 'extracted',
      fields: { ...frontendOffer, company: 'Fintech Andina' },
    });

    const summary = await pasteDescription.execute(BETO, linkId, {
      text: PASTED_TEXT,
    });

    expect(summary.previewStatus).toBe('enriched');
  });

  it('El motivo de la bolsa se conserva', async () => {
    const linkId = await blockedLink();

    const summary = await pasteDescription.execute(BETO, linkId, {
      text: PASTED_TEXT,
    });

    expect(summary.lastEnrichmentError?.reason).toBe('robots_disallowed');
  });

  it('Pegar y deshacer sobre un fallo pasajero', async () => {
    const failedAt = clock.now().toISOString();
    const link = links.seed({
      ...jobLinkDraft(LINKEDIN_JOB, { createdBy: ANA, now: clock.now() }),
      previewStatus: 'failed',
      previewVersion: 2,
      lastEnrichmentError: { reason: 'timeout', at: failedAt },
    });
    await share(link.id);
    const membership = new InMemoryGroupMembership()
      .withMember(BACKEND, ANA, 'owner', 'Backend Bolivia')
      .withMember(BACKEND, BETO);
    const directory = new InMemoryLinkUserDirectory()
      .set(ANA, 'Ana')
      .set(BETO, 'Beto');
    const updatePreview = new UpdateLinkPreview(
      links,
      groupLinks,
      userLinks,
      membership,
      directory,
      clock,
      publisher,
    );
    const outbox = new InMemoryOutbox();
    const requestEnrichment = new RequestLinkEnrichment(
      links,
      groupLinks,
      userLinks,
      membership,
      outbox,
      limiter,
      directory,
      clock,
    );

    const pasted = await pasteDescription.execute(BETO, link.id, {
      text: PASTED_TEXT,
    });
    // Pegar conserva el motivo: lo único que un pegado desmiente es que no fuera una oferta.
    expect(pasted.previewStatus).toBe('partial');
    expect(pasted.lastEnrichmentError).toEqual({
      reason: 'timeout',
      at: failedAt,
    });

    const pastedFields = Object.entries(pasted.previewSources ?? {})
      .filter(([, entry]) => entry?.source === 'pasted')
      .map(([field]) => field);
    const undone = await updatePreview.execute(BETO, link.id, {
      revert: pastedFields,
    });

    expect(undone.previewStatus).toBe('failed');
    expect(undone.lastEnrichmentError?.reason).toBe('timeout');
    expect(undone.preview?.title).toBeUndefined();

    // Y se puede reintentar su lectura: nada queda en `pending` sin trabajo detrás.
    const retried = await requestEnrichment.execute(BETO, link.id);
    expect(retried.previewStatus).toBe('pending');
    expect(retried.lastEnrichmentError).toBeUndefined();
    expect(outbox.size).toBe(1);
  });

  it('forgets not_a_job, which a paste recognised as a job posting refutes', async () => {
    const link = links.seed({
      ...jobLinkDraft(LINKEDIN_JOB, { createdBy: ANA, now: clock.now() }),
      previewStatus: 'failed',
      previewVersion: 2,
      lastEnrichmentError: {
        reason: 'not_a_job',
        at: clock.now().toISOString(),
      },
    });
    await share(link.id);

    const summary = await pasteDescription.execute(BETO, link.id, {
      text: PASTED_TEXT,
    });

    expect(summary.lastEnrichmentError).toBeUndefined();
  });

  it('Título precargado sin tocar no se vuelve manual', async () => {
    const linkId = await readLink();
    extraction.answering({
      outcome: 'extracted',
      fields: { ...frontendOffer, title: 'Backend Engineer' },
    });

    const summary = await pasteDescription.execute(BETO, linkId, {
      text: PASTED_TEXT,
      title: 'Backend Engineer',
    });

    expect(summary.previewSources?.title).toMatchObject({
      source: 'auto',
      extractor: 'json-ld',
    });
  });

  it('redoes the merge on what won the race, with the same reading and without calling the AI again', async () => {
    const linkId = await blockedLink();
    // Un enriquecimiento escribe entre la lectura y la escritura del pegado: trae la ubicación de la página.
    links.interleaveBeforeNextPasteWrite(() => {
      links.overwrite(linkId, {
        previewStatus: 'partial',
        preview: { location: 'La Paz' },
        previewSources: {
          location: {
            value: 'La Paz',
            source: 'auto',
            extractor: 'json-ld',
            at: clock.now().toISOString(),
          },
        },
      });
    });

    const summary = await pasteDescription.execute(BETO, linkId, {
      text: PASTED_TEXT,
    });

    expect(links.lostPasteRaces).toBe(1);
    expect(extraction.requests).toHaveLength(1);
    // Se escribió sobre la versión que ganó: 2 → 3 del enriquecimiento, 3 → 4 del pegado.
    expect(summary.previewVersion).toBe(4);
    const location = summary.previewSources?.location;
    expect(location?.source).toBe('pasted');
    expect(
      location?.source === 'pasted' ? location.replaced : undefined,
    ).toMatchObject({
      value: 'La Paz',
      source: 'auto',
    });
  });

  it('a paste that changes nothing writes nothing and keeps the version', async () => {
    const linkId = await readLink();
    extraction.answering({
      outcome: 'extracted',
      fields: { title: 'Backend Engineer' },
    });

    const summary = await pasteDescription.execute(BETO, linkId, {
      text: PASTED_TEXT,
    });

    expect(summary.previewVersion).toBe(2);
    expect(publisher.published).toEqual([]);
  });
});

describe('PasteDescription: the notice', () => {
  it('announces the pasted link on the shared channel', async () => {
    const linkId = await blockedLink();

    await pasteDescription.execute(BETO, linkId, { text: PASTED_TEXT });

    expect(publisher.published).toEqual([
      { linkId, previewStatus: 'partial', previewVersion: 3 },
    ]);
  });

  it('answers without waiting for the notice to be published', async () => {
    const linkId = await blockedLink();
    publisher.hang();

    const summary = await pasteDescription.execute(BETO, linkId, {
      text: PASTED_TEXT,
    });

    expect(summary.previewVersion).toBe(3);
  });

  it('a Redis that is down does not make the answer fail', async () => {
    const linkId = await blockedLink();
    publisher.fail();

    const summary = await pasteDescription.execute(BETO, linkId, {
      text: PASTED_TEXT,
    });

    expect(summary.previewVersion).toBe(3);
    expect(publisher.published).toHaveLength(1);
  });
});
