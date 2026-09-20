import type { ProviderEligibility } from '@linkvault/ai';
import type {
  MatchDegradedReason,
  MatchReport,
} from '@linkvault/shared';
import {
  MATCH_REQUESTED_EVENT_TYPE,
  matchRequestedEvent,
} from '@linkvault/shared';
import type { OutboxEvent } from '../../../../infrastructure/outbox/outbox.port';
import type { TransactionSession } from '../../../../infrastructure/outbox/transaction-session';
import {
  createRunningAnalysis,
  type MatchAnalysis,
} from '../../domain/analysis';
import { readAnalysis } from '../../domain/expiry';
import { isCvId, isLinkId, isUserId } from '../../domain/identifier';
import type { MatchAiConsent } from '../ports/ai-consent.port';
import type {
  AnalysisRepository,
  CreateRunningAnalysisInput,
  QuotaCount,
  ReusableDegradedAnalysis,
} from '../ports/analysis-repository.port';
import type { MatchClock } from '../ports/clock.port';
import type { MatchCvReader, MatchCvSummary } from '../ports/cv-reader.port';
import type { MatchJobReader, MatchJobSummary } from '../ports/job-reader.port';
import type { MatchAnalysisSettings } from '../ports/match-settings.port';

// Dobles de los puertos de `match` para los tests de casos de uso (tarea 8.7). No son adaptadores de producción.
//
// La cuota se deriva del historial (ADR-030 §8): no hay token de límite ni operaciones que devuelvan intentos.

export class MovableMatchClock implements MatchClock {
  constructor(public current = new Date('2026-09-20T12:00:00.000Z')) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class InMemoryMatchCvReader implements MatchCvReader {
  private readonly byUser = new Map<string, MatchCvSummary[]>();
  /**
   * Lecturas del **texto** del CV en el almacén. El caso de uso de la API nunca debe abrirlas (el worker sí). Los
   * tests de degradado vigente comprueban que este contador sigue en cero.
   */
  textOpenCount = 0;

  seed(userId: string, cvs: readonly MatchCvSummary[]): void {
    this.byUser.set(userId, [...cvs]);
  }

  /** Simula abrir el texto del CV: el caso de uso de pedir análisis no debe llamarlo. */
  openText(_cvId: string): string {
    this.textOpenCount += 1;
    return 'cv-text-should-not-be-read-by-request';
  }

  defaultOf(userId: string): Promise<MatchCvSummary | null> {
    const found = (this.byUser.get(userId) ?? []).find((cv) => cv.isDefault);
    return Promise.resolve(found ?? null);
  }

  findOwned(cvId: string, userId: string): Promise<MatchCvSummary | null> {
    if (!isCvId(cvId) || !isUserId(userId)) {
      return Promise.resolve(null);
    }
    const found = (this.byUser.get(userId) ?? []).find((cv) => cv.id === cvId);
    return Promise.resolve(found ?? null);
  }
}

export class InMemoryMatchJobReader implements MatchJobReader {
  private readonly readable = new Map<string, Set<string>>();
  private readonly jobs = new Map<string, MatchJobSummary>();

  allow(userId: string, linkId: string): void {
    const set = this.readable.get(userId) ?? new Set<string>();
    set.add(linkId);
    this.readable.set(userId, set);
  }

  seed(job: MatchJobSummary): void {
    this.jobs.set(job.id, job);
  }

  canRead(userId: string, linkId: string): Promise<boolean> {
    if (!isUserId(userId) || !isLinkId(linkId)) {
      return Promise.resolve(false);
    }
    return Promise.resolve(this.readable.get(userId)?.has(linkId) === true);
  }

