import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GROUP_LINK_COMMENT_MODEL_NAME,
  GROUP_LINK_COMMENTS_COLLECTION,
  groupLinkCommentSchema,
  toCommentObjectId,
  type GroupLinkCommentDocument,
} from './group-link-comment.schemas';

// Schema de `group_link_comments` (tarea 2.2 de group-comments) contra el MongoMemoryReplSet del preset de
// @linkvault/testing.

let connection: Connection;

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), { dbName: `comments-${randomUUID()}` })
    .asPromise();
  connection.model<GroupLinkCommentDocument>(
    GROUP_LINK_COMMENT_MODEL_NAME,
    groupLinkCommentSchema,
  );
  await connection.model(GROUP_LINK_COMMENT_MODEL_NAME).init();
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('group_link_comments collection', () => {
  it('does not buffer commands and stores only its fields', async () => {
    expect(groupLinkCommentSchema.get('bufferCommands')).toBe(false);
    expect(groupLinkCommentSchema.get('strict')).toBe(true);
    const model = connection.model<GroupLinkCommentDocument>(
      GROUP_LINK_COMMENT_MODEL_NAME,
    );
    const created = await model.create({
      groupId: new mongoose.Types.ObjectId(),
      linkId: new mongoose.Types.ObjectId(),
      authorId: new mongoose.Types.ObjectId(),
      text: 'Piden inglés C1',
      createdAt: new Date('2026-09-19T10:00:00.000Z'),
      email: 'beto@example.com',
    } as never);
    const raw = await connection
      .collection(GROUP_LINK_COMMENTS_COLLECTION)
      .findOne({ _id: created._id });

    expect(Object.keys(raw ?? {}).sort()).toEqual([
      '_id',
      'authorId',
      'createdAt',
      'groupId',
      'linkId',
      'text',
    ]);
  });

  it('declares the one index for the thread, the summary and both deletions', async () => {
    const indexes = await connection
      .collection(GROUP_LINK_COMMENTS_COLLECTION)
      .indexes();

    expect(indexes.map((index) => index.key)).toEqual([
      { _id: 1 },
      { groupId: 1, linkId: 1, createdAt: -1, _id: -1 },
    ]);
  });

  it('turns a malformed comment id into null instead of a cast error', () => {
    expect(toCommentObjectId('no-es-un-id')).toBeNull();
    expect(toCommentObjectId('66e9a0000000000000000001')?.toHexString()).toBe(
      '66e9a0000000000000000001',
    );
  });
});
