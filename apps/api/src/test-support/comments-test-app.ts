import type { GroupDetail, SaveLinkResponse } from '@linkvault/shared';
import mongoose from 'mongoose';
import { expect } from 'vitest';
import { GROUP_LINK_COMMENTS_COLLECTION } from '../modules/links/infrastructure/group-link-comment.schemas';
import { GROUP_LINKS_COLLECTION } from '../modules/links/infrastructure/link.schemas';
import {
  createLinksTestApp,
  type InjectResponse,
  type LinksTestApp,
  type LinksTestAppOptions,
  type TestMember,
} from './links-test-app';

// Escenario común de las pruebas HTTP de comentarios y notas (grupo 5 de group-comments): la app completa de
// `links-test-app`, un grupo de Ana (propietaria) con Beto y Carla como miembros, un extraño fuera y un link que Ana
// compartió en el grupo. La URI del replica set la pasa quien llama, como en `links-test-app`.

export interface CommentsTestApp {
  readonly http: LinksTestApp;
  readonly ana: TestMember;
  readonly beto: TestMember;
  readonly carla: TestMember;
  readonly stranger: TestMember;
  readonly group: GroupDetail;
  /** Guarda una URL en el grupo (o en la lista privada) y devuelve la respuesta ya comprobada. */
  save(
    member: TestMember,
    url: string,
    options?: { groupId?: string; note?: string },
  ): Promise<SaveLinkResponse>;
  /** Link nuevo compartido por Ana en el grupo. */
  newLink(): Promise<string>;
  post(
    member: TestMember,
    linkId: string,
    text: unknown,
    groupId?: string,
  ): Promise<InjectResponse>;
  thread(
    member: TestMember,
    linkId: string,
    query?: string,
    groupId?: string,
  ): Promise<InjectResponse>;
  remove(
    member: TestMember,
    linkId: string,
    commentId: string,
    groupId?: string,
  ): Promise<InjectResponse>;
  /** Comentarios guardados de ese link en ese grupo, contados en la colección. */
  storedComments(linkId: string, groupId?: string): Promise<number>;
  /** Contadores guardados en la relación. */
  counters(
    linkId: string,
    groupId?: string,
  ): Promise<{ commentCount?: number; commentsRevision?: number } | null>;
  close(): Promise<void>;
}

let urls = 0;

export async function createCommentsTestApp(
  name: string,
  mongoUri: string,
  options: LinksTestAppOptions = {},
): Promise<CommentsTestApp> {
  const http = await createLinksTestApp(name, mongoUri, options);
  const ana = await http.authenticated('Ana');
  const beto = await http.authenticated('Beto');
  const carla = await http.authenticated('Carla');
  const stranger = await http.authenticated('Extraño');
  const group = await http.createGroup(ana, 'Backend Bolivia');
  await http.join(beto, group);
  await http.join(carla, group);

  const save: CommentsTestApp['save'] = async (member, url, saveOptions = {}) => {
    const response = await http.request('POST', '/api/links', {
      authorization: member.authorization,
      body: {
        url,
        ...(saveOptions.groupId === undefined
          ? {}
          : { groupId: saveOptions.groupId }),
        ...(saveOptions.note === undefined ? {} : { note: saveOptions.note }),
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json<SaveLinkResponse>();
  };

  const relationFilter = (linkId: string, groupId: string) => ({
    groupId: new mongoose.Types.ObjectId(groupId),
    linkId: new mongoose.Types.ObjectId(linkId),
  });

  return {
    http,
    ana,
    beto,
    carla,
    stranger,
    group,
    save,
    async newLink() {
      urls += 1;
      const saved = await save(
        ana,
        `https://empresa.example/careers/comments-${name}-${urls}`,
        { groupId: group.id },
      );
      return saved.link.id;
    },
    post: (member, linkId, text, groupId = group.id) =>
      http.request('POST', `/api/groups/${groupId}/links/${linkId}/comments`, {
        authorization: member.authorization,
        body: { text },
      }),
    thread: (member, linkId, query = '', groupId = group.id) =>
      http.request(
        'GET',
        `/api/groups/${groupId}/links/${linkId}/comments${query}`,
        { authorization: member.authorization },
      ),
    remove: (member, linkId, commentId, groupId = group.id) =>
      http.request(
        'DELETE',
        `/api/groups/${groupId}/links/${linkId}/comments/${commentId}`,
        { authorization: member.authorization },
      ),
    storedComments: (linkId, groupId = group.id) =>
      http.connection
        .collection(GROUP_LINK_COMMENTS_COLLECTION)
        .countDocuments(relationFilter(linkId, groupId)),
    counters: async (linkId, groupId = group.id) => {
      const relation = await http.connection
        .collection(GROUP_LINKS_COLLECTION)
        .findOne(relationFilter(linkId, groupId));
      return relation === null
        ? null
        : {
            commentCount: relation['commentCount'] as number | undefined,
            commentsRevision: relation['commentsRevision'] as
              | number
              | undefined,
          };
    },
    close: () => http.close(),
  };
}
