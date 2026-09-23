import type { DiscoveryDegradeReason, DiscoveryHit } from '@linkvault/shared';
import type {
  DiscoveryBoardAdapter,
  DiscoveryBoardResult,
  DiscoverySearchParams,
} from '../../domain/discovery-board';
import type { DiscoveryHttpFetch } from './getonboard-discovery.adapter';

/** Dump JSON público (D3 / ADR-043). */
export const REMOTEOK_API_URL = 'https://remoteok.com/api';

export const REMOTEOK_DUMP_CACHE_KEY = 'discovery:remoteok:dump';
export const REMOTEOK_DUMP_STALE_KEY = 'discovery:remoteok:dump:stale';
export const REMOTEOK_DUMP_LOCK_KEY = 'discovery:remoteok:dump:lock';
export const REMOTEOK_EGRESS_KEY = 'discovery:egress:remoteok';

/** TTL fresco del dump (15 min). */
export const REMOTEOK_DUMP_TTL_SECONDS = 15 * 60;

/** TTL del last-good para servir stale cuando egress está cerrado. */
export const REMOTEOK_STALE_TTL_SECONDS = 24 * 60 * 60;

/** Lock single-flight al refrescar el dump. */
export const REMOTEOK_LOCK_TTL_MS = 10_000;

/** Egress global: 1 fetch dump / 60s (fail-closed). */
export const REMOTEOK_EGRESS_WINDOW_MS = 60_000;
export const REMOTEOK_EGRESS_LIMIT = 1;

/**
 * Cliente Redis mínimo del dump Remote OK (ioredis o doble de test).
 */
export interface RemoteokDumpRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<'OK'>;
  set(
    key: string,
    value: string,
    mode: 'PX',
    ms: number,
    condition: 'NX',
  ): Promise<'OK' | null>;
}

export interface RemoteokEgressLimiter {
  /** `true` si este proceso puede hacer el fetch upstream. Fail-closed → `false`. */
  tryAcquire(): Promise<boolean>;
}

