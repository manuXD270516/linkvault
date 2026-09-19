import { linkCreatedEvent, type ShareOutcome } from '@linkvault/shared';
import { canonicalize } from '../domain/canonicalizers/registry';
import { InvalidUrl } from '../domain/errors';
import {
  asksForHistoryRescue,
  createJobLink,
  type JobLink,
  type NewJobLink,
} from '../domain/job-link';
import { isUrlTooLong } from '../domain/limits';
import { normalizeUrl, toDisplayUrl } from '../domain/url';
import type { GroupLinkRepository } from './ports/group-link-repository.port';
import type {
  JobLinkRepository,
  ResolvedJobLink,
} from './ports/job-link-repository.port';
import type { Outbox } from './ports/outbox.port';
import type { TransactionSession } from './ports/transaction-session';
import type { UserLinkRepository } from './ports/user-link-repository.port';

// Paso común de guardar un link, que comparten `save-link` y `import-links` (D3, D4 y D6 de job-links): la vacante, su
// relación con el destino y el evento del outbox se escriben en la misma transacción, o no se escribe nada. El evento
// se añade cuando la vacante es nueva: un link compartido por segunda vez no necesita enriquecerse otra vez. La
// excepción es el rescate por historial (D7 de paste-job-description): volver a guardar, con una URL nueva del mismo
// host, una vacante cuya `displayUrl` prohíbe `robots.txt` pide una lectura nueva en la misma transacción, como el
// reintento, para que la cadena del worker pruebe esa URL.

/** Puertos de escritura que necesita el paso. Se pasan juntos para que los dos casos de uso no repitan el cableado. */
export interface LinkWriters {
  readonly links: JobLinkRepository;
  readonly groupLinks: GroupLinkRepository;
  readonly userLinks: UserLinkRepository;
  readonly outbox: Outbox;
}

/** Resultado de guardar una URL en un destino. */
export interface SavedLink {
  readonly link: JobLink;
  /** `true` solo si la vacante no existía en LinkVault. */
  readonly created: boolean;
  /** Si la relación con el destino es nueva o ya estaba. */
  readonly shared: ShareOutcome;
  /** Quién la compartió primero en el grupo; en la lista privada, quien la guardó. */
  readonly sharedBy: string;
  readonly sharedAt: Date;
}

/**
 * Borrador de vacante a partir de la URL que escribió una persona. `null` si no es `http(s)`, no tiene host o pasa del
 * máximo: quien llama decide si eso es un `invalid_url` (guardar uno) o un `unrecognized` (importar muchos).
 */
export function draftFrom(
  url: string,
  userId: string,
  now: Date,
): NewJobLink | null {
  const displayUrl = toDisplayUrl(url);
  const normalized = isUrlTooLong(displayUrl) ? null : normalizeUrl(displayUrl);
  if (normalized === null) {
    return null;
  }
  return createJobLink({
    normalizedUrl: normalized.normalizedUrl,
    urlHash: normalized.urlHash,
    canonicalization: canonicalize(normalized.normalizedUrl),
    displayUrl,
    createdBy: userId,
    now,
  });
}

/** Igual que `draftFrom`, pero rechaza con `invalid_url` en vez de devolver `null`. */
export function requireDraft(
  url: string,
  userId: string,
  now: Date,
): NewJobLink {
  const draft = draftFrom(url, userId, now);
  if (draft === null) {
    throw new InvalidUrl();
  }
  return draft;
}

/**
 * Resuelve la vacante por su clave de dedupe y la comparte en el grupo o la guarda en la lista privada, todo en una
 * transacción. El trabajo puede repetirse entero si dos peticiones guardan la misma URL a la vez (D3), así que no tiene
 * efectos fuera de la sesión.
 */
export async function saveOneLink(
  writers: LinkWriters,
  params: {
    draft: NewJobLink;
    userId: string;
    groupId?: string;
    now: Date;
  },
): Promise<SavedLink> {
  const { groupId, userId, now } = params;
  return await writers.links.withResolvedLink(
    params.draft,
    async (resolved, session) => {
      const link = await requestRescueIfAsked(
        writers,
        resolved,
        params.draft.displayUrl,
        now,
        session,
      );
      const shared =
        groupId === undefined
          ? await saveInPrivateList(writers, { link, userId, now }, session)
          : await shareInGroup(writers, { link, userId, groupId, now }, session);
      if (resolved.created) {
        // Un evento por vacante creada (D6): el relay lo publicará y `link-enrichment` lo consumirá.
        await writers.outbox.append(
          linkCreatedEvent({
            linkId: link.id,
            previewVersion: link.previewVersion,
          }),
          session,
        );
      }
      return { link, created: resolved.created, ...shared };
    },
  );
}

/**
 * Pide una lectura nueva del link si volver a guardarlo con esta URL la merece (`asksForHistoryRescue`): sube la versión,
 * vuelve a `pending` y escribe `LinkCreated.v1` en el outbox, todo en la sesión del guardado. Si no, el link tal cual.
 */
async function requestRescueIfAsked(
  writers: LinkWriters,
  resolved: ResolvedJobLink,
  url: string,
  now: Date,
  session: TransactionSession,
): Promise<JobLink> {
  if (
    resolved.created ||
    !resolved.urlAdded ||
    !asksForHistoryRescue(resolved.link, url)
  ) {
    return resolved.link;
  }
  const requested = await writers.links.requestEnrichment(
    resolved.link.id,
    now,
    session,
  );
  if (requested === null) {
    return resolved.link;
  }
  await writers.outbox.append(
    linkCreatedEvent({
      linkId: requested.id,
      previewVersion: requested.previewVersion,
    }),
    session,
  );
  return requested;
}

async function shareInGroup(
  writers: LinkWriters,
  params: { link: JobLink; userId: string; groupId: string; now: Date },
  session: TransactionSession,
): Promise<Omit<SavedLink, 'link' | 'created'>> {
  const { relation, created } = await writers.groupLinks.share(
    {
      groupId: params.groupId,
      linkId: params.link.id,
      sharedBy: params.userId,
      sharedAt: params.now,
    },
    session,
  );
  return {
    shared: created ? 'created' : 'already_there',
    sharedBy: relation.sharedBy,
    sharedAt: relation.sharedAt,
  };
}

async function saveInPrivateList(
  writers: LinkWriters,
  params: { link: JobLink; userId: string; now: Date },
  session: TransactionSession,
): Promise<Omit<SavedLink, 'link' | 'created'>> {
  const { relation, created } = await writers.userLinks.save(
    { userId: params.userId, linkId: params.link.id, savedAt: params.now },
    session,
  );
  return {
    shared: created ? 'created' : 'already_there',
    sharedBy: relation.userId,
    sharedAt: relation.savedAt,
  };
}
