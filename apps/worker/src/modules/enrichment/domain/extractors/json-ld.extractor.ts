import {
  PREVIEW_SKILLS_MAX,
  type JobPreview,
  type JobSalary,
  type SalaryPeriod,
} from '@linkvault/shared';
import { scrubContactDetails } from '../contact-scrub';
import type { PageContent } from '../page-content';
import { draftFrom } from '../preview-draft';
import { toPlainText, truncateSummary } from '../plain-text';
import {
  NOTHING_EXTRACTED,
  type ExtractionContext,
  type ExtractionOutcome,
  type ExtractorStrategy,
} from './extractor';

// Primera etapa de la cadena (D3): el `JobPosting` de schema.org. Es la más fiable porque no la interpretamos
// nosotros: es el propio sitio quien declara qué es cada dato. Trabajopolis lo publica completo, y es lo único que
// hace falta para su preview.
//
// El bloque puede venir suelto, dentro de un array o dentro de un `@graph`, que es como lo publican los gestores de
// contenido que meten varias entidades en la misma página. Los tres casos se buscan igual.

export const JSON_LD_EXTRACTOR_ID = 'json-ld';

/** Profundidad máxima de la búsqueda: un `@graph` dentro de un `@graph` dentro de un `@graph` ya es una página rota. */
const MAX_DEPTH = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  // Hay sitios que publican los importes como cadena: "45000".
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Primer elemento de lo que puede ser un valor suelto o una lista: schema.org admite las dos formas en casi todo. */
function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

/** `@type` puede ser una cadena o una lista, y llegar como URL completa (`http://schema.org/JobPosting`). */
function isType(node: Record<string, unknown>, type: string): boolean {
  const declared = node['@type'];
  const values = Array.isArray(declared) ? declared : [declared];
  return values.some(
    (value) => typeof value === 'string' && value.split(/[/#]/).pop() === type,
  );
}

/** El `JobPosting` de la página, esté suelto, en una lista o dentro de un `@graph`. */
export function findJobPosting(
  blocks: readonly unknown[],
): Record<string, unknown> | null {
  const walk = (
    node: unknown,
    depth: number,
  ): Record<string, unknown> | null => {
    if (depth > MAX_DEPTH) return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item, depth + 1);
        if (found !== null) return found;
      }
      return null;
    }
    if (!isRecord(node)) return null;
    if (isType(node, 'JobPosting')) return node;
    return walk(node['@graph'], depth + 1);
  };

  return walk(blocks, 0);
}

/** Nombre de la organización que contrata: puede venir como objeto, como lista o como texto suelto. */
function companyOf(posting: Record<string, unknown>): string | null {
  const organization = first(posting['hiringOrganization']);
  if (isRecord(organization)) return asString(organization['name']);
  return asString(organization);
}

/** Ubicación legible a partir de la dirección postal del `Place`. */
function locationOf(posting: Record<string, unknown>): string | null {
  const place = first(posting['jobLocation']);
  if (!isRecord(place)) return asString(place);
  const address = first(place['address']);
  if (!isRecord(address)) return asString(address);
  const parts = [
    asString(address['addressLocality']),
    asString(address['addressRegion']),
    asString(address['addressCountry']),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(', ');
}

/** `TELECOMMUTE` es como schema.org dice "remoto"; el resto de modalidades no las declara. */
function modalityOf(
  posting: Record<string, unknown>,
): JobPreview['modality'] | null {
  const type = first(posting['jobLocationType']);
  return asString(type)?.toUpperCase() === 'TELECOMMUTE' ? 'remote' : null;
}

const SALARY_PERIODS: Readonly<Record<string, SalaryPeriod>> = {
  HOUR: 'hour',
  MONTH: 'month',
  YEAR: 'year',
};

/** `baseSalary` es un `MonetaryAmount`: un valor fijo o un rango, con su moneda y su unidad de tiempo. */
function salaryOf(posting: Record<string, unknown>): JobSalary | null {
  const base = first(posting['baseSalary']);
  if (!isRecord(base)) return null;
  const amount = first(base['value']);
  const fields = isRecord(amount) ? amount : {};

  const exact = asNumber(fields['value']);
  const min = asNumber(fields['minValue']) ?? exact;
  const max = asNumber(fields['maxValue']) ?? exact;
  if (min === null && max === null) return null;

  const unit = asString(fields['unitText'])?.toUpperCase() ?? '';
  return {
    min,
    max,
    currency: asString(base['currency']) ?? asString(fields['currency']),
    // Una unidad que no sabemos traducir (`DAY`, `WEEK`) se dice como lo que es: no la sabemos.
    period: SALARY_PERIODS[unit] ?? null,
  };
}

/** Día de una fecha ISO con hora: lo que publica una bolsa es un día, no un instante. */
function dateOf(value: unknown): string | null {
  const text = asString(value);
  return text === null ? null : (/^\d{4}-\d{2}-\d{2}/.exec(text)?.[0] ?? null);
}

/**
 * `skills` solo se lee cuando viene como lista de nombres. Cuando es un párrafo suelto —que es lo habitual— no se
 * parte por comas: inventaríamos habilidades que el sitio no declaró, y para eso está la etapa de IA.
 */
function skillsOf(
  posting: Record<string, unknown>,
): JobPreview['skills'] | null {
  const declared = posting['skills'];
  if (!Array.isArray(declared)) return null;
  const names = declared
    .map((item) => (isRecord(item) ? asString(item['name']) : asString(item)))
    .filter((name): name is string => name !== null)
    .slice(0, PREVIEW_SKILLS_MAX);
  return names.length === 0
    ? null
    : names.map((name) => ({ name, required: true }));
}

/** La descripción llega con marcado dentro; el resumen sale de ella sin etiquetas y sin datos de contacto. */
function summaryOf(posting: Record<string, unknown>): string | null {
  const description = asString(posting['description']);
  if (description === null) return null;
  const summary = truncateSummary(
    scrubContactDetails(toPlainText(description)),
  );
  return summary === '' ? null : summary;
}

export class JsonLdExtractor implements ExtractorStrategy {
  readonly id = JSON_LD_EXTRACTOR_ID;

  supports(page: PageContent): boolean {
    return page.jsonLdBlocks.length > 0;
  }

  extract({ page }: ExtractionContext): Promise<ExtractionOutcome> {
    const posting = findJobPosting(page.jsonLdBlocks);
    if (posting === null) return Promise.resolve(NOTHING_EXTRACTED);

    return Promise.resolve({
      draft: draftFrom(this.id, {
        title: asString(posting['title']) ?? undefined,
        company: companyOf(posting) ?? undefined,
        location: locationOf(posting) ?? undefined,
        modality: modalityOf(posting) ?? undefined,
        salary: salaryOf(posting) ?? undefined,
        skills: skillsOf(posting) ?? undefined,
        summary: summaryOf(posting) ?? undefined,
        postedAt: dateOf(posting['datePosted']) ?? undefined,
        expiresAt: dateOf(posting['validThrough']) ?? undefined,
      }),
      // Que el sitio publique un `JobPosting` es la declaración más fiable que hay de que la página es una vacante:
      // con ella, la IA ya no tiene que pronunciarse y `not_a_job` queda descartado.
      isJobPosting: true,
    });
  }
}
