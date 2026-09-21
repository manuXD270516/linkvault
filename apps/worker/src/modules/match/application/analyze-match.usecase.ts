import {
  critiqueSuggestionsTask,
  matchCvTask,
  toCritiqueSuggestionsInput,
  type AiResult,
  type AiSuccess,
  type CritiqueSuggestionsOutput,
  type MatchCvInput,
  type MatchCvOutput,
  type RunContext,
  type RunTaskFn,
} from '@linkvault/ai';
import {
  matchReportSchema,
  type MatchRequestedPayload,
  type MatchReport,
} from '@linkvault/shared';
import { Logger } from '@nestjs/common';
import type { AnalysisRepository } from './ports/analysis-repository.port';
import type { AiContextReader } from './ports/ai-context-reader.port';
import type { Clock } from './ports/clock.port';
import type { CvTextReader } from './ports/cv-text-reader.port';
import type { JobReader } from './ports/job-reader.port';
import type { MatchAnalysis } from '../domain/analysis';
import { isRunningExpired } from '../domain/expiry';

// Ejecución del análisis de encaje (tareas 13.6–13.12, D3, D12-bis, ADR-030 §6–§7;
// bucle de juez cv-suggestions-review / ADR-031).
//
// Relee al empezar y abandona si ya terminó, venció o se borró. Lee el consentimiento **justo antes** de
// `runTask`. Los pasos se anotan best-effort: un fallo al guardar el paso no tumba el análisis.
// Tras un primer `match-cv` no degradado: como máximo una crítica y una revisión.

export type AnalyzeMatchResult =
  | { readonly kind: 'done' }
  | { readonly kind: 'degraded' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'abandoned' };

export interface AnalyzeMatchOptions {
  readonly timeoutMs: number;
  readonly maxAgeMs: number;
}

/** Proveedores locales conocidos: el CV no “sale” hacia ellos. */
const LOCAL_PROVIDER_IDS = new Set(['mock', 'ollama']);

/** Umbral del juez: a partir de aquí no se pide revisión. */
const JUDGE_ACCEPT_SCORE = 0.8;

/** Mejora mínima del score entero del informe para aceptar la revisión. */
const MIN_SCORE_IMPROVEMENT = 1;

interface JudgeCandidate {
  readonly report: MatchCvOutput;
  readonly providerId: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly judgeScore?: number;
  readonly judgeModel?: string;
  readonly wentExternal: boolean;
}

export class AnalyzeMatchUseCase {
  private readonly logger = new Logger(AnalyzeMatchUseCase.name);

  constructor(
    private readonly analyses: AnalysisRepository,
    private readonly cvText: CvTextReader,
    private readonly jobs: JobReader,
    private readonly aiContext: AiContextReader,
    private readonly runTask: RunTaskFn,
    private readonly clock: Clock,
    private readonly options: AnalyzeMatchOptions,
  ) {}

  async execute(payload: MatchRequestedPayload): Promise<AnalyzeMatchResult> {
    const analysis = await this.analyses.findById(payload.analysisId);
    if (analysis === null) {
      return { kind: 'abandoned' };
    }
    if (analysis.status === 'done' || analysis.status === 'failed') {
      return { kind: 'abandoned' };
    }
    if (
      isRunningExpired(analysis, this.options.maxAgeMs, this.clock.now())
    ) {
      return { kind: 'abandoned' };
    }

    await this.safeRecordStep(analysis.id, 'reading-job');

    const job = await this.jobs.read(payload.linkId);
    if (job === null) {
      return await this.markFailed(analysis);
    }

    await this.safeRecordStep(analysis.id, 'comparing-cv');

    const cv = await this.cvText.read(payload.cvId, payload.userId);
    if (cv.kind === 'missing' || cv.kind === 'unreadable') {
      return await this.markFailed(analysis);
    }

    // D3: consentimiento leído inmediatamente antes de elegir proveedor.
    const context = await this.aiContext.read(payload.userId);
    const input: MatchCvInput = {
      job: {
        title: job.title,
        text: job.text,
        skills: [...job.skills],
      },
      cv: { text: cv.text },
    };

    const signal = AbortSignal.timeout(this.options.timeoutMs);
    const runContext: RunContext = {
      userId: payload.userId,
      aiConsent: context.aiConsent,
      outputLanguage: context.outputLanguage,
      redactName: context.redactName,
      personName: context.personName,
      signal,
    };

    let aiResult: AiResult<MatchCvOutput>;
    try {
      aiResult = await this.runTask(matchCvTask, input, runContext);
    } catch (error) {
      // Plazo agotado: fallar el análisis. Cualquier otro error se propaga para que
      // `onJobFailed` (attempts: 1) deje el análisis en `failed` sin reintentar a ciegas.
      if (signal.aborted) {
        return await this.markFailed(analysis);
      }
      throw error;
    }

    if (signal.aborted) {
      return await this.markFailed(analysis);
    }

    if (aiResult.status !== 'success') {
      return await this.persistDegraded(
        analysis,
        job.previewVersion,
        aiResult,
      );
    }

    return await this.runJudgeLoop(
      analysis,
      job.previewVersion,
      input,
      runContext,
      signal,
      aiResult,
    );
  }

