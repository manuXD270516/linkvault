import { randomUUID } from 'node:crypto';
import {
  PASTED_PREVIEW_EXTRACTOR,
  previewSourcesSchema,
  type PreviewSources,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection, type Model } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PreviewWrite } from '../../application/ports/link-repository.port';
import {
  JOB_LINKS_COLLECTION,
  JOB_LINK_MODEL_NAME,
  jobLinkSchema,
  type JobLinkDocument,
} from './link.schemas';
import { MongoLinkRepository } from './mongo-link.repository';

// Adaptador Mongo de `LINK_REPOSITORY` (tarea 5.2) contra el MongoMemoryReplSet del preset de @linkvault/testing. Lo
// que se prueba aquí es la carrera: la escritura condicionada por versión es la idempotencia de D2, y sin un Mongo de
// verdad no se demuestra que sea atómica.

let connection: Connection;
let links: Model<JobLinkDocument>;
let repository: MongoLinkRepository;

const ANA = new mongoose.Types.ObjectId();
const AT = new Date('2026-09-18T10:00:00.000Z');

async function insertLink(
  overrides: Partial<JobLinkDocument> = {},
): Promise<string> {
  const created = await links.create({
    displayUrl: 'https://bolsa.example/jobs/1?utm_source=whatsapp',
    createdBy: ANA,
    previewStatus: 'pending',
    previewVersion: 1,
    updatedAt: new Date('2026-09-17T10:00:00.000Z'),
    ...overrides,
  });
  return created._id.toHexString();
}

function writeOf(overrides: Partial<PreviewWrite> = {}): PreviewWrite {
  return {
    previewStatus: 'enriched',
    preview: {
      title: 'Arquitecto(a) de Soluciones',
      company: 'Empresa Ejemplo',
    },
    previewSources: {
      title: {
        value: 'Arquitecto(a) de Soluciones',
        source: 'auto',
        extractor: 'json-ld',
        at: AT.toISOString(),
      },
      company: {
        value: 'Empresa Ejemplo',
        source: 'auto',
        extractor: 'json-ld',
        at: AT.toISOString(),
      },
    },
    lastEnrichmentError: null,
    at: AT,
    ...overrides,
  };
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `enrichment-${randomUUID()}`,
    })
    .asPromise();
  links = connection.model<JobLinkDocument>(JOB_LINK_MODEL_NAME, jobLinkSchema);
  repository = new MongoLinkRepository(links);
});

