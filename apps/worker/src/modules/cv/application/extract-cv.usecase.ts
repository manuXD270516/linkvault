import {
  cvFileKey,
  type CvExtractionFailureReason,
  type CvUploadedPayload,
} from '@linkvault/shared';
import { Logger } from '@nestjs/common';
import { outcomeOfExtractedText } from '../domain/extraction-outcome';
import type { Clock } from './ports/clock.port';
import type { CvFileReader } from './ports/cv-file-reader.port';
import type { CvRepository } from './ports/cv-repository.port';
import type { CvTextExtractors } from './ports/cv-text-extractors.port';

// Lectura del CV (D8 de cv-upload-extract, ADR-028 §7). El job lo publica el relay a partir de `CvUploaded.v1`, que
// solo lleva identificadores; la clave del objeto la compone aquí la misma `cvFileKey` que la usó al guardarlo.
//
// **La idempotencia es propia, no prestada del `jobId`** (la lección escrita en `EnrichLinkUseCase`: el `jobId`
// determinista solo evita duplicados mientras la cola recuerda el trabajo). Son **cuatro cortes**, y los cuatro
// terminan el job bien y sin reintentos.
//
// Lo que sí se reintenta es lo que revienta: Mongo o el almacén sin responder. Eso **lanza**, y la cola aplica su
// política de tres intentos con espera creciente.

/** Cómo terminó el trabajo. Ninguno de estos es un error del job. */
export type ExtractCvResult =
  /** Se guardó el texto. */
  | { readonly kind: 'extracted'; readonly chars: number }
  /** Se guardó el fallo con su motivo, que la persona puede entender. */
  | { readonly kind: 'failed'; readonly reason: CvExtractionFailureReason }
  /** Primer corte: el CV ya no existe; lo borraron entre el alta y el job. */
  | { readonly kind: 'cv_not_found' }
  /** Segundo corte: su estado ya no es `pending`; otra ejecución lo resolvió. */
  | { readonly kind: 'already_extracted' }
  /** Cuarto corte: la escritura condicionada no modificó nada; ganó otra ejecución. */
  | { readonly kind: 'lost_race' };

export interface ExtractCvOptions {
  /** Plazo de la extracción entera: un PDF malformado puede tener a un parser dando vueltas. */
  readonly timeoutMs: number;
}

export class ExtractCvUseCase {
  private readonly logger = new Logger(ExtractCvUseCase.name);

  constructor(
    private readonly repository: CvRepository,
    private readonly files: CvFileReader,
    private readonly extractors: CvTextExtractors,
    private readonly clock: Clock,
    private readonly options: ExtractCvOptions,
  ) {}

  async execute(payload: CvUploadedPayload): Promise<ExtractCvResult> {
    const cv = await this.repository.findById(payload.cvId);
    if (cv === null) {
      // 1. Lo borraron entre medias. No hay nada que escribir y nada que reintentar.
      return { kind: 'cv_not_found' };
    }
    if (cv.status !== 'pending') {
      // 2. Ya está resuelto: ni se vuelve a leer el archivo.
      return { kind: 'already_extracted' };
    }

    const bytes = await this.files.read(cvFileKey(cv.userId, cv.id));
    if (bytes === null) {
      // 3. El objeto no está: lo borró el otro consumidor en una carrera entre subir y borrar, o el documento se
      // quedó huérfano. Reintentarlo daría lo mismo —un objeto que no existe no aparece a los cinco segundos—, así
      // que el CV queda en `failed` y el job termina bien. Se distingue a propósito de "el almacén no responde",
      // que sí es transitorio y sí lanza.
      this.logger.warn(`cv ${cv.id}: its file is not in the store`);
      return await this.resolveFailure(cv.id, 'internal_error');
    }

    const attempt = await this.withDeadline(
      () => this.extractors[cv.fileType].extract(bytes),
    );
    if (attempt === 'timed_out') {
      // Para la persona es indistinguible de un archivo roto, y lo es.
      return await this.resolveFailure(cv.id, 'unreadable_file');
    }
    if (attempt.kind === 'unreadable_file') {
      return await this.resolveFailure(cv.id, 'unreadable_file');
    }

    const outcome = outcomeOfExtractedText(attempt.text);
    if (outcome.kind === 'no_text') {
      return await this.resolveFailure(cv.id, 'no_text');
    }
    const written = await this.repository.saveExtractedText(cv.id, {
      text: outcome.text,
      chars: outcome.chars,
      truncated: outcome.truncated,
      extractedAt: this.clock.now(),
    });
    // 4. La escritura va condicionada al estado `pending`: si no modificó nada, ganó otra ejecución.
    return written
      ? { kind: 'extracted', chars: outcome.chars }
      : { kind: 'lost_race' };
  }

  /**
   * Deja el CV en `failed` con `internal_error` al agotarse los reintentos del job. **Nunca en `pending` para
   * siempre**: un estado "leyendo" eterno es una mentira que la persona no puede resolver.
   */
  async markRetriesExhausted(payload: CvUploadedPayload): Promise<void> {
    const written = await this.repository.saveFailure(
      payload.cvId,
      'internal_error',
      this.clock.now(),
    );
    if (written) {
      this.logger.warn(`cv ${payload.cvId}: extraction gave up after retries`);
    }
  }

  private async resolveFailure(
    cvId: string,
    reason: CvExtractionFailureReason,
  ): Promise<ExtractCvResult> {
    const written = await this.repository.saveFailure(
      cvId,
      reason,
      this.clock.now(),
    );
    return written ? { kind: 'failed', reason } : { kind: 'lost_race' };
  }

  /**
   * El plazo acota la extracción **entera**. No cancela el parser —no hay forma de hacerlo—, así que lo que hace es
   * dejar de esperarlo: el job termina con su resultado y el trabajo colgado se lo lleva el proceso.
   */
  private async withDeadline<T>(
    work: () => Promise<T>,
  ): Promise<T | 'timed_out'> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<'timed_out'>((resolve) => {
      timer = setTimeout(() => resolve('timed_out'), this.options.timeoutMs);
      // `unref` para que un plazo pendiente no mantenga vivo el proceso al apagarse.
      timer.unref?.();
    });
    try {
      return await Promise.race([work(), deadline]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}
