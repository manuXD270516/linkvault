import { canonicalize } from '../../domain/canonicalizers/registry';
import { createJobLink, type NewJobLink } from '../../domain/job-link';
import { normalizeUrl, toDisplayUrl } from '../../domain/url';

// Ayudas para preparar tests de `links`: convierten una URL en el borrador que el caso de uso pasaría al repositorio, y
// dan identificadores con la forma de un ObjectId sin depender de Mongo.

/** Borrador de vacante a partir de una URL, con la misma normalización y canonicalización que el caso de uso. */
export function jobLinkDraft(
  url: string,
  options: { createdBy?: string; now?: Date } = {},
): NewJobLink {
  const normalized = normalizeUrl(url);
  if (normalized === null) {
    throw new Error(`The fixture url is not a valid link: ${url}`);
  }
  return createJobLink({
    normalizedUrl: normalized.normalizedUrl,
    urlHash: normalized.urlHash,
    canonicalization: canonicalize(normalized.normalizedUrl),
    displayUrl: toDisplayUrl(url),
    createdBy: options.createdBy ?? objectId(1),
    now: options.now ?? new Date('2026-09-17T10:00:00.000Z'),
  });
}

/** Identificador con la forma de un ObjectId a partir de un número: `000000000000000000000001`, … */
export function objectId(value: number): string {
  return value.toString(16).padStart(24, '0');
}
