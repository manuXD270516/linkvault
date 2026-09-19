import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { mongo, type Connection } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NewGroupLinkComment } from '../domain/group-link-comment';
import type { TransactionSession } from '../application/ports/transaction-session';
import { jobLinkDraft } from '../application/testing/link-fixtures';
import {
  GROUP_LINK_COMMENT_MODEL_NAME,
  GROUP_LINK_COMMENTS_COLLECTION,
} from './group-link-comment.schemas';
import {
  GROUP_LINK_MODEL_NAME,
  GROUP_LINKS_COLLECTION,
  JOB_LINK_MODEL_NAME,
  JOB_LINKS_COLLECTION,
} from './link.schemas';
import { MongoGroupLinkCommentRepository } from './mongo-group-link-comment.repository';
import { MongoGroupLinkRepository } from './mongo-group-link.repository';
import { MongoJobLinkRepository } from './mongo-job-link.repository';

// `MongoGroupLinkRepository` como único dueño de los comentarios de una relación (tareas 2.7 a 2.11 de group-comments),
// contra el MongoMemoryReplSet del preset de @linkvault/testing: contadores y revisión, la nota, la retirada con sus
// comentarios en una transacción y los dos órdenes de la carrera "comentar mientras se quita".
//
// La carrera se prueba **de forma determinista**: el alta se detiene en el punto de espera que solo existe en los tests
// (entre el `$inc` y el `insert`), y se espera a ver el `WriteConflict` de la otra transacción en los eventos de comando
// del driver antes de dejarla seguir. Nada depende de un `setTimeout`.

let connection: Connection;
let links: MongoJobLinkRepository;
let comments: MongoGroupLinkCommentRepository;
let groupLinks: PausableGroupLinkRepository;

const id = () => new mongoose.Types.ObjectId().toHexString();
const ANA = id();
const BETO = id();
const BACKEND = id();
const FRONTEND = id();
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const OTHER_JOB = 'https://www.linkedin.com/jobs/view/3822222222/';
const now = new Date('2026-09-19T10:00:00.000Z');
const later = new Date('2026-09-19T11:00:00.000Z');

/** Alta detenida en el punto de espera, y cómo dejarla seguir. */
interface Pause {
  readonly reached: Promise<void>;
  release(): void;
}

/**
 * El adaptador de producción con el punto de espera ocupado: la **siguiente** alta se detiene tras el `$inc`, antes del
 * `insert`, hasta que el test la suelta. Los reintentos de `withTransaction` ya no se detienen.
 */
class PausableGroupLinkRepository extends MongoGroupLinkRepository {
  private pending: { arrive: () => void; leave: Promise<void> } | null = null;

  pauseNextInsert(): Pause {
    let arrive = (): void => undefined;
    let release = (): void => undefined;
    const reached = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    const leave = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.pending = { arrive, leave };
    return { reached, release };
  }

  protected override async beforeCommentInsert(): Promise<void> {
    const pending = this.pending;
    if (pending === null) {
      return;
    }
    this.pending = null;
    pending.arrive();
    await pending.leave;
  }
}

/** Comentarios cuyo borrado por relación o por grupo falla, para probar que la transacción se deshace entera. */
class FailingCommentDeletions extends MongoGroupLinkCommentRepository {
  override deleteByRelation(): Promise<number> {
    return Promise.reject(new Error('Forced failure deleting comments'));
  }

  override deleteByGroup(): Promise<number> {
    return Promise.reject(new Error('Forced failure deleting comments'));
  }
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `group-comments-${randomUUID()}`,
      // Los eventos de comando son lo que deja ver el `WriteConflict` de la otra transacción.
      monitorCommands: true,
    })
    .asPromise();
  links = new MongoJobLinkRepository(connection);
  comments = new MongoGroupLinkCommentRepository(connection);
  groupLinks = new PausableGroupLinkRepository(connection, comments);
  await connection.model(JOB_LINK_MODEL_NAME).init();
  await connection.model(GROUP_LINK_MODEL_NAME).init();
  await connection.model(GROUP_LINK_COMMENT_MODEL_NAME).init();
});

