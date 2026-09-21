import {
  buildRoadmapFromCatalogOnly,
  buildRoadmapTask,
  type BuildRoadmapInput,
  type RunContext,
  type RunTaskFn,
} from '@linkvault/ai';
import {
  BUILD_ROADMAP_TITLE_MAX_LENGTH,
  type RoadmapRequestedPayload,
} from '@linkvault/shared';
import { Logger } from '@nestjs/common';
import type { AnalysisRepository } from './ports/analysis-repository.port';
import type { AiContextReader } from './ports/ai-context-reader.port';
import type { Clock } from './ports/clock.port';
import type { JobReader } from './ports/job-reader.port';
import type { RoadmapRepository } from './ports/roadmap-repository.port';

// Ejecución de `build-roadmap` (study-roadmap 2.3): claim → consent → catálogo o runTask → ready/failed.
// No regenera si el claim ya está listo/fallido. Duplicate claim → no LLM.

export type BuildRoadmapResult =
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'abandoned' };

export interface BuildRoadmapOptions {
  readonly timeoutMs: number;
}

export class BuildRoadmapUseCase {
  private readonly logger = new Logger(BuildRoadmapUseCase.name);

  constructor(
    private readonly analyses: AnalysisRepository,
    private readonly roadmaps: RoadmapRepository,
    private readonly jobs: JobReader,
    private readonly aiContext: AiContextReader,
    private readonly runTask: RunTaskFn,
    private readonly clock: Clock,
    private readonly options: BuildRoadmapOptions,
  ) {}

  async execute(payload: RoadmapRequestedPayload): Promise<BuildRoadmapResult> {
    const analysis = await this.analyses.findById(payload.analysisId);
    if (analysis === null || analysis.userId !== payload.userId) {
      return { kind: 'abandoned' };
    }
    if (
      analysis.status !== 'done' ||
      analysis.report === undefined ||
      analysis.report.degraded ||
      analysis.degraded === true ||
      analysis.report.missingSkills.length === 0
    ) {
      return { kind: 'abandoned' };
    }

    const claim = await this.roadmaps.claimOrGet({
      id: this.roadmaps.nextId(),
      analysisId: payload.analysisId,
      userId: payload.userId,
      createdAt: this.clock.now(),
    });

    if (claim.kind === 'lost' || claim.kind === 'already_done') {
      // Otro ganó el claim o ya terminó: no LLM.
      return { kind: 'abandoned' };
    }
    // `won` o `already_generating` (POST ya reclamó): solo un worker toma la ejecución.
    const began = await this.roadmaps.tryBeginBuild(
      payload.analysisId,
      this.clock.now(),
    );
    if (!began) {
      return { kind: 'abandoned' };
    }

    const job = await this.jobs.read(analysis.linkId);
    if (job === null) {
      await this.roadmaps.markFailed(payload.analysisId, this.clock.now());
      return { kind: 'failed' };
    }

    const input: BuildRoadmapInput = {
      missingSkills: [...analysis.report.missingSkills],
      job: {
        title: job.title.slice(0, BUILD_ROADMAP_TITLE_MAX_LENGTH) || 'Job',
        skills: job.skills.map((s) => ({
          name: s.name,
          importance: s.importance,
        })),
      },
    };

    const catalogOnly = buildRoadmapFromCatalogOnly(input);
    if (catalogOnly !== null) {
      const written = await this.roadmaps.markReady(
        payload.analysisId,
        catalogOnly.items,
        this.clock.now(),
      );
      return written ? { kind: 'ready' } : { kind: 'abandoned' };
    }

    // Re-leer consentimiento justo antes de runTask (design §5).
    const context = await this.aiContext.read(payload.userId);
    if (!context.aiConsent.externalProviders) {
      // Cadena solo external sin consent → failed honesto (mock/local pueden seguir;
      // runTask degradará si no hay elegibles; aquí cortamos el caso típico openrouter-only).
      // Si hay mock/ollama en cadena, runTask aún puede servir: dejamos que decida.
    }

    const signal = AbortSignal.timeout(this.options.timeoutMs);
    const runContext: RunContext = {
      userId: payload.userId,
      aiConsent: context.aiConsent,
      outputLanguage: context.outputLanguage,
      redactName: context.redactName,
      personName: context.personName,
      signal,
    };

    try {
      const result = await this.runTask(buildRoadmapTask, input, runContext);
      if (signal.aborted) {
        await this.roadmaps.markFailed(payload.analysisId, this.clock.now());
        return { kind: 'failed' };
      }
      if (result.status !== 'success') {
        // consent_required / quota / no_providers → failed, no ready.
        await this.roadmaps.markFailed(payload.analysisId, this.clock.now());
        this.logger.debug(
          `roadmap ${payload.analysisId}: failed aiStatus=${result.status}`,
        );
        return { kind: 'failed' };
      }
      const written = await this.roadmaps.markReady(
        payload.analysisId,
        result.output.items,
        this.clock.now(),
      );
      return written ? { kind: 'ready' } : { kind: 'abandoned' };
    } catch (error) {
      if (signal.aborted) {
        await this.roadmaps.markFailed(payload.analysisId, this.clock.now());
        return { kind: 'failed' };
      }
      this.logger.warn(
        `roadmap ${payload.analysisId}: build failed (${error instanceof Error ? error.name : 'unknown'})`,
      );
      await this.roadmaps.markFailed(payload.analysisId, this.clock.now());
      return { kind: 'failed' };
    }
  }

  async markRetriesExhausted(payload: RoadmapRequestedPayload): Promise<void> {
    const roadmap = await this.roadmaps.findByAnalysisId(payload.analysisId);
    if (roadmap === null || roadmap.status !== 'generating') {
      return;
    }
    await this.roadmaps.markFailed(payload.analysisId, this.clock.now());
  }
}
