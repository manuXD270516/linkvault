import { matchCvTask, PROVIDER_ELIGIBILITY } from '@linkvault/ai';
import type { ProviderEligibility } from '@linkvault/ai';
import type { MatchReport } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { CvNotFound } from '../../cv/domain/errors';
import { LinkNotFound } from '../../links/domain/errors';
import type { MatchAnalysis } from '../domain/analysis';
import { isDegradedReasonCurrent } from '../domain/degraded-reason-vigencia';
import {
  CvNotReadable,
  CvNotReady,
  JobNotReady,
  NoCv,
  TooManyAnalysisAttempts,
} from '../domain/errors';
import {
  ANALYSIS_REPOSITORY,
  type AnalysisRepository,
  type QuotaCount,
} from './ports/analysis-repository.port';
import {
  MATCH_AI_CONSENT,
  type MatchAiConsent,
} from './ports/ai-consent.port';
import { MATCH_CLOCK, type MatchClock } from './ports/clock.port';
import {
  MATCH_CV_READER,
  type MatchCvReader,
  type MatchCvSummary,
} from './ports/cv-reader.port';
import {
  MATCH_JOB_READER,
  type MatchJobReader,
} from './ports/job-reader.port';
import {
  MATCH_ANALYSIS_SETTINGS,
  type MatchAnalysisSettings,
} from './ports/match-settings.port';

/**
 * Resultado de pedir un análisis. `accepted` → HTTP 202 (nuevo o el `running` ya en curso); `reused` → HTTP 200 (done
 * no degradado o degradado con motivo todavía vigente).
 */
export type RequestMatchAnalysisResult =
  | { readonly outcome: 'accepted'; readonly analysis: MatchAnalysis }
  | {
      readonly outcome: 'reused';
      readonly analysis: MatchAnalysis;
      readonly report: MatchReport;
    };

/**
 * `POST /api/links/:linkId/match` (specs `cv/match`): pide el análisis o reutiliza el que ya hay según las reglas de
 * repetición. La única escritura es `createRunning` (documento + outbox). No lee el texto del CV ni contacta a ningún
 * proveedor.
 */
@Injectable()
export class RequestMatchAnalysis {
  constructor(
    @Inject(MATCH_JOB_READER) private readonly jobs: MatchJobReader,
    @Inject(MATCH_CV_READER) private readonly cvs: MatchCvReader,
    @Inject(ANALYSIS_REPOSITORY) private readonly analyses: AnalysisRepository,
    @Inject(PROVIDER_ELIGIBILITY)
    private readonly eligibility: ProviderEligibility,
    @Inject(MATCH_AI_CONSENT) private readonly consent: MatchAiConsent,
    @Inject(MATCH_CLOCK) private readonly clock: MatchClock,
    @Inject(MATCH_ANALYSIS_SETTINGS)
    private readonly settings: MatchAnalysisSettings,
  ) {}

  async execute(
    userId: string,
    linkId: string,
    cvId?: string,
  ): Promise<RequestMatchAnalysisResult> {
    if (!(await this.jobs.canRead(userId, linkId))) {
      throw new LinkNotFound();
    }

    const cv = await this.resolveCv(userId, cvId);
    this.assertCvReady(cv);

    const job = await this.jobs.summaryOf(linkId);
    if (job === null) {
      // canRead pasó: el link debería existir. Sin ficha → misma puerta opaca.
      throw new LinkNotFound();
    }
    if (!isJobReady(job.title, job.description)) {
      throw new JobNotReady();
    }

    const now = this.clock.now();
    const { maxAgeMs, promptVersion } = this.settings;

    const running = await this.analyses.findRunning(
      userId,
      linkId,
      maxAgeMs,
      now,
    );
    if (running !== null && running.cvId === cv.id) {
      return { outcome: 'accepted', analysis: running };
    }

    const reusable = await this.analyses.findReusable(
      userId,
      linkId,
      cv.id,
      job.previewVersion,
      promptVersion,
    );
    if (reusable !== null && reusable.report !== undefined) {
      return {
        outcome: 'reused',
        analysis: reusable,
        report: reusable.report,
      };
    }

    const degraded = await this.analyses.findReusableDegraded(
      userId,
      linkId,
      cv.id,
      job.previewVersion,
      promptVersion,
    );
    if (degraded !== null) {
      const externalProviders = await this.consent.externalProvidersOf(userId);
      const eligibility = await this.eligibility.hasEligibleProvider({
        task: {
          requires: matchCvTask.requires,
          dataSensitivity: matchCvTask.dataSensitivity,
        },
        aiConsent: { externalProviders },
      });

      if (
        isDegradedReasonCurrent({
          degradedReason: degraded.degradedReason,
          ...(degraded.aiQuotaRetryAt === undefined
            ? {}
            : { aiQuotaRetryAt: degraded.aiQuotaRetryAt }),
          consent: { externalProviders },
          eligibility:
            eligibility.status === 'unavailable'
              ? { status: 'unavailable' }
              : {
                  status: 'ready',
                  hasEligible: eligibility.hasEligible,
                },
          now,
        })
      ) {
        return {
          outcome: 'reused',
          analysis: degraded.analysis,
          report: degraded.report,
        };
      }
    }

    await this.assertWithinQuota(userId, now);

    const analysis = await this.analyses.createRunning({
      id: this.analyses.nextId(),
      userId,
      linkId,
      cvId: cv.id,
      previewVersion: job.previewVersion,
      promptVersion,
      requestedAt: now,
    });
    return { outcome: 'accepted', analysis };
  }

  private async resolveCv(
    userId: string,
    cvId: string | undefined,
  ): Promise<MatchCvSummary> {
    if (cvId === undefined) {
      const defaultCv = await this.cvs.defaultOf(userId);
      if (defaultCv === null) {
        throw new NoCv();
      }
      return defaultCv;
    }
    const owned = await this.cvs.findOwned(cvId, userId);
    if (owned === null) {
      throw new CvNotFound();
    }
    return owned;
  }

  private assertCvReady(cv: MatchCvSummary): void {
    if (cv.extractionStatus === 'pending') {
      throw new CvNotReady();
    }
    if (cv.extractionStatus === 'failed') {
      throw new CvNotReadable();
    }
  }

  private async assertWithinQuota(userId: string, now: Date): Promise<void> {
    let counted: QuotaCount;
    try {
      counted = await this.analyses.countForQuota(
        userId,
        this.settings.quotaWindowMs,
        this.settings.maxAgeMs,
        now,
      );
    } catch {
      // Fallo abierto: si el recuento no responde, la petición sigue.
      return;
    }

    if (counted.count < this.settings.analysesPerUser) {
      return;
    }
    if (counted.oldest === undefined) {
      return;
    }

    throw new TooManyAnalysisAttempts(
      retryAfterSeconds(counted.oldest, this.settings, now),
    );
  }
}

function isJobReady(
  title: string | undefined,
  description: string | undefined,
): boolean {
  const hasTitle = title !== undefined && title.length > 0;
  const hasDescription = description !== undefined && description.length > 0;
  return hasTitle || hasDescription;
}

function retryAfterSeconds(
  oldest: NonNullable<QuotaCount['oldest']>,
  settings: MatchAnalysisSettings,
  now: Date,
): number {
  const freesAt =
    oldest.kind === 'finished'
      ? oldest.at.getTime() + settings.quotaWindowMs
      : oldest.at.getTime() + settings.maxAgeMs;
  return Math.max(1, Math.ceil((freesAt - now.getTime()) / 1_000));
}
