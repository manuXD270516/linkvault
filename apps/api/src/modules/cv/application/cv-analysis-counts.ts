import { Injectable } from '@nestjs/common';

// Recuento de análisis de encaje por CV sin que `cv` conozca a `match` (tarea 11.3).
//
// El listado de CV necesita `matchAnalysesCount` para que la confirmación de borrado diga cuántos se lleva, pero el
// documento de análisis vive en otro bounded context. Este registro es el mismo patrón que `CvDeletionHooks`: `cv`
// expone el punto de extensión y `match` se registra en su `onModuleInit`. Sin lector registrado, cada CV responde `0`.

/** Lo que un módulo registra para contar los análisis de una persona por CV. */
export interface CvAnalysisCountReader {
  /** Recuento por `cvId` **sin** traer ningún documento de análisis. */
  countsByCv(userId: string): Promise<ReadonlyMap<string, number>>;
}

/** Lector por defecto: ningún CV tiene análisis todavía (o `match` no está cableado). */
const ZERO_COUNTS: CvAnalysisCountReader = {
  countsByCv: () => Promise.resolve(new Map()),
};

/**
 * Registro del recuento de análisis por CV. Lo provee y lo exporta `CvModule`; `match` sustituye la implementación
 * real al arrancar. La dependencia va de `match` a `cv`.
 */
@Injectable()
export class CvAnalysisCounts {
  private reader: CvAnalysisCountReader = ZERO_COUNTS;

  /** Sustituye el lector. Solo se espera uno: el que registre `MatchModule`. */
  register(reader: CvAnalysisCountReader): void {
    this.reader = reader;
  }

  /**
   * Recuento por `cvId` de los análisis de esa persona. Ausente en el mapa significa `0` al componer la respuesta.
   */
  countsByCv(userId: string): Promise<ReadonlyMap<string, number>> {
    return this.reader.countsByCv(userId);
  }
}
