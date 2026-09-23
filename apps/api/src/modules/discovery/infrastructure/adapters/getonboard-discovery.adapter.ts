import type { DiscoveryHit } from '@linkvault/shared';
import type {
  DiscoveryBoardAdapter,
  DiscoveryBoardResult,
  DiscoverySearchParams,
} from '../../domain/discovery-board';

/** Base anclada en D3 / ADR-043. */
export const GETONBOARD_API_BASE = 'https://www.getonbrd.com';
export const GETONBOARD_SEARCH_PATH = '/api/v0/search/jobs';

/**
 * Lo que el adapter necesita de `fetch`. Se inyecta para que los tests no toquen la red
 * (mismo patrón que `HttpPageFetcher` del worker).
 */
export type DiscoveryHttpFetch = (
  url: string,
  init: {
    readonly method: 'GET';
    readonly headers: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
  },
) => Promise<Response>;

export interface GetonboardDiscoveryAdapterOptions {
  readonly httpFetch: DiscoveryHttpFetch;
  readonly userAgent: string;
  readonly baseUrl?: string;
}

/**
 * Adapter Get on Board: `GET /api/v0/search/jobs` (API pública, sin auth).
 * 429/5xx/timeout → degraded, sin reintentos agresivos.
 */
export class GetonboardDiscoveryAdapter implements DiscoveryBoardAdapter {
  readonly id = 'getonboard' as const;
  private readonly baseUrl: string;

  constructor(private readonly options: GetonboardDiscoveryAdapterOptions) {
    this.baseUrl = options.baseUrl ?? GETONBOARD_API_BASE;
  }

  async search(params: DiscoverySearchParams): Promise<DiscoveryBoardResult> {
    const url = new URL(GETONBOARD_SEARCH_PATH, this.baseUrl);
    const q = params.q.trim();
    if (q.length > 0) {
      url.searchParams.set('query', q);
    }
    url.searchParams.set('page', String(params.page));
    url.searchParams.set('per_page', String(params.pageSize));
    url.searchParams.set('lang', params.lang);

    let response: Response;
    try {
      response = await this.options.httpFetch(url.toString(), {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': this.options.userAgent,
        },
        signal: params.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        return { kind: 'degraded', reason: 'timeout' };
      }
      return { kind: 'degraded', reason: 'network' };
    }

    if (response.status === 429) {
      return { kind: 'degraded', reason: 'upstream_429' };
    }
    if (response.status >= 500) {
      return { kind: 'degraded', reason: 'upstream_5xx' };
    }
    if (!response.ok) {
      return { kind: 'degraded', reason: 'network' };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: 'degraded', reason: 'network' };
    }

    return { kind: 'hits', hits: mapGetonboardHits(body, params.pageSize) };
  }
}

function mapGetonboardHits(body: unknown, pageSize: number): DiscoveryHit[] {
  if (body === null || typeof body !== 'object') {
    return [];
  }
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [];
  }
  const hits: DiscoveryHit[] = [];
  for (const item of data) {
    if (hits.length >= pageSize) {
      break;
    }
    const hit = mapOne(item);
    if (hit !== null) {
      hits.push(hit);
    }
  }
  return hits;
}

function mapOne(item: unknown): DiscoveryHit | null {
  if (item === null || typeof item !== 'object') {
    return null;
  }
  const record = item as {
    attributes?: Record<string, unknown>;
    relationships?: { company?: { data?: { attributes?: { name?: unknown } } } };
  };
  const attrs = record.attributes;
  if (attrs === undefined) {
    return null;
  }
  const title = stringField(attrs['title']);
  const slug = stringField(attrs['slug']);
  if (title === null || slug === null) {
    return null;
  }
  const publicUrl = stringField(attrs['public_url']);
  const url =
    publicUrl ?? `https://www.getonbrd.com/jobs/${slug.toLowerCase()}`;
  const company =
    stringField(attrs['company_name']) ??
    stringField(
      record.relationships?.company?.data?.attributes?.name,
    ) ??
    undefined;
  const location = modalityLocation(attrs) ?? undefined;
  const salaryText = salaryOf(attrs) ?? undefined;

  return {
    board: 'getonboard',
    title,
    url,
    externalJobId: slug.toLowerCase(),
    ...(company === undefined ? {} : { company }),
    ...(location === undefined ? {} : { location }),
    ...(salaryText === undefined ? {} : { salaryText }),
  };
}

function modalityLocation(attrs: Record<string, unknown>): string | null {
  const modality = stringField(attrs['modality']);
  if (modality !== null) {
    return modality;
  }
  if (attrs['remote'] === true) {
    return 'Remote';
  }
  return stringField(attrs['cities_text']);
}

function salaryOf(attrs: Record<string, unknown>): string | null {
  const min = numberField(attrs['min_salary']);
  const max = numberField(attrs['max_salary']);
  const currency = stringField(attrs['currency'])?.toUpperCase() ?? 'USD';
  if (min === null && max === null) {
    return null;
  }
  if (min !== null && max !== null) {
    return `${currency} ${min}–${max}`;
  }
  if (min !== null) {
    return `${currency} ${min}+`;
  }
  return `${currency} ≤${max}`;
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}
