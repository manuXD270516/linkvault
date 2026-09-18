import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupNotFound } from '../../groups/domain/errors';
import { TextTooLong, TooManyLinkAttempts } from '../domain/errors';
import { MAX_IMPORT_TEXT_LENGTH, MAX_LINKS_PER_IMPORT } from '../domain/limits';
import { ImportLinks } from './import-links.usecase';
import { SaveLink } from './save-link.usecase';
import { InMemoryGroupLinkRepository } from './testing/in-memory-group-link.repository';
import { InMemoryJobLinkRepository } from './testing/in-memory-job-link.repository';
import { InMemoryUserLinkRepository } from './testing/in-memory-user-link.repository';
import { objectId } from './testing/link-fixtures';
import {
  InMemoryGroupMembership,
  InMemoryLinkLimiter,
  InMemoryLinkUserDirectory,
  InMemoryOutbox,
  MovableClock,
} from './testing/links-test-doubles';

// `POST /api/links/import` (tarea 5.3 de job-links) con los dobles en memoria de sus puertos.

const ANA = objectId(1);
const BETO = objectId(2);
const BACKEND = objectId(10);
const STRANGERS = objectId(12);
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const SEARCH_PAGE =
  'https://www.linkedin.com/jobs/search/?currentJobId=3811111111';
const COMPUTRABAJO =
  'https://bo.computrabajo.com/acme/ofertas-de-trabajo/oferta-de-trabajo-de-backend-en-la-paz-a1b2c3d4e5f60718';
const CAREERS = 'https://empresa.example/careers/backend';

let clock: MovableClock;
let links: InMemoryJobLinkRepository;
let groupLinks: InMemoryGroupLinkRepository;
let userLinks: InMemoryUserLinkRepository;
let outbox: InMemoryOutbox;
let membership: InMemoryGroupMembership;
let limiter: InMemoryLinkLimiter;
let importLinks: ImportLinks;
let saveLink: SaveLink;

beforeEach(() => {
  clock = new MovableClock();
  links = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(links);
  userLinks = new InMemoryUserLinkRepository(links);
  outbox = new InMemoryOutbox();
  membership = new InMemoryGroupMembership()
    .withMember(BACKEND, ANA, 'owner', 'Backend Bolivia')
    .withMember(BACKEND, BETO)
    .withMember(STRANGERS, BETO, 'owner', 'De Beto');
  const directory = new InMemoryLinkUserDirectory()
    .set(ANA, 'Ana')
    .set(BETO, 'Beto');
  limiter = new InMemoryLinkLimiter();
  importLinks = new ImportLinks(
    links,
    groupLinks,
    userLinks,
    outbox,
    membership,
    directory,
    limiter,
    clock,
  );
  saveLink = new SaveLink(
    links,
    groupLinks,
    userLinks,
    outbox,
    membership,
    directory,
    clock,
  );
});

/**
 * Espía todo lo que podría registrar algo (el logger de Nest y la consola) y devuelve lo que se haya escrito. Los
 * espías los deshace `vi.restoreAllMocks` al terminar cada test.
 */
function spyOnEveryLogger(): unknown[] {
  const logged: unknown[] = [];
  const record = (...args: unknown[]): void => {
    logged.push(...args);
  };
  for (const method of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
    vi.spyOn(Logger.prototype, method).mockImplementation(record);
    vi.spyOn(Logger, method).mockImplementation(record);
  }
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation(record);
  }
  return logged;
}

