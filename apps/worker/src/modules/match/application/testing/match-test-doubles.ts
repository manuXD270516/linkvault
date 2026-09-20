import {
  isMatchStepRegression,
  matchReportSchema,
  type MatchDegradedReason,
  type MatchReport,
  type MatchStep,
  type SkillImportance,
} from '@linkvault/shared';
import type {
  CompleteAnalysisInput,
  FailAnalysisInput,
  MatchAnalysis,
} from '../../domain/analysis';
import { isRunningExpired } from '../../domain/expiry';
import type { AnalysisRepository } from '../ports/analysis-repository.port';
import type {
  AiContextReader,
  MatchAiContext,
} from '../ports/ai-context-reader.port';
import type { Clock } from '../ports/clock.port';
import type { CvTextRead, CvTextReader } from '../ports/cv-text-reader.port';
import type {
  JobReader,
  MatchJobForAnalysis,
} from '../ports/job-reader.port';

// Dobles en memoria de los puertos de `match` (tarea 13.2). Sin Mongo ni Nest.

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

export class MovableClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date('2026-09-20T12:00:00.000Z')) {
    this.current = start;
  }

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(at: Date): void {
    this.current = at;
  }
}

export class InMemoryAnalysisRepository implements AnalysisRepository {
  readonly documents = new Map<string, MatchAnalysis>();
  maxAgeMs = 120_000;
  clock: Clock = new MovableClock();
  /** Si se define, `recordStep` lanza ese error. */
  recordStepError: Error | null = null;

  seed(analysis: MatchAnalysis): this {
    this.documents.set(analysis.id, { ...analysis });
    return this;
  }

  async findById(analysisId: string): Promise<MatchAnalysis | null> {
    if (!OBJECT_ID_HEX.test(analysisId)) {
      return null;
    }
    return this.documents.get(analysisId) ?? null;
  }

  async complete(
    analysisId: string,
    input: CompleteAnalysisInput,
  ): Promise<boolean> {
    const current = this.documents.get(analysisId);
    if (current === undefined || current.status !== 'running') {
      return false;
    }
    if (isRunningExpired(current, this.maxAgeMs, this.clock.now())) {
      return false;
    }
    this.documents.set(analysisId, {
      ...current,
      status: 'done',
      step: input.step,
      report: input.report,
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.model === undefined ? {} : { model: input.model }),
      promptVersion: input.promptVersion,
      previewVersion: input.previewVersion,
      degraded: input.degraded,
      ...(input.degradedReason === undefined
        ? {}
        : { degradedReason: input.degradedReason }),
      ...(input.aiQuotaRetryAt === undefined
        ? {}
        : { aiQuotaRetryAt: input.aiQuotaRetryAt }),
      consentRequired: input.consentRequired,
      wentExternal: input.wentExternal,
      finishedAt: input.finishedAt,
      durationMs: input.durationMs,
    });
    return true;
  }

  async fail(analysisId: string, input: FailAnalysisInput): Promise<boolean> {
    const current = this.documents.get(analysisId);
    if (current === undefined || current.status !== 'running') {
      return false;
    }
    if (isRunningExpired(current, this.maxAgeMs, this.clock.now())) {
      return false;
    }
    this.documents.set(analysisId, {
      ...current,
      status: 'failed',
      step: 'failed',
      failureCode: input.failureCode,
      finishedAt: input.finishedAt,
      durationMs: input.durationMs,
      report: undefined,
      degraded: undefined,
      degradedReason: undefined,
      aiQuotaRetryAt: undefined,
    });
    return true;
  }

  async recordStep(analysisId: string, step: MatchStep): Promise<boolean> {
    if (this.recordStepError !== null) {
      throw this.recordStepError;
    }
    const current = this.documents.get(analysisId);
    if (current === undefined || current.status !== 'running') {
      return false;
    }
    if (isRunningExpired(current, this.maxAgeMs, this.clock.now())) {
      return false;
    }
    if (isMatchStepRegression(current.step, step)) {
      return false;
    }
    this.documents.set(analysisId, { ...current, step });
    return true;
  }

  purge(analysisId: string): void {
    this.documents.delete(analysisId);
  }
}

