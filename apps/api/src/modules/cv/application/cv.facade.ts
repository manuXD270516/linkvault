import { Inject, Injectable } from '@nestjs/common';
import type { CvExtractionStatus } from '@linkvault/shared';
import {
  CV_REPOSITORY,
  type CvRepository,
} from './ports/cv-repository.port';

/**
 * Vista mínima de un CV propio para otros módulos: metadatos y estado de lectura, **nunca** el texto.
 */
export interface CvMatchSummary {
  readonly id: string;
  readonly extractionStatus: CvExtractionStatus;
  readonly isDefault: boolean;
}

/**
 * Única entrada de otros módulos a `cv` por ahora (cv-match-suggestions). Solo lecturas de metadatos; el worker
 * leerá el texto por su propio puerto. Ampliar aquí, no exportando el repositorio.
 */
@Injectable()
export class CvFacade {
  constructor(
    @Inject(CV_REPOSITORY) private readonly cvs: CvRepository,
  ) {}

  /** El CV marcado por defecto de esa persona, o `null` si no tiene ninguno. */
  async defaultOf(userId: string): Promise<CvMatchSummary | null> {
    const documents = await this.cvs.listByUser(userId);
    const found = documents.find((cv) => cv.isDefault);
    return found === undefined ? null : toSummary(found);
  }

  /**
   * El CV de esa persona; `null` si no existe, es de otra o el id está mal formado. Un id ajeno se comporta igual que
   * uno inexistente.
   */
  async findOwned(
    cvId: string,
    userId: string,
  ): Promise<CvMatchSummary | null> {
    const found = await this.cvs.findOwned(cvId, userId);
    return found === null ? null : toSummary(found);
  }
}

function toSummary(document: {
  readonly id: string;
  readonly extraction: { readonly status: CvExtractionStatus };
  readonly isDefault: boolean;
}): CvMatchSummary {
  return {
    id: document.id,
    extractionStatus: document.extraction.status,
    isDefault: document.isDefault,
  };
}