afterEach(async () => {
  await connection.collection(JOB_LINKS_COLLECTION).deleteMany({});
  await connection.collection(GROUP_LINKS_COLLECTION).deleteMany({});
  await connection.collection(GROUP_LINK_COMMENTS_COLLECTION).deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

/** Guarda la URL y la comparte en el grupo, como `save-link`. */
async function shareLink(
  url: string,
  groupId: string,
  options: {
    sharedBy?: string;
    sharedAt?: Date;
    note?: { text: string; createdAt: Date };
  } = {},
): Promise<string> {
  const sharedBy = options.sharedBy ?? ANA;
  const sharedAt = options.sharedAt ?? now;
  return await links.withResolvedLink(
    jobLinkDraft(url, { createdBy: sharedBy, now: sharedAt }),
    async (resolved, session) => {
      await groupLinks.share(
        {
          groupId,
          linkId: resolved.link.id,
          sharedBy,
          sharedAt,
          ...(options.note === undefined ? {} : { note: options.note }),
        },
        session,
      );
      return resolved.link.id;
    },
  );
}

function draft(
  groupId: string,
  linkId: string,
  text = 'Piden inglés C1',
): NewGroupLinkComment {
  return { groupId, linkId, authorId: BETO, text, createdAt: later };
}

async function commentsOf(groupId: string, linkId: string): Promise<number> {
  return await connection
    .collection(GROUP_LINK_COMMENTS_COLLECTION)
    .countDocuments({
      groupId: new mongoose.Types.ObjectId(groupId),
      linkId: new mongoose.Types.ObjectId(linkId),
    });
}

/** Se resuelve con el primer comando de ese nombre que falle, que aquí es siempre un `WriteConflict`. */
function nextFailure(commandName: string): Promise<mongo.CommandFailedEvent> {
  const client = connection.getClient();
  return new Promise((resolve) => {
    const listener = (event: mongo.CommandFailedEvent): void => {
      if (event.commandName === commandName) {
        client.off('commandFailed', listener);
        resolve(event);
      }
    };
    client.on('commandFailed', listener);
  });
}

function codeOf(event: mongo.CommandFailedEvent): unknown {
  const failure: unknown = event.failure;
  return failure instanceof mongo.MongoServerError ? failure.codeName : failure;
}

describe('addComment and removeComment (2.7)', () => {
  it('counts and revises with every add and every delete, reporting the sharedAt of the relation', async () => {
    const linkId = await shareLink(JOB_PAGE, BACKEND);

    const first = await groupLinks.addComment(draft(BACKEND, linkId, 'uno'));
    const second = await groupLinks.addComment(draft(BACKEND, linkId, 'dos'));

    expect(first?.counters).toEqual({ count: 1, revision: 1, sharedAt: now });
    expect(second?.counters).toEqual({ count: 2, revision: 2, sharedAt: now });
    expect(second?.comment).toMatchObject({ text: 'dos', authorId: BETO });

    const removed = await groupLinks.removeComment(
      BACKEND,
      linkId,
      first?.comment.id ?? '',
    );

    expect(removed).toEqual({ count: 1, revision: 3, sharedAt: now });
    expect(await groupLinks.find(BACKEND, linkId)).toMatchObject({
      commentCount: 1,
      commentsRevision: 3,
    });
    expect(await commentsOf(BACKEND, linkId)).toBe(1);
  });

  it('touches neither counter when the comment was already gone', async () => {
    const linkId = await shareLink(JOB_PAGE, BACKEND);
    const added = await groupLinks.addComment(draft(BACKEND, linkId));
    const commentId = added?.comment.id ?? '';
    await groupLinks.removeComment(BACKEND, linkId, commentId);

    expect(
      await groupLinks.removeComment(BACKEND, linkId, commentId),
    ).toBeNull();
    expect(
      await groupLinks.removeComment(BACKEND, linkId, 'no-es-un-id'),
    ).toBeNull();
    expect(await groupLinks.find(BACKEND, linkId)).toMatchObject({
      commentCount: 0,
      commentsRevision: 2,
    });
  });

  it('answers null and leaves no comment on a relation that does not exist', async () => {
    const linkId = await shareLink(JOB_PAGE, BACKEND);

    expect(await groupLinks.addComment(draft(FRONTEND, linkId))).toBeNull();
    expect(await groupLinks.addComment(draft('no-es-un-id', linkId))).toBeNull();
    expect(
      await connection.collection(GROUP_LINK_COMMENTS_COLLECTION).countDocuments(),
    ).toBe(0);
    expect(
      await connection
        .collection(GROUP_LINKS_COLLECTION)
        .countDocuments({ groupId: new mongoose.Types.ObjectId(FRONTEND) }),
    ).toBe(0);
  });

  it('reads a relation from before group-comments as 0 and 0, and counts from there', async () => {
    const linkId = await shareLink(JOB_PAGE, BACKEND);
    await connection
      .collection(GROUP_LINKS_COLLECTION)
      .updateMany({}, { $unset: { commentCount: 1, commentsRevision: 1 } });

    expect(await groupLinks.find(BACKEND, linkId)).toMatchObject({
      commentCount: 0,
      commentsRevision: 0,
    });
    expect(
      (await groupLinks.addComment(draft(BACKEND, linkId)))?.counters,
    ).toEqual({ count: 1, revision: 1, sharedAt: now });
  });
});

describe('the note (2.8)', () => {
  const note = { text: 'Esta es la que te dije', createdAt: now };

  it('La nota del primero se queda', async () => {
    const linkId = await shareLink(JOB_PAGE, BACKEND, { note });
    await shareLink(JOB_PAGE, BACKEND, {
      sharedBy: BETO,
      sharedAt: later,
      note: { text: 'Yo también la vi', createdAt: later },
    });

    expect(await groupLinks.find(BACKEND, linkId)).toMatchObject({
      sharedBy: ANA,
      note,
    });
  });

  it('Nota y comentarios en el listado: lists the note and the counters of each relation', async () => {
    const withNote = await shareLink(JOB_PAGE, BACKEND, { note });
    const plain = await shareLink(OTHER_JOB, BACKEND, { sharedAt: later });
    await groupLinks.addComment(draft(BACKEND, withNote));

    const page = await groupLinks.listByGroup(BACKEND, { limit: 20 });
    const byLink = new Map(page.items.map((item) => [item.link.id, item]));

    expect(byLink.get(withNote)?.inGroup).toEqual({
      note,
      commentCount: 1,
      commentsRevision: 1,
    });
    expect(byLink.get(plain)?.inGroup).toEqual({
      commentCount: 0,
      commentsRevision: 0,
    });
  });

  it('clears the note, and answers true again when there was none', async () => {
    const linkId = await shareLink(JOB_PAGE, BACKEND, { note });

    expect(await groupLinks.clearNote(BACKEND, linkId)).toBe(true);
    expect((await groupLinks.find(BACKEND, linkId))?.note).toBeUndefined();
    expect(await groupLinks.clearNote(BACKEND, linkId)).toBe(true);
  });

  it('Quitar una nota inexistente: false when the relation does not exist', async () => {
    const linkId = await shareLink(JOB_PAGE, BACKEND, { note });

    expect(await groupLinks.clearNote(FRONTEND, linkId)).toBe(false);
    expect(await groupLinks.clearNote('no-es-un-id', linkId)).toBe(false);
  });
});

describe('removeWithComments and deleteByGroup (2.9)', () => {
  it('Quitar se lleva los comentarios de ese grupo: takes the relation, its note and its comments in one go', async () => {
    const linkId = await shareLink(JOB_PAGE, BACKEND, {
      note: { text: 'Mira', createdAt: now },
    });
    await groupLinks.addComment(draft(BACKEND, linkId));
    await groupLinks.addComment(draft(BACKEND, linkId));

    expect(await groupLinks.removeWithComments(BACKEND, linkId)).toBe(true);
    expect(await groupLinks.find(BACKEND, linkId)).toBeNull();
    expect(await commentsOf(BACKEND, linkId)).toBe(0);
    expect(await links.findById(linkId)).not.toBeNull();
  });

  it('Otro grupo no se entera', async () => {
    const linkId = await shareLink(JOB_PAGE, BACKEND);
    await shareLink(JOB_PAGE, FRONTEND);
    await groupLinks.addComment(draft(BACKEND, linkId));
    await groupLinks.addComment(draft(FRONTEND, linkId));

    await groupLinks.removeWithComments(BACKEND, linkId);

    expect(await commentsOf(FRONTEND, linkId)).toBe(1);
    expect(await groupLinks.find(FRONTEND, linkId)).toMatchObject({
      commentCount: 1,
    });
  });

  it('Volver a compartirla empieza de cero', async () => {
    const linkId = await shareLink(JOB_PAGE, BACKEND);
    await groupLinks.addComment(draft(BACKEND, linkId));
    await groupLinks.removeWithComments(BACKEND, linkId);
    await shareLink(JOB_PAGE, BACKEND, { sharedAt: later });

    expect(await groupLinks.find(BACKEND, linkId)).toMatchObject({
      commentCount: 0,
      commentsRevision: 0,
      sharedAt: later,
    });
    expect(await commentsOf(BACKEND, linkId)).toBe(0);
  });

  it('Todo o nada: when deleting the comments fails, the relation and its comments stay', async () => {
    const linkId = await shareLink(JOB_PAGE, BACKEND);
    await groupLinks.addComment(draft(BACKEND, linkId));
    const failing = new MongoGroupLinkRepository(
      connection,
      new FailingCommentDeletions(connection),
    );

    await expect(failing.removeWithComments(BACKEND, linkId)).rejects.toThrow(
      'Forced failure deleting comments',
    );
    expect(await groupLinks.find(BACKEND, linkId)).not.toBeNull();
    expect(await commentsOf(BACKEND, linkId)).toBe(1);
  });

  it('deleteByGroup deletes the comments of the group first, with the session of groups', async () => {
    const linkId = await shareLink(JOB_PAGE, BACKEND);
    await shareLink(JOB_PAGE, FRONTEND);
    await groupLinks.addComment(draft(BACKEND, linkId));
    await groupLinks.addComment(draft(FRONTEND, linkId));
    const session = await connection.startSession();

    try {
      await session.withTransaction(() =>
        groupLinks.deleteByGroup(BACKEND, session as TransactionSession),
      );
    } finally {
      await session.endSession();
    }

    expect(await commentsOf(BACKEND, linkId)).toBe(0);
    expect(await commentsOf(FRONTEND, linkId)).toBe(1);
    expect(await groupLinks.countByGroup(BACKEND)).toBe(0);
  });

  it('deleteByGroup leaves everything when deleting the comments fails', async () => {
    const linkId = await shareLink(JOB_PAGE, BACKEND);
    await groupLinks.addComment(draft(BACKEND, linkId));
    const failing = new MongoGroupLinkRepository(
      connection,
      new FailingCommentDeletions(connection),
    );
    const session = await connection.startSession();

    try {
      await expect(
        session.withTransaction(() => failing.deleteByGroup(BACKEND, session)),
      ).rejects.toThrow('Forced failure deleting comments');
    } finally {
      await session.endSession();
    }

    expect(await groupLinks.countByGroup(BACKEND)).toBe(1);
    expect(await commentsOf(BACKEND, linkId)).toBe(1);
  });
});

describe('the race between commenting and removing the link', () => {
  it('a) Comentar mientras se quita: the add commits first and the removal takes its comment', async () => {
    const linkId = await shareLink(JOB_PAGE, BACKEND);
    const pause = groupLinks.pauseNextInsert();

    // A: `$inc` sin confirmar, detenida antes del `insert`.
    const adding = groupLinks.addComment(draft(BACKEND, linkId));
    await pause.reached;

    // B: la retirada choca con A en el documento de la relación.
    const conflict = nextFailure('delete');
    const removing = groupLinks.removeWithComments(BACKEND, linkId);
    expect(codeOf(await conflict)).toBe('WriteConflict');

    // A inserta y confirma; B reintenta viendo el estado final y borra también el comentario.
    pause.release();
    const added = await adding;
    expect(await removing).toBe(true);

    expect(added?.comment).toMatchObject({ groupId: BACKEND, linkId });
    expect(await groupLinks.find(BACKEND, linkId)).toBeNull();
    expect(await commentsOf(BACKEND, linkId)).toBe(0);
  });

  it('b) Quitar mientras se comenta: the removal commits first and the add answers null', async () => {
    const linkId = await shareLink(JOB_PAGE, BACKEND);

    // B: borra la relación y sus comentarios sin confirmar, como `removeWithComments` a mitad.
    const session = await connection.startSession();
    session.startTransaction();
    await connection.collection(GROUP_LINKS_COLLECTION).deleteOne(
      {
        groupId: new mongoose.Types.ObjectId(BACKEND),
        linkId: new mongoose.Types.ObjectId(linkId),
      },
      { session },
    );
    await comments.deleteByRelation(BACKEND, linkId, session);

    // A: el `$inc` choca con B.
    const conflict = nextFailure('findAndModify');
    const adding = groupLinks.addComment(draft(BACKEND, linkId));
    expect(codeOf(await conflict)).toBe('WriteConflict');

    // B confirma; el reintento de A ya no encuentra la relación.
    await session.commitTransaction();
    await session.endSession();

    expect(await adding).toBeNull();
    expect(await commentsOf(BACKEND, linkId)).toBe(0);
    expect(await groupLinks.find(BACKEND, linkId)).toBeNull();
  });
});
