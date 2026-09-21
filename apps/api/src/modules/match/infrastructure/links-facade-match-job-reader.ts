import { Injectable } from '@nestjs/common';
import { LinksFacade } from '../../links/application/links.facade';
import type {
  MatchJobReader,
  MatchJobSummary,
} from '../application/ports/job-reader.port';

/**
 * Adaptador `MATCH_JOB_READER` sobre `LinksFacade` (tarea 9.x). `match` no lee las colecciones de links.
 */
@Injectable()
export class LinksFacadeMatchJobReader implements MatchJobReader {
  constructor(private readonly links: LinksFacade) {}

  canRead(userId: string, linkId: string): Promise<boolean> {
    return this.links.canRead(userId, linkId);
  }

  summaryOf(linkId: string): Promise<MatchJobSummary | null> {
    return this.links.matchJobSummaryOf(linkId);
  }
}