  summaryOf(linkId: string): Promise<MatchJobSummary | null> {
    if (!isLinkId(linkId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(this.jobs.get(linkId) ?? null);
  }
}

/**
 * Elegibilidad sustituible: con proveedor, sin proveedor o sin responder. No contacta a nadie.
 */
export class StubProviderEligibility implements ProviderEligibility {
  constructor(
    private result: Awaited<
      ReturnType<ProviderEligibility['hasEligibleProvider']>
    > = { status: 'ready', hasEligible: true, consentWouldEnable: false },
  ) {}

  setResult(
    result: Awaited<ReturnType<ProviderEligibility['hasEligibleProvider']>>,
  ): void {
    this.result = result;
  }

  hasEligibleProvider(
    _query: Parameters<ProviderEligibility['hasEligibleProvider']>[0],
  ): Promise<Awaited<ReturnType<ProviderEligibility['hasEligibleProvider']>>> {
    return Promise.resolve(this.result);
  }
}

/** Consentimiento efectivo sustituible para los tests de vigencia del degradado. */
export class StubMatchAiConsent implements MatchAiConsent {
  constructor(public externalProviders = false) {}

  externalProvidersOf(_userId: string): Promise<boolean> {
    return Promise.resolve(this.externalProviders);
  }
}

/**
 * Repositorio en memoria con las mismas reglas de lectura que el de Mongo: vencimiento solo al leer, cuota derivada,
 * y el evento de alta observable porque sale de la misma "transacción" lógica.
 */
export class InMemoryAnalysisRepository implements AnalysisRepository {
  private readonly documents = new Map<string, MatchAnalysis>();
  private readonly events: OutboxEvent[] = [];
  private sequence = 0;
  /** Con algo distinto de `undefined`, `createRunning` lanza ese error y no deja documento ni evento. */
  createFailure: Error | undefined;
  /** Con algo distinto de `undefined`, `countForQuota` lanza ese error (fallo abierto en el caso de uso). */
  countFailure: Error | undefined;

  nextId(): string {
    this.sequence += 1;
    return `66e9a0${String(this.sequence).padStart(18, '0')}`;
  }

  createRunning(input: CreateRunningAnalysisInput): Promise<MatchAnalysis> {
    if (this.createFailure !== undefined) {
      return Promise.reject(this.createFailure);
    }
    const analysis = createRunningAnalysis(input);
    this.documents.set(analysis.id, analysis);
    this.events.push(
      matchRequestedEvent({
        analysisId: analysis.id,
        userId: analysis.userId,
        linkId: analysis.linkId,
        cvId: analysis.cvId,
      }),
    );
    return Promise.resolve(analysis);
  }

  /** Siembra un análisis ya resuelto o en curso (tests de lectura y cuota). */
  seed(analysis: MatchAnalysis): void {
    this.documents.set(analysis.id, analysis);
  }

  appendedEvents(): readonly OutboxEvent[] {
    return this.events;
  }

  all(): readonly MatchAnalysis[] {
    return [...this.documents.values()];
  }

  findLatestResolved(
    userId: string,
    linkId: string,
    maxAgeMs: number,
    now: Date,
  ): Promise<MatchAnalysis | null> {
    if (!isUserId(userId) || !isLinkId(linkId)) {
      return Promise.resolve(null);
    }
    const candidates = [...this.documents.values()]
      .filter((a) => a.userId === userId && a.linkId === linkId)
      .map((a) => readAnalysis(a, maxAgeMs, now))
      .filter((a) => a.status === 'done' || a.status === 'failed');

    candidates.sort(
      (a, b) =>
        (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0),
    );
    return Promise.resolve(candidates[0] ?? null);
  }

  findRunning(
    userId: string,
    linkId: string,
    maxAgeMs: number,
    now: Date,
  ): Promise<MatchAnalysis | null> {
    if (!isUserId(userId) || !isLinkId(linkId)) {
      return Promise.resolve(null);
    }
    const candidates = [...this.documents.values()]
      .filter((a) => a.userId === userId && a.linkId === linkId)
      .map((a) => readAnalysis(a, maxAgeMs, now))
      .filter((a) => a.status === 'running');

    candidates.sort(
      (a, b) => b.requestedAt.getTime() - a.requestedAt.getTime(),
    );
    return Promise.resolve(candidates[0] ?? null);
  }

  findReusable(
    userId: string,
    linkId: string,
    cvId: string,
    previewVersion: number,
    promptVersion: string,
  ): Promise<MatchAnalysis | null> {
    const found = [...this.documents.values()]
      .filter(
        (a) =>
          a.userId === userId &&
          a.linkId === linkId &&
          a.cvId === cvId &&
          a.status === 'done' &&
          a.degraded !== true &&
          a.previewVersion === previewVersion &&
          a.promptVersion === promptVersion,
      )
      .sort(
        (a, b) =>
          (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0),
      );
    return Promise.resolve(found[0] ?? null);
  }

  findReusableDegraded(
    userId: string,
    linkId: string,
    cvId: string,
    previewVersion: number,
    promptVersion: string,
  ): Promise<ReusableDegradedAnalysis | null> {
    const found = [...this.documents.values()]
      .filter(
        (a) =>
          a.userId === userId &&
          a.linkId === linkId &&
          a.cvId === cvId &&
          a.status === 'done' &&
          a.degraded === true &&
          a.degradedReason !== undefined &&
          a.report !== undefined &&
          a.previewVersion === previewVersion &&
          a.promptVersion === promptVersion,
      )
      .sort(
        (a, b) =>
          (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0),
      );
    const top = found[0];
    if (
      top === undefined ||
      top.report === undefined ||
      top.degradedReason === undefined
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      analysis: top,
      degradedReason: top.degradedReason,
      ...(top.aiQuotaRetryAt === undefined
        ? {}
        : { aiQuotaRetryAt: top.aiQuotaRetryAt }),
      report: top.report,
    });
  }

  countForQuota(
    userId: string,
    windowMs: number,
    maxAgeMs: number,
    now: Date,
  ): Promise<QuotaCount> {
    if (this.countFailure !== undefined) {
      return Promise.reject(this.countFailure);
    }
    if (!isUserId(userId)) {
      return Promise.resolve({ count: 0 });
    }
    const windowStart = now.getTime() - windowMs;
    const counted: { at: Date; kind: 'finished' | 'running' }[] = [];

    for (const raw of this.documents.values()) {
      if (raw.userId !== userId) {
        continue;
      }
      const viewed = readAnalysis(raw, maxAgeMs, now);
      if (viewed.status === 'running') {
        counted.push({ at: viewed.requestedAt, kind: 'running' });
        continue;
      }
      if (
        viewed.status === 'done' &&
        viewed.degraded !== true &&
        viewed.finishedAt !== undefined &&
        viewed.finishedAt.getTime() >= windowStart
      ) {
        counted.push({ at: viewed.finishedAt, kind: 'finished' });
      }
    }

    if (counted.length === 0) {
      return Promise.resolve({ count: 0 });
    }
    counted.sort((a, b) => a.at.getTime() - b.at.getTime());
    const oldest = counted[0];
    return Promise.resolve({
      count: counted.length,
      oldest:
        oldest === undefined
          ? undefined
          : { kind: oldest.kind, at: oldest.at },
    });
  }

  removeByCv(
    userId: string,
    cvId: string,
    _session: TransactionSession,
  ): Promise<number> {
    if (!isUserId(userId) || !isCvId(cvId)) {
      return Promise.resolve(0);
    }
    let removed = 0;
    for (const [id, analysis] of this.documents) {
      if (analysis.userId === userId && analysis.cvId === cvId) {
        this.documents.delete(id);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }

  countByCv(userId: string): Promise<ReadonlyMap<string, number>> {
    const counts = new Map<string, number>();
    if (!isUserId(userId)) {
      return Promise.resolve(counts);
    }
    for (const analysis of this.documents.values()) {
      if (analysis.userId !== userId) {
        continue;
      }
      counts.set(analysis.cvId, (counts.get(analysis.cvId) ?? 0) + 1);
    }
    return Promise.resolve(counts);
  }
}

/** Ayuda de tests: construye un informe no degradado mínimo. */
export function sampleReport(
  overrides: Partial<MatchReport> = {},
): MatchReport {
  return {
    score: 70,
    matchedSkills: ['TypeScript'],
    missingSkills: [],
    suggestions: [],
    degraded: false,
    ...overrides,
  };
}

export function sampleDegradedReport(
  reason: MatchDegradedReason,
  aiQuotaRetryAt?: Date,
): MatchReport {
  return {
    score: 40,
    matchedSkills: [],
    missingSkills: [],
    suggestions: [],
    degraded: true,
    degradedReason: reason,
    ...(reason === 'quota_exceeded' && aiQuotaRetryAt !== undefined
      ? { aiQuotaRetryAt: aiQuotaRetryAt.toISOString() }
      : {}),
  };
}

/** Ajustes por defecto de los unitarios de casos de uso (alineados con `apiTestConfig`). */
export const TEST_MATCH_SETTINGS: MatchAnalysisSettings = {
  maxAgeMs: 120_000,
  quotaWindowMs: 86_400_000,
  analysesPerUser: 10,
  promptVersion: 'v1',
};

export { MATCH_REQUESTED_EVENT_TYPE };
