import {
  cvFileKey,
  type CvExtractionFailureReason,
  type CvUploadedPayload,
} from '@linkvault/shared';
import { Logger } from '@nestjs/common';
import { outcomeOfExtractedText } from '../domain/extraction-outcome';
import {
  CV_CHILD_BOOT_TIMEOUT_MS,
  CV_ISOLATION_GRACE_MS,
} from './extraction-deadlines';
import type { SearchIndexJobPublisher } from '../../search/application/ports/search-index-job-publisher.port';
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
//
// Tras `extracted`, encola SearchUpsert (FEATURE_SEARCH) para reindexar con el texto (el upload solo indexó vacío).

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
  /**
   * Plazo de **contenido** de la extracción: lo cuenta el adaptador aislado desde que el proceso que lee el archivo se
   * anuncia listo, y al vencer lo mata. Este caso de uso lo usa, más el arranque y la gracia, como red exterior.
   */
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
    private readonly searchIndex: SearchIndexJobPublisher,
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

    const attempt = await this.withDeadline(() =>
      this.extractors[cv.fileType].extract(bytes),
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
    if (!written) {
      return { kind: 'lost_race' };
    }
    await this.searchIndex.upsert({
      docType: 'cv',
      aggregateId: cv.id,
      reason: 'cv_upsert',
      fingerprint: `cv:${cv.id}:extracted:${outcome.chars}`,
    });
    return { kind: 'extracted', chars: outcome.chars };
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
    if (written) {
      // Una línea con el identificador del CV y el motivo; nada del archivo ni del parser (la causa fina vive en el
      // contador y en la línea del adaptador, que no conoce el `cvId`).
      this.logger.warn(`cv ${cvId}: extraction ended as ${reason}`);
    }
    return written ? { kind: 'failed', reason } : { kind: 'lost_race' };
  }

  /**
   * Red **exterior** de la extracción (D2 de cv-extract-isolation): `timeoutMs` + el plazo de arranque del hijo + la
   * gracia. En el camino normal gana siempre uno de los plazos del adaptador, que **detiene** el trabajo (mata al
   * proceso hijo); esta carrera solo existe para que, si un defecto del adaptador no devolviera nunca, el job siga
   * terminando. Deja de esperar, no cancela. `lockDuration` (plazo + 15 s) queda por encima de este total.
   */
  private async withDeadline<T>(
    work: () => Promise<T>,
  ): Promise<T | 'timed_out'> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<'timed_out'>((resolve) => {
      timer = setTimeout(
        () => resolve('timed_out'),
        this.options.timeoutMs +
          CV_CHILD_BOOT_TIMEOUT_MS +
          CV_ISOLATION_GRACE_MS,
      );
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
