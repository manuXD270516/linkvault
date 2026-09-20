import {
  type GroupDetail,
  type PublicShare,
  type SaveLinkResponse,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OUTBOX_EVENTS_COLLECTION } from '../../../infrastructure/outbox/outbox-event.schemas';
import {
  createLinksTestApp,
  type LinksTestApp,
  type TestMember,
} from '../../../test-support/links-test-app';
import { GROUP_LINKS_COLLECTION, JOB_LINKS_COLLECTION } from '../infrastructure/link.schemas';

// La página pública no dispara trabajo (tarea 6.13 de public-preview-share, D7): dos lecturas indexadas, ninguna
// escritura y ni una petición a la bolsa, aunque el link esté `failed`.
//
// Las operaciones se cuentan con el espía de comandos del driver, que la conexión de la app enciende solo con
// `NODE_ENV=test`.

/** Comandos que escriben; si alguno aparece, la petición dejó de ser de solo lectura. */
const WRITE_COMMANDS = new Set([
  'insert',
  'update',
  'delete',
  'findAndModify',
  'create',
  'createIndexes',
  'drop',
]);

/** Comandos que leen. */
const READ_COMMANDS = new Set(['find', 'aggregate', 'count', 'distinct', 'getMore']);

describe('la página pública no dispara trabajo', () => {
  let http: LinksTestApp;
  let ana: TestMember;
  let group: GroupDetail;
  let share: PublicShare;
  let commands: { name: string; collection: unknown }[] = [];

  beforeAll(async () => {
    http = await createLinksTestApp('links-public-cost', getMongoTestUri());
    ana = await http.authenticated('Ana');
    group = await http.createGroup(ana, 'Backend Bolivia');
    const saved = await http.request('POST', '/api/links', {
      authorization: ana.authorization,
      body: {
        url: 'https://www.linkedin.com/jobs/view/3811111111/',
        groupId: group.id,
      },
    });
    expect(saved.statusCode).toBe(201);
    const published = saved.json<SaveLinkResponse>().link.publicShare;
    if (published === undefined) {
      throw new Error('El grupo comparte en público: el link nace publicado');
    }
    share = published;
    // El estado normal de un link recién compartido que no se pudo leer: la página se sirve igual.
    await http.connection
      .collection(JOB_LINKS_COLLECTION)
      .updateMany({}, { $set: { previewStatus: 'failed' } });
    // El evento del alta ya está escrito: se limpia para que el conteo mire solo lo que hacen las páginas.
    await http.connection.collection(OUTBOX_EVENTS_COLLECTION).deleteMany({});

    const client = http.connection.getClient();
    client.on('commandStarted', (event) => {
      if (event.commandName !== 'ping' && event.commandName !== 'hello') {
        commands.push({
          name: event.commandName,
          collection: event.command[event.commandName],
        });
      }
    });
  });

  afterAll(async () => {
    await http.close();
  });

  it('Mil peticiones no leen la bolsa', async () => {
    commands = [];

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await http.request('GET', `/p/${share.slug}`);
      expect(response.statusCode).toBe(200);
    }

    const writes = commands.filter((command) =>
      WRITE_COMMANDS.has(command.name),
    );
    const reads = commands.filter((command) => READ_COMMANDS.has(command.name));
    expect(writes).toEqual([]);
    // Exactamente dos lecturas por petición: la relación por su slug y la vacante.
    expect(reads).toHaveLength(100);
    expect(
      reads.filter((command) => command.collection === GROUP_LINKS_COLLECTION),
    ).toHaveLength(50);
    expect(
      reads.filter((command) => command.collection === JOB_LINKS_COLLECTION),
    ).toHaveLength(50);
    await expect(
      http.connection.collection(OUTBOX_EVENTS_COLLECTION).countDocuments({}),
    ).resolves.toBe(0);
  });

  it('un 404 tampoco escribe nada', async () => {
    commands = [];

    const response = await http.request('GET', '/p/zzzzzzzzzzzz');

    expect(response.statusCode).toBe(404);
    expect(commands.filter((command) => WRITE_COMMANDS.has(command.name))).toEqual(
      [],
    );
    await expect(
      http.connection.collection(OUTBOX_EVENTS_COLLECTION).countDocuments({}),
    ).resolves.toBe(0);
  });

  it('Cabeceras de caché', async () => {
    const ok = await http.request('GET', `/p/${share.slug}`);
    const gone = await http.request('GET', '/p/zzzzzzzzzzzz');

    expect(ok.headers['cache-control']).toBe('public, max-age=60');
    expect(gone.headers['cache-control']).toBe('no-store');
    expect(ok.headers['etag']).toBeUndefined();
    expect(ok.headers['vary']).toBeUndefined();
  });
});