export interface RemoteokDiscoveryAdapterOptions {
  readonly httpFetch: DiscoveryHttpFetch;
  readonly userAgent: string;
  readonly redis: RemoteokDumpRedis;
  readonly egress: RemoteokEgressLimiter;
  readonly apiUrl?: string;
  /** Espera breve al single-flight ajeno antes de leer cache. */
  readonly lockWaitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Adapter Remote OK: dump JSON + cache Redis 15m + single-flight + egress limiter.
 * Filtra/pagina en proceso. Egress fail-closed; stale si hay last-good.
 */
export class RemoteokDiscoveryAdapter implements DiscoveryBoardAdapter {
  readonly id = 'remoteok' as const;
  private readonly apiUrl: string;
  private readonly lockWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: RemoteokDiscoveryAdapterOptions) {
    this.apiUrl = options.apiUrl ?? REMOTEOK_API_URL;
    this.lockWaitMs = options.lockWaitMs ?? 250;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async search(params: DiscoverySearchParams): Promise<DiscoveryBoardResult> {
    const dump = await this.loadDump(params.signal);
    if (dump.kind === 'degraded') {
      return dump;
    }
    const jobs = parseRemoteokDump(dump.body);
    const filtered = filterJobs(jobs, params.q);
    const start = (params.page - 1) * params.pageSize;
    const page = filtered.slice(start, start + params.pageSize);
    return { kind: 'hits', hits: page.map(toHit) };
  }

  private async loadDump(
    signal: AbortSignal,
  ): Promise<
    | { kind: 'ok'; body: string }
    | { kind: 'degraded'; reason: DiscoveryDegradeReason }
  > {
    const fresh = await safeGet(this.options.redis, REMOTEOK_DUMP_CACHE_KEY);
    if (fresh !== null) {
      return { kind: 'ok', body: fresh };
    }

    const lock = await safeSetNx(
      this.options.redis,
      REMOTEOK_DUMP_LOCK_KEY,
      REMOTEOK_LOCK_TTL_MS,
    );
    if (!lock) {
      await this.sleep(this.lockWaitMs);
      const afterWait = await safeGet(
        this.options.redis,
        REMOTEOK_DUMP_CACHE_KEY,
      );
      if (afterWait !== null) {
        return { kind: 'ok', body: afterWait };
      }
      const staleAfterWait = await safeGet(
        this.options.redis,
        REMOTEOK_DUMP_STALE_KEY,
      );
      if (staleAfterWait !== null) {
        return { kind: 'ok', body: staleAfterWait };
      }
      return { kind: 'degraded', reason: 'network' };
    }

    const allowed = await this.options.egress.tryAcquire();
    if (!allowed) {
      const stale = await safeGet(this.options.redis, REMOTEOK_DUMP_STALE_KEY);
      if (stale !== null) {
        return { kind: 'ok', body: stale };
      }
      return { kind: 'degraded', reason: 'egress_limited' };
    }

    return this.fetchAndCache(signal);
  }

  private async fetchAndCache(
    signal: AbortSignal,
  ): Promise<
    | { kind: 'ok'; body: string }
    | { kind: 'degraded'; reason: DiscoveryDegradeReason }
  > {
    let response: Response;
    try {
      response = await this.options.httpFetch(this.apiUrl, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': this.options.userAgent,
        },
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        return { kind: 'degraded', reason: 'timeout' };
      }
      const stale = await safeGet(this.options.redis, REMOTEOK_DUMP_STALE_KEY);
      if (stale !== null) {
        return { kind: 'ok', body: stale };
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

    let body: string;
    try {
      body = await response.text();
    } catch {
      return { kind: 'degraded', reason: 'network' };
    }

    await safeSetEx(
      this.options.redis,
      REMOTEOK_DUMP_CACHE_KEY,
      body,
      REMOTEOK_DUMP_TTL_SECONDS,
    );
    await safeSetEx(
      this.options.redis,
      REMOTEOK_DUMP_STALE_KEY,
      body,
      REMOTEOK_STALE_TTL_SECONDS,
    );
    return { kind: 'ok', body };
  }
}

interface RemoteokJob {
  readonly id: string;
  readonly position: string;
  readonly company?: string;
  readonly location?: string;
  readonly slug?: string;
  readonly salaryMin?: number;
  readonly salaryMax?: number;
}

function parseRemoteokDump(body: string): RemoteokJob[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const jobs: RemoteokJob[] = [];
  for (const item of parsed) {
    if (item === null || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    // El 1er elemento suele ser metadata sin `id`/`position`.
    const id = stringOrNumberId(record['id']);
    const position =
      stringField(record['position']) ?? stringField(record['title']);
    if (id === null || position === null) {
      continue;
    }
    jobs.push({
      id,
      position,
      ...(stringField(record['company']) === null
        ? {}
        : { company: stringField(record['company']) ?? undefined }),
      ...(stringField(record['location']) === null
        ? {}
        : { location: stringField(record['location']) ?? undefined }),
      ...(stringField(record['slug']) === null
        ? {}
        : { slug: stringField(record['slug']) ?? undefined }),
      ...(numberField(record['salary_min']) === null
        ? {}
        : { salaryMin: numberField(record['salary_min']) ?? undefined }),
      ...(numberField(record['salary_max']) === null
        ? {}
        : { salaryMax: numberField(record['salary_max']) ?? undefined }),
    });
  }
  return jobs;
}

function filterJobs(jobs: readonly RemoteokJob[], q: string): RemoteokJob[] {
  const needle = q.trim().toLowerCase();
  if (needle.length === 0) {
    return [...jobs];
  }
  return jobs.filter(
    (job) =>
      job.position.toLowerCase().includes(needle) ||
      (job.company?.toLowerCase().includes(needle) ?? false) ||
      (job.location?.toLowerCase().includes(needle) ?? false),
  );
}

function toHit(job: RemoteokJob): DiscoveryHit {
  const slugTail = job.slug?.replace(new RegExp(`^${job.id}-?`), '')
    ?? slugify(job.position);
  const pathSlug =
    slugTail.length > 0 ? `${job.id}-${slugTail}` : job.id;
  const salaryText = salaryTextOf(job);
  return {
    board: 'remoteok',
    title: job.position,
    url: `https://remoteok.com/remote-jobs/${pathSlug}`,
    externalJobId: job.id,
    ...(job.company === undefined ? {} : { company: job.company }),
    ...(job.location === undefined ? {} : { location: job.location }),
    ...(salaryText === undefined ? {} : { salaryText }),
  };
}

function salaryTextOf(job: RemoteokJob): string | undefined {
  if (job.salaryMin === undefined && job.salaryMax === undefined) {
    return undefined;
  }
  if (job.salaryMin !== undefined && job.salaryMax !== undefined) {
    return `USD ${job.salaryMin}–${job.salaryMax}`;
  }
  if (job.salaryMin !== undefined) {
    return `USD ${job.salaryMin}+`;
  }
  return `USD ≤${job.salaryMax}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNumberId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

async function safeGet(
  redis: RemoteokDumpRedis,
  key: string,
): Promise<string | null> {
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

async function safeSetEx(
  redis: RemoteokDumpRedis,
  key: string,
  value: string,
  seconds: number,
): Promise<void> {
  try {
    await redis.set(key, value, 'EX', seconds);
  } catch {
    // Cache best-effort: el dump ya está en memoria para esta petición.
  }
}

async function safeSetNx(
  redis: RemoteokDumpRedis,
  key: string,
  ttlMs: number,
): Promise<boolean> {
  try {
    const result = await redis.set(key, '1', 'PX', ttlMs, 'NX');
    return result === 'OK';
  } catch {
    // Sin lock: intentamos fetch (egress seguirá limitando).
    return true;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}
