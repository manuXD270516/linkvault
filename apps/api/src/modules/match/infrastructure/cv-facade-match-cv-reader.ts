import { Injectable } from '@nestjs/common';
import { CvFacade } from '../../cv/application/cv.facade';
import type {
  MatchCvReader,
  MatchCvSummary,
} from '../application/ports/cv-reader.port';

/**
 * Adaptador `MATCH_CV_READER` sobre `CvFacade` (tarea 9.x). Solo metadatos; **nunca** el texto.
 */
@Injectable()
export class CvFacadeMatchCvReader implements MatchCvReader {
  constructor(private readonly cvs: CvFacade) {}

  defaultOf(userId: string): Promise<MatchCvSummary | null> {
    return this.cvs.defaultOf(userId);
  }

  findOwned(cvId: string, userId: string): Promise<MatchCvSummary | null> {
    return this.cvs.findOwned(cvId, userId);
  }
}