afterEach(async () => {
  await connection.collection(JOB_LINKS_COLLECTION).deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('findById', () => {
  it('reads what the enrichment needs from the link', async () => {
    const linkId = await insertLink();

    expect(await repository.findById(linkId)).toEqual({
      id: linkId,
      displayUrl: 'https://bolsa.example/jobs/1?utm_source=whatsapp',
      createdBy: ANA.toHexString(),
      previewStatus: 'pending',
      previewVersion: 1,
      preview: {},
      previewSources: {},
    });
  });

  it('answers nothing for a link that no longer exists', async () => {
    expect(
      await repository.findById(new mongoose.Types.ObjectId().toHexString()),
    ).toBeNull();
  });

  it('answers nothing for something that is not an identifier, instead of failing', async () => {
    expect(await repository.findById('no-soy-un-id')).toBeNull();
    expect(await repository.findById('')).toBeNull();
  });
});

describe('Dos enriquecimientos a la vez', () => {
  it('lets only one write, and the version goes up by exactly one', async () => {
    const linkId = await insertLink();
    const link = await repository.findById(linkId);

    // Las dos ejecuciones parten de la misma versión leída, que es la carrera que D2 describe.
    const [first, second] = await Promise.all([
      repository.writePreview(linkId, link?.previewVersion ?? 0, writeOf()),
      repository.writePreview(
        linkId,
        link?.previewVersion ?? 0,
        writeOf({ preview: { title: 'La otra' } }),
      ),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect((await repository.findById(linkId))?.previewVersion).toBe(2);
  });

  it('does not modify anything when it writes over an old version', async () => {
    const linkId = await insertLink({ previewVersion: 4 });

    expect(await repository.writePreview(linkId, 3, writeOf())).toBe(false);

    const link = await repository.findById(linkId);
    expect(link?.previewVersion).toBe(4);
    expect(link?.previewStatus).toBe('pending');
    expect(link?.preview).toEqual({});
  });

  it('does not write over a link that no longer exists', async () => {
    expect(
      await repository.writePreview(
        new mongoose.Types.ObjectId().toHexString(),
        1,
        writeOf(),
      ),
    ).toBe(false);
  });
});

describe('writePreview', () => {
  it('stores the preview with its provenance and bumps the version', async () => {
    const linkId = await insertLink();

    expect(await repository.writePreview(linkId, 1, writeOf())).toBe(true);

    const link = await repository.findById(linkId);
    expect(link?.previewStatus).toBe('enriched');
    expect(link?.previewVersion).toBe(2);
    expect(link?.preview).toEqual({
      title: 'Arquitecto(a) de Soluciones',
      company: 'Empresa Ejemplo',
    });
    expect(link?.previewSources.title).toEqual({
      value: 'Arquitecto(a) de Soluciones',
      source: 'auto',
      extractor: 'json-ld',
      at: AT.toISOString(),
    });
  });

  it('stores a manual field with who wrote it and what it displaced', async () => {
    const linkId = await insertLink();

    await repository.writePreview(
      linkId,
      1,
      writeOf({
        previewStatus: 'manual',
        preview: { title: 'Arquitecto de Soluciones (Java)' },
        previewSources: {
          title: {
            value: 'Arquitecto de Soluciones (Java)',
            source: 'manual',
            by: ANA.toHexString(),
            at: AT.toISOString(),
            replaced: {
              value: 'Arquitecto(a) de Soluciones',
              source: 'auto',
              extractor: 'json-ld',
            },
          },
        },
      }),
    );

    expect((await repository.findById(linkId))?.previewSources.title).toEqual({
      value: 'Arquitecto de Soluciones (Java)',
      source: 'manual',
      by: ANA.toHexString(),
      at: AT.toISOString(),
      replaced: {
        value: 'Arquitecto(a) de Soluciones',
        source: 'auto',
        extractor: 'json-ld',
      },
    });
  });

  it('keeps manual over pasted whole: source, author, extractor and date, of the entry and of what it displaced', async () => {
    // Los dos schemas de `job_links` son `strict: true`: una clave que no declararan se descartaría en silencio y
    // "Volver a lo pegado" devolvería un valor sin origen ni autor. Por eso se mira también el documento crudo.
    const linkId = await insertLink();
    const beto = new mongoose.Types.ObjectId().toHexString();
    const previewSources = {
      title: {
        value: 'Arquitecto de Soluciones (Java)',
        source: 'manual',
        by: ANA.toHexString(),
        at: AT.toISOString(),
        replaced: {
          value: 'Arquitecto de Soluciones',
          source: 'pasted',
          extractor: PASTED_PREVIEW_EXTRACTOR,
          by: beto,
          at: '2026-09-17T10:00:00.000Z',
        },
      },
      company: {
        value: 'Empresa Ejemplo',
        source: 'pasted',
        extractor: PASTED_PREVIEW_EXTRACTOR,
        by: beto,
        at: '2026-09-17T10:00:00.000Z',
        replaced: {
          value: 'Empresa Ejemplo S.A.',
          source: 'auto',
          extractor: 'json-ld',
          at: '2026-09-16T10:00:00.000Z',
        },
      },
    } as const satisfies PreviewSources;

    await repository.writePreview(
      linkId,
      1,
      writeOf({
        previewStatus: 'manual',
        preview: {
          title: 'Arquitecto de Soluciones (Java)',
          company: 'Empresa Ejemplo',
        },
        previewSources,
      }),
    );

    expect((await repository.findById(linkId))?.previewSources).toEqual(
      previewSources,
    );
    const raw = await links.collection.findOne({
      _id: new mongoose.Types.ObjectId(linkId),
    });
    expect(raw?.['previewSources']).toEqual(previewSources);
    expect(previewSourcesSchema.parse(raw?.['previewSources'])).toEqual(
      previewSources,
    );
  });

  it('stores every shape of the contract, salary and lists included', async () => {
    const linkId = await insertLink();

    await repository.writePreview(
      linkId,
      1,
      writeOf({
        preview: {
          title: 'Arquitecto',
          modality: 'remote',
          seniority: 'senior',
          salary: { min: 12000, max: 18000, currency: 'BOB', period: 'month' },
          skills: [{ name: 'Java', required: true }],
          languages: [{ name: 'Inglés', level: 'B2' }],
          postedAt: '2026-09-14',
          expiresAt: '2026-10-14',
        },
        previewSources: {},
      }),
    );

    expect((await repository.findById(linkId))?.preview).toEqual({
      title: 'Arquitecto',
      modality: 'remote',
      seniority: 'senior',
      salary: { min: 12000, max: 18000, currency: 'BOB', period: 'month' },
      skills: [{ name: 'Java', required: true }],
      languages: [{ name: 'Inglés', level: 'B2' }],
      postedAt: '2026-09-14',
      expiresAt: '2026-10-14',
    });
  });

  it('records a failure reason without the response behind it', async () => {
    const linkId = await insertLink();

    await repository.writePreview(
      linkId,
      1,
      writeOf({
        previewStatus: 'failed',
        preview: {},
        previewSources: {},
        lastEnrichmentError: { reason: 'blocked', at: AT.toISOString() },
      }),
    );

    const stored = await links.findById(linkId).lean().exec();
    expect(stored?.lastEnrichmentError).toEqual({
      reason: 'blocked',
      at: AT.toISOString(),
    });
  });

  it('clears the previous failure when the link is read at last', async () => {
    const linkId = await insertLink({
      lastEnrichmentError: { reason: 'timeout', at: AT.toISOString() },
    });

    await repository.writePreview(linkId, 1, writeOf());

    const stored = await links.findById(linkId).lean().exec();
    expect(stored?.lastEnrichmentError).toBeUndefined();
  });
});

describe('saveSnapshotKey', () => {
  it('stores the key in the link, so it is never guessed from the version', async () => {
    const linkId = await insertLink();
    await repository.writePreview(linkId, 1, writeOf());

    await repository.saveSnapshotKey(linkId, `${linkId}/2.html.gz`);

    const stored = await links.findById(linkId).lean().exec();
    expect(stored?.snapshotKey).toBe(`${linkId}/2.html.gz`);
    // Y no toca la versión: guardar la copia no es un enriquecimiento nuevo.
    expect(stored?.previewVersion).toBe(2);
  });

  it('does nothing for something that is not an identifier', async () => {
    await expect(
      repository.saveSnapshotKey('no-soy-un-id', 'x'),
    ).resolves.toBeUndefined();
  });
});
