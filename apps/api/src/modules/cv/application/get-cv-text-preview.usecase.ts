import type { CvTextPreviewResponse } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { CvNotFound, TooManyCvAttempts } from '../domain/errors';
import { CV_LIMITER, type CvLimiter } from './ports/cv-limiter.port';
import {
  CV_REPOSITORY,
  type CvRepository,
} from './ports/cv-repository.port';

/**
 * `GET /api/cv/:id/text-preview` (spec `cv/documents`, "Ver lo que leímos de un CV"; D6). Devuelve
 * `{ status, text, chars, complete }`: los primeros 2.000 caracteres del texto extraído, cortados en límite de
 * palabra.
 *
 * Existe porque un PDF a dos columnas se extrae entrelazando las dos: el resultado tiene miles de caracteres
 * —`textChars` alto, estado `extracted`, todo verde— y es ilegible para cualquier análisis. Sin esta vista, la primera
 * persona que lo descubriría sería la que recibiera un análisis absurdo, y ni siquiera sabría por qué.
 *
 * Un CV que todavía no está `extracted` responde `200` con su `status` y el texto vacío, **no** un código de error:
 * "todavía no hay texto" no es un fallo que el SPA deba traducir, y el `status` es lo único que distingue un `pending`
 * de un `failed`, que si no darían exactamente la misma respuesta vacía.
 *
 * **El contador se consume antes de resolver la propiedad**, y el orden es deliberado: lo que acota la ventana es
 * *pedir* vistas previas, no acertar con el identificador. Cobrar solo cuando el CV existe y es de quien pide dejaría
 * gratis la ráfaga de identificadores ajenos o inventados, que es justo la que hay que frenar, y un intento que no
 * cuesta nada se repite sin fin. El precio —gastar la ventana con identificadores malos deja sin vistas previas las
 * buenas— se asume. Esta es la única ruta que toca ese contador.
 */
@Injectable()
export class GetCvTextPreview {
  constructor(
    @Inject(CV_REPOSITORY) private readonly repository: CvRepository,
    @Inject(CV_LIMITER) private readonly limiter: CvLimiter,
  ) {}

  async execute(
    cvId: string,
    userId: string,
  ): Promise<CvTextPreviewResponse> {
    const decision = await this.limiter.consume({
      kind: 'text-preview',
      userId,
    });
    if (!decision.allowed) {
      throw new TooManyCvAttempts(decision.retryAfterSeconds);
    }
    const preview = await this.repository.textPreviewOf(cvId, userId);
    if (preview === null) {
      // Ajeno, inexistente o mal formado: el mismo cuerpo en los tres casos. El caso realista no es un ataque, sino
      // haberlo borrado en otra pestaña y pulsar "Ver lo que leímos" en esta.
      throw new CvNotFound();
    }
    return {
      status: preview.status,
      text: preview.text,
      chars: preview.chars,
      complete: preview.complete,
    };
  }
}
