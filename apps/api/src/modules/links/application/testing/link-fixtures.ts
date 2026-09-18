import { canonicalize } from '../../domain/canonicalizers/registry';
import {
  createJobLink,
  type JobLink,
  type NewJobLink,
} from '../../domain/job-link';
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

/** Instante en que se dan por leídos los previews de los fixtures. */
const EXTRACTED_AT = '2026-09-18T11:00:00.000Z';

/**
 * Vacante ya leída, con su procedencia por campo: `title` y `location` los sacó JSON-LD, `company` la corrigió una
 * persona —y el campo conserva lo que esa corrección desplazó— y `modality` la puso la IA. Es el caso que los tests de
 * la API necesitan para comprobar que el origen sale resuelto a un nombre visible y que lo manual se distingue.
 */
export function enrichedPreview(editedBy: string): Pick<
  JobLink,
  'preview' | 'previewSources'
> {
  return {
    preview: {
      title: 'Backend Engineer',
      company: 'Acme Bolivia',
      location: 'La Paz, Bolivia',
      modality: 'remote',
    },
    previewSources: {
      title: {
        value: 'Backend Engineer',
        source: 'auto',
        extractor: 'json-ld',
        at: EXTRACTED_AT,
      },
      location: {
        value: 'La Paz, Bolivia',
        source: 'auto',
        extractor: 'json-ld',
        at: EXTRACTED_AT,
      },
      modality: {
        value: 'remote',
        source: 'auto',
        extractor: 'ai:extract-job',
        at: EXTRACTED_AT,
      },
      company: {
        value: 'Acme Bolivia',
        source: 'manual',
        by: editedBy,
        at: EXTRACTED_AT,
        replaced: { value: 'ACME S.R.L.', extractor: 'metadata' },
      },
    },
  };
}
