import type { MatchAnalysisResponse } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { LinkNotFound } from '../../links/domain/errors';
import { AnalysisNotFound } from '../domain/errors';
import { toMatchAnalysisResponse } from './match.mapper';
import {
  ANALYSIS_REPOSITORY,
  type AnalysisRepository,
} from './ports/analysis-repository.port';
import { MATCH_CLOCK, type MatchClock } from './ports/clock.port';
import {
  MATCH_CV_READER,
  type MatchCvReader,
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
 * `GET /api/links/:linkId/match` (specs `cv/match`): los dos bloques `latest` y `running` de quien pide sobre esa
 * oferta. `consentRequired` y `aiQuotaRetryAt` salen tal como quedaron guardados; no se mira el perfil.
 */
@Injectable()
export class GetMatchAnalysis {
  constructor(
    @Inject(MATCH_JOB_READER) private readonly jobs: MatchJobReader,
    @Inject(MATCH_CV_READER) private readonly cvs: MatchCvReader,
    @Inject(ANALYSIS_REPOSITORY) private readonly analyses: AnalysisRepository,
    @Inject(MATCH_CLOCK) private readonly clock: MatchClock,
    @Inject(MATCH_ANALYSIS_SETTINGS)
    private readonly settings: MatchAnalysisSettings,
  ) {}

  async execute(
    userId: string,
    linkId: string,
  ): Promise<MatchAnalysisResponse> {
    if (!(await this.jobs.canRead(userId, linkId))) {
      throw new LinkNotFound();
    }

    const now = this.clock.now();
    const { maxAgeMs } = this.settings;

    const [latest, running, job, defaultCv] = await Promise.all([
      this.analyses.findLatestResolved(userId, linkId, maxAgeMs, now),
      this.analyses.findRunning(userId, linkId, maxAgeMs, now),
      this.jobs.summaryOf(linkId),
      this.cvs.defaultOf(userId),
    ]);

    if (latest === null && running === null) {
      throw new AnalysisNotFound();
    }

    // canRead pasó; sin ficha usamos previewVersion 0 para que `stale` avise sin inventar datos.
    const currentPreviewVersion = job?.previewVersion ?? 0;

    return toMatchAnalysisResponse({
      linkId,
      latest,
      running,
      currentPreviewVersion,
      defaultCvId: defaultCv?.id ?? null,
      maxAgeMs,
    });
  }
}
