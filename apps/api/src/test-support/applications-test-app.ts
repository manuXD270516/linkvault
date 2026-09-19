import type {
  Application,
  ApplicationStatus,
  GroupDetail,
  GroupTrackersResponse,
  SaveLinkResponse,
  TrackLinkResponse,
} from '@linkvault/shared';
import { expect } from 'vitest';
import {
  APPLICATION_EVENT_MODEL_NAME,
  APPLICATION_MODEL_NAME,
} from '../modules/applications/infrastructure/application.schemas';
import {
  createLinksTestApp,
  type InjectResponse,
  type LinksTestApp,
  type TestMember,
} from './links-test-app';

// App completa de `api` para los tests de integración HTTP de `applications` (D12 de applications-tracking): la misma
// de `links` —`AppModule` real, base de datos propia, usuarios creados con `UsersFacade`— con los índices de
// `applications` construidos y atajos para guardar links, seguirlos y compartir su estado.

export interface ApplicationsTestApp extends LinksTestApp {
  /** Guarda la URL en el grupo o, sin grupo, en la lista privada. */
  save(
    member: TestMember,
    url: string,
    group?: GroupDetail,
  ): Promise<SaveLinkResponse>;
  /** `POST /api/applications` tal cual, sin comprobar la respuesta. */
  trackRaw(member: TestMember, body: unknown): Promise<InjectResponse>;
  /** Sigue un link y devuelve la postulación (`201`). */
  track(
    member: TestMember,
    linkId: string,
    status?: ApplicationStatus,
    extra?: Record<string, unknown>,
  ): Promise<TrackLinkResponse>;
  /** Activa o desactiva compartir (`200`). */
  share(
    member: TestMember,
    applicationId: string,
    visibility?: 'group' | 'private',
  ): Promise<Application>;
  /** `GET /api/applications` de esa persona, ya validado. */
  mine(member: TestMember, linkIds?: string[]): Promise<Application[]>;
  /** `GET /api/groups/:id/applications` tal cual. */
  trackersRaw(
    member: TestMember,
    groupId: string,
    linkIds: string[],
  ): Promise<InjectResponse>;
  /** Estados compartidos (`200`), como mapa `linkId` → `userId`s en orden. */
  trackers(
    member: TestMember,
    groupId: string,
    linkIds: string[],
  ): Promise<GroupTrackersResponse>;
}

export async function createApplicationsTestApp(
  name: string,
  mongoUri: string,
): Promise<ApplicationsTestApp> {
  const http = await createLinksTestApp(name, mongoUri);
  for (const model of [APPLICATION_MODEL_NAME, APPLICATION_EVENT_MODEL_NAME]) {
    await http.connection.model(model).init();
  }

  const save: ApplicationsTestApp['save'] = async (member, url, group) => {
    const response = await http.request('POST', '/api/links', {
      authorization: member.authorization,
      body: { url, ...(group === undefined ? {} : { groupId: group.id }) },
    });
    expect(response.statusCode).toBe(201);
    return response.json<SaveLinkResponse>();
  };

  const trackRaw: ApplicationsTestApp['trackRaw'] = (member, body) =>
    http.request('POST', '/api/applications', {
      authorization: member.authorization,
      body,
    });

  const track: ApplicationsTestApp['track'] = async (
    member,
    linkId,
    status = 'interested',
    extra = {},
  ) => {
    const response = await trackRaw(member, { linkId, status, ...extra });
    expect(response.statusCode).toBe(201);
    return response.json<TrackLinkResponse>();
  };

  const share: ApplicationsTestApp['share'] = async (
    member,
    applicationId,
    visibility = 'group',
  ) => {
    const response = await http.request(
      'PATCH',
      `/api/applications/${applicationId}`,
      { authorization: member.authorization, body: { visibility } },
    );
    expect(response.statusCode).toBe(200);
    return response.json<Application>();
  };

  const mine: ApplicationsTestApp['mine'] = async (member, linkIds) => {
    const response = await http.request(
      'GET',
      `/api/applications${linkIds === undefined ? '' : `?linkIds=${linkIds.join(',')}`}`,
      { authorization: member.authorization },
    );
    expect(response.statusCode).toBe(200);
    return response.json<{ items: Application[] }>().items;
  };

  const trackersRaw: ApplicationsTestApp['trackersRaw'] = (
    member,
    groupId,
    linkIds,
  ) =>
    http.request(
      'GET',
      `/api/groups/${groupId}/applications?linkIds=${linkIds.join(',')}`,
      { authorization: member.authorization },
    );

  const trackers: ApplicationsTestApp['trackers'] = async (
    member,
    groupId,
    linkIds,
  ) => {
    const response = await trackersRaw(member, groupId, linkIds);
    expect(response.statusCode).toBe(200);
    return response.json<GroupTrackersResponse>();
  };

  return {
    ...http,
    save,
    trackRaw,
    track,
    share,
    mine,
    trackersRaw,
    trackers,
  };
}

/** `userId`s que ven los miembros en la tarjeta de ese link, en orden; vacío si el link no sale. */
export function trackerIdsOf(
  response: GroupTrackersResponse,
  linkId: string,
): string[] {
  return (
    response.items
      .find((item) => item.linkId === linkId)
      ?.trackers.map((tracker) => tracker.userId) ?? []
  );
}
