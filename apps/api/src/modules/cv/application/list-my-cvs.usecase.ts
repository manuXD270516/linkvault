import type { CvListResponse } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { CvAnalysisCounts } from './cv-analysis-counts';
import { toCvResponses } from './cv.mapper';
import {
  CV_REPOSITORY,
  type CvRepository,
} from './ports/cv-repository.port';

/**
 * `GET /api/cv` (spec `cv/documents`, "Listado de mis CV"): los CV de quien pide, del más reciente al más antiguo.
 * Sin paginación, porque el máximo son cinco.
 *
 * El mapeo va por **lista explícita de campos** (`toCvResponse`): ni el texto, ni la marca de recorte, ni la clave del
 * objeto, ni el `userId` del dueño. `matchAnalysesCount` llega del registro que `match` cablea al arrancar.
 */
@Injectable()
export class ListMyCvs {
  constructor(
    @Inject(CV_REPOSITORY) private readonly repository: CvRepository,
    private readonly analysisCounts: CvAnalysisCounts,
  ) {}

  async execute(userId: string): Promise<CvListResponse> {
    const documents = await this.repository.listByUser(userId);
    const counts = await this.analysisCounts.countsByCv(userId);
    return { items: toCvResponses(documents, counts) };
  }
}
