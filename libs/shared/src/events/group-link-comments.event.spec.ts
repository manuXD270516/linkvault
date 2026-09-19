import { describe, expect, it } from 'vitest';
import {
  GROUP_LINK_COMMENTS_CHANGED_EVENT_TYPE,
  GROUP_LINK_COMMENTS_CHANNEL,
  GROUP_LINK_COMMENTS_EVENT_NAME,
  groupLinkCommentsChangedEvent,
  groupLinkCommentsChangedEventSchema,
  groupLinkCommentsChangedPayloadSchema,
  groupLinkCommentsMessage,
  groupLinkCommentsMessageSchema,
} from './group-link-comments.event';

// Contrato del aviso de comentarios (D9 de group-comments): el tramo de Redis lleva solo identificadores; el de SSE,
// el resumen con el texto.

const payload = {
  groupId: '66e9a0000000000000000001',
  linkId: '66e9a0000000000000000002',
  commentId: '66e9a0000000000000000003',
  change: 'created',
} as const;

const summary = {
  count: 1,
  revision: 3,
  sharedAt: '2026-09-19T10:00:00.000Z',
  latest: [
    {
      id: payload.commentId,
      author: { userId: '66e9a0000000000000000004', displayName: 'Beto' },
      authorLeft: false,
      text: 'Piden inglés C1',
      createdAt: '2026-09-19T11:00:00.000Z',
    },
  ],
};

describe('GroupLinkCommentsChanged.v1 over Redis', () => {
  it('names its channel and its versioned type', () => {
    expect(GROUP_LINK_COMMENTS_CHANNEL).toBe('events:group-link.comments');
    expect(groupLinkCommentsChangedEvent(payload)).toEqual({
      type: 'GroupLinkCommentsChanged.v1',
      payload,
    });
  });

  it('accepts both changes', () => {
    for (const change of ['created', 'deleted'] as const) {
      expect(
        groupLinkCommentsChangedEventSchema.safeParse({
          type: GROUP_LINK_COMMENTS_CHANGED_EVENT_TYPE,
          payload: { ...payload, change },
        }).success,
      ).toBe(true);
    }
  });

  it('carries only identifiers and the kind of change', () => {
    expect(Object.keys(groupLinkCommentsChangedPayloadSchema.shape)).toEqual([
      'groupId',
      'linkId',
      'commentId',
      'change',
    ]);
  });

  it('rejects the text and the author', () => {
    expect(
      groupLinkCommentsChangedPayloadSchema.safeParse({
        ...payload,
        text: 'Piden inglés C1',
      }).success,
    ).toBe(false);
    expect(
      groupLinkCommentsChangedPayloadSchema.safeParse({
        ...payload,
        authorId: '66e9a0000000000000000004',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown change and another event type', () => {
    expect(
      groupLinkCommentsChangedPayloadSchema.safeParse({
        ...payload,
        change: 'edited',
      }).success,
    ).toBe(false);
    expect(
      groupLinkCommentsChangedEventSchema.safeParse({
        type: 'GroupLinkCommentsChanged',
        payload,
      }).success,
    ).toBe(false);
  });
});

describe('group-link.comments over the events channel', () => {
  it('names the event once for the server and for the browser', () => {
    expect(GROUP_LINK_COMMENTS_EVENT_NAME).toBe('group-link.comments');
  });

  it('carries the updated summary with revision and sharedAt', () => {
    const message = groupLinkCommentsMessage(payload, summary);

    expect(groupLinkCommentsMessageSchema.parse(message)).toEqual({
      groupId: payload.groupId,
      linkId: payload.linkId,
      change: 'created',
      commentId: payload.commentId,
      comments: summary,
    });
  });

  it('rejects a summary without revision or sharedAt', () => {
    for (const field of ['revision', 'sharedAt']) {
      const comments: Record<string, unknown> = { ...summary };
      delete comments[field];
      expect(
        groupLinkCommentsMessageSchema.safeParse({
          ...groupLinkCommentsMessage(payload, summary),
          comments,
        }).success,
      ).toBe(false);
    }
  });
});