  /**
   * Deja el análisis en `failed` con `internal_error` al agotarse los intentos del job (attempts: 1) o si el
   * procesador revienta. Condicionado a `running` y plazo: no resucita ni sobrescribe.
   */
  async markRetriesExhausted(payload: MatchRequestedPayload): Promise<void> {
    const analysis = await this.analyses.findById(payload.analysisId);
    if (analysis === null || analysis.status !== 'running') {
      return;
    }
    if (isRunningExpired(analysis, this.options.maxAgeMs, this.clock.now())) {
      return;
    }
    await this.markFailed(analysis);
  }

  /**
   * Bucle MVP: máx. 1 crítica + 1 revisión. Informes degradados no entran aquí.
   * Fallo del juez / cuota a mitad → `done` con el mejor informe ya obtenido (sin `judgeScore` si no hubo crítica).
   */
  private async runJudgeLoop(
    analysis: MatchAnalysis,
    previewVersion: number,
    input: MatchCvInput,
    runContext: RunContext,
    signal: AbortSignal,
    first: AiSuccess<MatchCvOutput>,
  ): Promise<AnalyzeMatchResult> {
    await this.safeRecordStep(analysis.id, 'drafting-suggestions');

    let best: JudgeCandidate = {
      report: first.output,
      providerId: first.providerId,
      model: first.model,
      promptVersion: first.promptVersion,
      wentExternal: isExternalProvider(first.providerId),
    };

    await this.safeRecordStep(analysis.id, 'critiquing-suggestions');
    // TODO(task 3.1): publicar `analysis.step` (critiquing-suggestions) al canal Redis/SSE si existe el puerto.

    const critiqueCtx: RunContext = {
      ...runContext,
      // Soft-exclude en routing: si solo hay un elegible, se ignora y se reutiliza el generador.
      excludeProviderIds: [first.providerId],
    };

    let critiqueResult: AiResult<CritiqueSuggestionsOutput>;
    try {
      critiqueResult = await this.runTask(
        critiqueSuggestionsTask,
        toCritiqueSuggestionsInput(input.job, first.output),
        critiqueCtx,
      );
    } catch (error) {
      if (signal.aborted) {
        return await this.markFailed(analysis);
      }
      throw error;
    }

    if (signal.aborted) {
      return await this.markFailed(analysis);
    }

    if (critiqueResult.status !== 'success') {
      // Juez falló o cuota: guardar el informe del generador sin judgeScore.
      return await this.persistSuccess(analysis, previewVersion, best);
    }

    best = {
      ...best,
      judgeScore: critiqueResult.output.score,
      judgeModel: critiqueResult.model,
    };

    if (critiqueResult.output.score >= JUDGE_ACCEPT_SCORE) {
      return await this.persistSuccess(analysis, previewVersion, best);
    }

    await this.safeRecordStep(analysis.id, 'revising-suggestions');
    // TODO(task 3.1): publicar `analysis.step` (revising-suggestions) al canal Redis/SSE si existe el puerto.

    let revision: AiResult<MatchCvOutput>;
    try {
      revision = await this.runTask(matchCvTask, input, runContext);
    } catch (error) {
      if (signal.aborted) {
        return await this.markFailed(analysis);
      }
      throw error;
    }

    if (signal.aborted) {
      return await this.markFailed(analysis);
    }

    if (revision.status !== 'success') {
      // Cuota / fallo a mitad: conservar el mejor (r0 + judge).
      return await this.persistSuccess(analysis, previewVersion, best);
    }

    const improved =
      revision.output.score - first.output.score >= MIN_SCORE_IMPROVEMENT;
    if (!improved) {
      return await this.persistSuccess(analysis, previewVersion, best);
    }

    // Mejor informe de la revisión: sin judgeScore propio (máx. una crítica, de la iteración de r0).
    const revised: JudgeCandidate = {
      report: revision.output,
      providerId: revision.providerId,
      model: revision.model,
      promptVersion: revision.promptVersion,
      wentExternal:
        best.wentExternal || isExternalProvider(revision.providerId),
    };
    return await this.persistSuccess(
      analysis,
      previewVersion,
      pickBestCandidate(best, revised),
    );
  }

  private async persistSuccess(
    analysis: MatchAnalysis,
    previewVersion: number,
    candidate: JudgeCandidate,
  ): Promise<AnalyzeMatchResult> {
    const finishedAt = this.clock.now();
    const durationMs = Math.max(
      0,
      finishedAt.getTime() - analysis.requestedAt.getTime(),
    );

    const report = matchReportSchema.safeParse({
      ...candidate.report,
      degraded: false,
      ...(candidate.judgeScore !== undefined
        ? { judgeScore: candidate.judgeScore }
        : {}),
      ...(candidate.judgeModel !== undefined
        ? { judgeModel: candidate.judgeModel }
        : {}),
    });
    if (!report.success) {
      return await this.markFailed(analysis);
    }

    const written = await this.analyses.complete(analysis.id, {
      step: 'done',
      report: report.data,
      provider: candidate.providerId,
      model: candidate.model,
      promptVersion: candidate.promptVersion,
      previewVersion,
      degraded: false,
      consentRequired: false,
      wentExternal: candidate.wentExternal,
      finishedAt,
      durationMs,
    });
    if (!written) {
      return await this.afterUnwrittenComplete(analysis);
    }
    this.logger.debug(
      `analysis ${analysis.id}: done provider=${candidate.providerId} durationMs=${String(durationMs)}`,
    );
    return { kind: 'done' };
  }