/** Texto con `count` URLs distintas, una por línea, como un chat pegado. */
function chatWith(count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `[10:0${index % 10}] Ana: https://empresa.example/careers/${index}`,
  ).join('\n');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ImportLinks', () => {
  it('Importar un chat', async () => {
    await saveLink.execute(BETO, { url: CAREERS, groupId: BACKEND });
    const chat = [
      `[17/9/2026, 10:02] Ana: miren esta ${JOB_PAGE}`,
      `[17/9/2026, 10:03] Beto: la misma de antes ${SEARCH_PAGE}`,
      `[17/9/2026, 10:04] Ana: y esta (${COMPUTRABAJO})`,
      `[17/9/2026, 10:05] Beto: esta ya la pasé ${CAREERS}`,
    ].join('\n');

    const response = await importLinks.execute(ANA, {
      text: chat,
      groupId: BACKEND,
    });

    expect(response.created).toBe(2);
    expect(response.existing).toBe(1);
    expect(response.unrecognized).toBe(0);
    expect(response.skipped).toBe(0);
    expect(await groupLinks.countByGroup(BACKEND)).toBe(3);
  });

  it('Importar sin URLs', async () => {
    const response = await importLinks.execute(ANA, {
      text: 'Ana: ¿alguien sabe de algo para backend?\nBeto: te aviso',
      groupId: BACKEND,
    });

    expect(response).toEqual({
      created: 0,
      existing: 0,
      unrecognized: 0,
      skipped: 0,
      links: [],
    });
    expect(links.size).toBe(0);
  });

  it('Chat con más de 50 enlaces', async () => {
    const response = await importLinks.execute(ANA, {
      text: chatWith(60),
      groupId: BACKEND,
    });

    expect(response.created).toBe(MAX_LINKS_PER_IMPORT);
    expect(response.skipped).toBe(10);
    expect(response.links).toHaveLength(MAX_LINKS_PER_IMPORT);
    expect(await groupLinks.countByGroup(BACKEND)).toBe(50);
  });

  it('Segunda pasada del mismo chat', async () => {
    const chat = chatWith(60);
    await importLinks.execute(ANA, { text: chat, groupId: BACKEND });

    const response = await importLinks.execute(ANA, {
      text: chat,
      groupId: BACKEND,
    });

    expect(response.created).toBe(10);
    expect(response.existing).toBe(50);
    expect(response.skipped).toBe(0);
    expect(await groupLinks.countByGroup(BACKEND)).toBe(60);
  });

  it('Texto demasiado largo', async () => {
    const text = `${JOB_PAGE}\n${'a'.repeat(MAX_IMPORT_TEXT_LENGTH)}`;

    await expect(
      importLinks.execute(ANA, { text, groupId: BACKEND }),
    ).rejects.toBeInstanceOf(TextTooLong);
    expect(links.size).toBe(0);
    expect(outbox.size).toBe(0);
  });

  it('Texto con datos personales', async () => {
    const chat = [
      '[17/9/2026, 10:02] Ana Quispe (+591 70000000): postulé aquí',
      JOB_PAGE,
      '[17/9/2026, 10:03] Beto Mamani: mi correo es beto@example.com',
    ].join('\n');
    // `links` no inyecta ningún logger —ni pino ni el de Nest—, así que el texto no puede acabar en un log ni por
    // descuido. Estos espías lo dejan probado en vez de dicho: si alguien añadiera un `logger.log(text)` o un
    // `console.log`, este test fallaría.
    const logged = spyOnEveryLogger();

    const response = await importLinks.execute(ANA, {
      text: chat,
      groupId: BACKEND,
    });

    expect(response.created).toBe(1);
    const stored = JSON.stringify([
      links.all,
      await groupLinks.listByGroup(BACKEND, { limit: 20 }),
      outbox.appended,
    ]);
    for (const trace of [stored, JSON.stringify(logged)]) {
      expect(trace).not.toContain('70000000');
      expect(trace).not.toContain('beto@example.com');
      expect(trace).not.toContain('Quispe');
    }
    // De hecho, la importación no registró absolutamente nada.
    expect(logged).toEqual([]);
  });

  it('counts the links it could not read and keeps going with the rest', async () => {
    const chat = [
      'Ana: se cortó http://',
      'Beto: y este ftp://example.com/job',
      `Ana: esta sí ${JOB_PAGE}`,
    ].join('\n');

    const response = await importLinks.execute(ANA, {
      text: chat,
      groupId: BACKEND,
    });

    expect(response).toMatchObject({
      created: 1,
      existing: 0,
      unrecognized: 2,
      skipped: 0,
    });
  });

  it('counts a link it could not save in unrecognized, and saves the rest', async () => {
    // `unrecognized` cuenta lo que no se pudo **leer ni guardar** (spec links/sharing): una escritura que falla —una
    // carrera perdida, una transacción rechazada— no puede tirar la importación entera ni desaparecer del resumen.
    vi.spyOn(links, 'withResolvedLink').mockRejectedValueOnce(
      new Error('the write failed'),
    );

    const response = await importLinks.execute(ANA, {
      text: `${JOB_PAGE} ${COMPUTRABAJO}`,
      groupId: BACKEND,
    });

    expect(response).toMatchObject({
      created: 1,
      existing: 0,
      unrecognized: 1,
      skipped: 0,
    });
    expect(response.links).toHaveLength(1);
    expect(response.links[0]?.platform).toBe('computrabajo');
    expect(await groupLinks.countByGroup(BACKEND)).toBe(1);
  });

  it('keeps the order of the text and one entry per vacancy', async () => {
    const chat = `${COMPUTRABAJO} ${JOB_PAGE} ${SEARCH_PAGE} ${CAREERS}`;

    const response = await importLinks.execute(ANA, {
      text: chat,
      groupId: BACKEND,
    });

    expect(response.created).toBe(3);
    expect(response.links.map((link) => link.platform)).toEqual([
      'computrabajo',
      'linkedin',
      'generic',
    ]);
    expect(response.links[1]?.displayUrl).toBe(JOB_PAGE);
  });

  it('writes one outbox event per new vacancy, none for the ones that already existed', async () => {
    await saveLink.execute(BETO, { url: CAREERS, groupId: STRANGERS });

    const response = await importLinks.execute(ANA, {
      text: `${CAREERS} ${JOB_PAGE}`,
      groupId: BACKEND,
    });

    expect(response.created).toBe(2);
    // La vacante de `CAREERS` ya existía: solo se encola la nueva.
    expect(outbox.size).toBe(2);
  });

  it('imports into the private list when there is no group', async () => {
    const response = await importLinks.execute(ANA, {
      text: `${JOB_PAGE} ${COMPUTRABAJO}`,
    });

    expect(response.created).toBe(2);
    expect(response.links.every((link) => link.sharedBy === undefined)).toBe(
      true,
    );
    expect(await userLinks.countByUser(ANA)).toBe(2);
    expect(await groupLinks.countByGroup(BACKEND)).toBe(0);
  });

  it('answers group_not_found for a group of somebody else, without saving anything', async () => {
    await expect(
      importLinks.execute(ANA, { text: JOB_PAGE, groupId: STRANGERS }),
    ).rejects.toBeInstanceOf(GroupNotFound);
    await expect(
      importLinks.execute(ANA, { text: JOB_PAGE, groupId: 'no-es-un-id' }),
    ).rejects.toBeInstanceOf(GroupNotFound);

    expect(links.size).toBe(0);
  });

  it('names whoever shared each link of the summary', async () => {
    await saveLink.execute(BETO, { url: JOB_PAGE, groupId: BACKEND });

    const response = await importLinks.execute(ANA, {
      text: `${SEARCH_PAGE} ${COMPUTRABAJO}`,
      groupId: BACKEND,
    });

    expect(response.links.map((link) => link.sharedBy?.displayName)).toEqual([
      'Beto',
      'Ana',
    ]);
  });
});

describe('import limit per user', () => {
  it('Ventana agotada', async () => {
    limiter.exhaust({ kind: 'import', userId: ANA });

    await expect(
      importLinks.execute(ANA, { text: `${JOB_PAGE} ${COMPUTRABAJO}` }),
    ).rejects.toBeInstanceOf(TooManyLinkAttempts);
    // Ni un link creado ni un evento encolado: el límite cuenta antes de tocar nada.
    expect(links.size).toBe(0);
    expect(outbox.size).toBe(0);
  });

  it('counts one import per call, and only for whoever asks', async () => {
    await importLinks.execute(ANA, { text: JOB_PAGE });
    await importLinks.execute(BETO, { text: COMPUTRABAJO });

    expect(limiter.consumed).toEqual([
      { kind: 'import', userId: ANA },
      { kind: 'import', userId: BETO },
    ]);
  });

  it('Guardar uno a uno no cuenta', async () => {
    limiter.exhaust({ kind: 'import', userId: ANA });

    const saved = await saveLink.execute(ANA, { url: JOB_PAGE });

    expect(saved.created).toBe(true);
    // Ni siquiera se preguntó al contador: guardar un link suelto es otra operación y otro coste.
    expect(limiter.consumed).toEqual([]);
  });
});
