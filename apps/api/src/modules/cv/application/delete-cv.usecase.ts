import type { CvListResponse } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { CvNotFound } from '../domain/errors';
import { CvAnalysisCounts } from './cv-analysis-counts';
import { toCvResponses } from './cv.mapper';
import {
  CV_REPOSITORY,
  type CvRepository,
} from './ports/cv-repository.port';

/**
 * `DELETE /api/cv/:id` (spec `cv/documents`, "Eliminar un CV se lleva su archivo"): borra el documento, promueve al
 * más reciente de los que quedan si hacía falta, purga los análisis de encaje hechos con él y escribe `CvDeleted.v1`
 * en `outbox_events`, **todo en la misma transacción** (ADR-030 §4); el worker borra el objeto desde la cola.
 *
 * El archivo no se borra aquí, y eso es lo que ADR-009 existe para resolver: si el almacén no respondiera, o el proceso
 * muriera entre el `commit` y el borrado, el binario del dato más personal del producto sobreviviría sin nada que lo
 * recuerde.
 */
@Injectable()
export class DeleteCv {
  constructor(
    @Inject(CV_REPOSITORY) private readonly repository: CvRepository,
    private readonly analysisCounts: CvAnalysisCounts,
  ) {}

  async execute(cvId: string, userId: string): Promise<CvListResponse> {
    if (!(await this.repository.remove(cvId, userId))) {
      // Borrarlo dos veces, borrar el de otra persona o un `:id` mal formado: el mismo cuerpo en los tres casos.
      throw new CvNotFound();
    }
    const documents = await this.repository.listByUser(userId);
    const counts = await this.analysisCounts.countsByCv(userId);
    return { items: toCvResponses(documents, counts) };
  }
}