  private async persistDegraded(
    analysis: MatchAnalysis,
    previewVersion: number,
    aiResult: AiResult<MatchCvOutput>,
  ): Promise<AnalyzeMatchResult> {
    const finishedAt = this.clock.now();
    const durationMs = Math.max(
      0,
      finishedAt.getTime() - analysis.requestedAt.getTime(),
    );

    if (aiResult.status === 'success') {
      return await this.markFailed(analysis);
    }

    const consentRequired = aiResult.reason === 'consent_required';
    if (aiResult.output === undefined) {
      return await this.markFailed(analysis);
    }
    // Un degradado con sugerencias no se guarda.
    if (aiResult.output.suggestions.length > 0) {
      return await this.markFailed(analysis);
    }

    const retryAt =
      aiResult.reason === 'quota_exceeded' &&
      aiResult.aiQuotaRetryAt !== undefined
        ? new Date(aiResult.aiQuotaRetryAt)
        : undefined;

    let reportPayload: MatchReport;
    try {
      reportPayload = matchReportSchema.parse({
        ...aiResult.output,
        degraded: true,
        degradedReason: aiResult.reason,
        ...(retryAt !== undefined
          ? { aiQuotaRetryAt: retryAt.toISOString() }
          : {}),
      });
    } catch {
      return await this.markFailed(analysis);
    }

    const written = await this.analyses.complete(analysis.id, {
      step: 'done-degraded',
      report: reportPayload,
      promptVersion: matchCvTask.promptVersion,
      previewVersion,
      degraded: true,
      degradedReason: aiResult.reason,
      ...(retryAt === undefined ? {} : { aiQuotaRetryAt: retryAt }),
      consentRequired,
      // Sin señal en AiResult de que hubo envío externo: la propiedad observable se sostiene no
      // reejecutando `runTask` en una reentrega (D12-bis / ADR-030 §6).
      wentExternal: false,
      finishedAt,
      durationMs,
    });
    if (!written) {
      return await this.afterUnwrittenComplete(analysis);
    }
    this.logger.debug(
      `analysis ${analysis.id}: degraded reason=${aiResult.reason} durationMs=${String(durationMs)}`,
    );
    return { kind: 'degraded' };
  }

  /** Completar no escribió: si sigue `running` es carrera perdida → fail; si no, abandonar. */
  private async afterUnwrittenComplete(
    analysis: MatchAnalysis,
  ): Promise<AnalyzeMatchResult> {
    const again = await this.analyses.findById(analysis.id);
    if (again !== null && again.status === 'running') {
      return await this.markFailed(analysis);
    }
    return { kind: 'abandoned' };
  }

  private async markFailed(analysis: MatchAnalysis): Promise<AnalyzeMatchResult> {
    const finishedAt = this.clock.now();
    const durationMs = Math.max(
      0,
      finishedAt.getTime() - analysis.requestedAt.getTime(),
    );
    await this.safeRecordStep(analysis.id, 'failed');
    await this.analyses.fail(analysis.id, {
      failureCode: 'internal_error',
      finishedAt,
      durationMs,
    });
    this.logger.warn(`analysis ${analysis.id}: failed with internal_error`);
    return { kind: 'failed' };
  }

  private async safeRecordStep(
    analysisId: string,
    step: Parameters<AnalysisRepository['recordStep']>[1],
  ): Promise<void> {
    try {
      await this.analyses.recordStep(analysisId, step);
      // TODO(task 3.1): publicar `analysis.step` al canal Redis/SSE cuando exista el puerto; no bloquear si no hay suscriptores.
    } catch (error) {
      this.logger.warn(
        `analysis ${analysisId}: recordStep(${step}) failed (${error instanceof Error ? error.name : 'unknown'})`,
      );
    }
  }
}

function isExternalProvider(providerId: string): boolean {
  return !LOCAL_PROVIDER_IDS.has(providerId);
}

/**
 * Mejor par: mayor `score` del informe; empate → mayor `judgeScore` (ausente cuenta como peor que cualquier score).
 */
function pickBestCandidate(
  a: JudgeCandidate,
  b: JudgeCandidate,
): JudgeCandidate {
  if (b.report.score !== a.report.score) {
    return b.report.score > a.report.score ? b : a;
  }
  const judgeA = a.judgeScore ?? Number.NEGATIVE_INFINITY;
  const judgeB = b.judgeScore ?? Number.NEGATIVE_INFINITY;
  return judgeB > judgeA ? b : a;
}