export class InMemoryCvTextReader implements CvTextReader {
  private readonly byId = new Map<string, { userId: string; read: CvTextRead }>();

  with(
    cvId: string,
    userId: string,
    read: CvTextRead = { kind: 'ready', text: 'Experiencia con TypeScript.' },
  ): this {
    this.byId.set(cvId, { userId, read });
    return this;
  }

  async read(cvId: string, userId: string): Promise<CvTextRead> {
    const entry = this.byId.get(cvId);
    if (entry === undefined || entry.userId !== userId) {
      return { kind: 'missing' };
    }
    return entry.read;
  }
}

export class InMemoryJobReader implements JobReader {
  private readonly byId = new Map<string, MatchJobForAnalysis>();

  with(job: MatchJobForAnalysis): this {
    this.byId.set(job.id, job);
    return this;
  }

  async read(linkId: string): Promise<MatchJobForAnalysis | null> {
    return this.byId.get(linkId) ?? null;
  }
}

export class InMemoryAiContextReader implements AiContextReader {
  private readonly byUser = new Map<string, MatchAiContext>();
  private readonly defaultContext: MatchAiContext = {
    aiConsent: { externalProviders: false },
    outputLanguage: 'es',
    redactName: true,
    personName: '',
  };

  with(userId: string, context: Partial<MatchAiContext>): this {
    this.byUser.set(userId, {
      ...this.defaultContext,
      ...context,
      aiConsent: context.aiConsent ?? this.defaultContext.aiConsent,
    });
    return this;
  }

  async read(userId: string): Promise<MatchAiContext> {
    return this.byUser.get(userId) ?? this.defaultContext;
  }
}

export function sampleRunningAnalysis(
  overrides: Partial<MatchAnalysis> &
    Pick<MatchAnalysis, 'id' | 'userId' | 'linkId' | 'cvId'> ,
): MatchAnalysis {
  return {
    status: 'running',
    step: 'reading-job',
    previewVersion: 1,
    promptVersion: 'v1',
    consentRequired: false,
    wentExternal: false,
    requestedAt: new Date('2026-09-20T12:00:00.000Z'),
    ...overrides,
  };
}

export function sampleReport(
  overrides: Partial<MatchReport> = {},
): MatchReport {
  return matchReportSchema.parse({
    score: 70,
    matchedSkills: ['TypeScript'],
    missingSkills: [{ name: 'NestJS', importance: 'must' as SkillImportance }],
    suggestions: [
      {
        section: 'skills',
        after: 'Incluir NestJS.',
        reason: 'La vacante lo pide.',
        evidence: {
          jobRequirement: 'NestJS',
          importance: 'must',
          cvFragment: null,
        },
      },
    ],
    degraded: false,
    ...overrides,
  });
}

export function sampleDegradedReport(
  reason: MatchDegradedReason,
  aiQuotaRetryAt?: Date,
): MatchReport {
  return matchReportSchema.parse({
    score: 40,
    matchedSkills: ['TypeScript'],
    missingSkills: [{ name: 'NestJS', importance: 'must' }],
    suggestions: [],
    degraded: true,
    degradedReason: reason,
    ...(reason === 'quota_exceeded' && aiQuotaRetryAt !== undefined
      ? { aiQuotaRetryAt: aiQuotaRetryAt.toISOString() }
      : {}),
  });
}

export const ANALYSIS_ID = '66e9a0000000000000000b01';
export const USER_ID = '66e9a0000000000000000a01';
export const LINK_ID = '66e9a0000000000000000d01';
export const CV_ID = '66e9a0000000000000000c01';

export function sampleJob(
  overrides: Partial<MatchJobForAnalysis> = {},
): MatchJobForAnalysis {
  return {
    id: LINK_ID,
    previewVersion: 1,
    title: 'Backend Engineer',
    text: 'Buscamos alguien con TypeScript y NestJS.',
    skills: [
      { name: 'TypeScript', importance: 'must' },
      { name: 'NestJS', importance: 'must' },
    ],
    ...overrides,
  };
}
