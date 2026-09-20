import type {
  CvExtractionFailureReason,
  CvFileType,
} from '@linkvault/shared';

// Puerto de persistencia del módulo `cv` del worker (D8 de cv-upload-extract). Se inyecta con
// `{ provide: CV_REPOSITORY, useClass: MongoCvRepository }`. Solo tipos y el token.
//
// La idempotencia del consumidor es **suya**, no prestada del `jobId` de la cola (la lección escrita en
// `EnrichLinkUseCase`): por eso la escritura va **condicionada** a que el CV siga en `pending`, y quien llama
// distingue "escribí yo" de "ganó otra ejecución" por lo que devuelve, no por lo que supone.

export const CV_REPOSITORY = Symbol('CV_REPOSITORY');

/** Lo que el worker necesita del CV para leer su archivo. Ni el nombre, ni el tamaño, ni nada más. */
export interface CvToExtract {
  readonly id: string;
  readonly userId: string;
  readonly fileType: CvFileType;
  readonly status: 'pending' | 'extracted' | 'failed';
}

/** Resultado con texto, ya normalizado y acotado por el dominio. */
export interface ExtractedCvText {
  readonly text: string;
  readonly chars: number;
  readonly truncated: boolean;
  readonly extractedAt: Date;
}

export interface CvRepository {
  /** El CV, o `null` si ya no existe (lo borraron entre el alta y el job). */
  findById(cvId: string): Promise<CvToExtract | null>;

  /**
   * Guarda el texto **condicionado** a `{ _id, 'extraction.status': 'pending' }`. `false` si no modificó nada: ganó
   * otra ejecución y el job termina bien, sin reintento.
   */
  saveExtractedText(cvId: string, result: ExtractedCvText): Promise<boolean>;

  /**
   * Marca el fallo con su motivo, con la misma condición. `false` si no modificó nada.
   */
  saveFailure(
    cvId: string,
    reason: CvExtractionFailureReason,
    at: Date,
  ): Promise<boolean>;
}
