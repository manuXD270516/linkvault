import type { CvListResponse } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { CvNotFound } from '../domain/errors';
import { toCvResponse } from './cv.mapper';
import {
  CV_REPOSITORY,
  type CvRepository,
} from './ports/cv-repository.port';

/**
 * `PUT /api/cv/:id/default` (spec `cv/documents`, "Un solo CV por defecto"): marca ese CV y apaga el anterior en una
 * sola transacción, y devuelve la lista actualizada para que la pantalla no tenga que pedirla aparte.
 *
 * **Idempotente**: marcar el que ya lo era responde `200` con la misma lista. Es la vuelta atrás explícita de "la
 * subida nueva se lleva la marca", y tiene que costar un clic.
 *
 * **El estado de la extracción no decide nada**: un CV en `pending` o en `failed` se puede marcar. La marca dice "este
 * quiero usar", no "este se pudo leer"; quien lo consuma exigirá `extracted` y lo dirá, y la lista ya lo dice antes.
 */
@Injectable()
export class SetDefaultCv {
  constructor(
    @Inject(CV_REPOSITORY) private readonly repository: CvRepository,
  ) {}

  async execute(cvId: string, userId: string): Promise<CvListResponse> {
    if (!(await this.repository.setDefault(cvId, userId))) {
      // Ajeno, inexistente o mal formado: el mismo cuerpo en los tres casos.
      throw new CvNotFound();
    }
    const documents = await this.repository.listByUser(userId);
    return { items: documents.map(toCvResponse) };
  }
}
