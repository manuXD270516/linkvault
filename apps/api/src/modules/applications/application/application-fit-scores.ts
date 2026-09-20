import { Injectable } from '@nestjs/common';

// Puntuación de encaje derivada al leer (D11 / ADR-030 §5).
//
// La postulación no guarda ningún número: al componer la respuesta, `applications` pregunta por lote (un `userId` y un
// conjunto de `linkId`) y pinta lo que haya. El registro vive aquí; `match` se registra en su `onModuleInit`, así que la
// dependencia va de `match` a `applications` y este módulo no importa a `match`. Sin registro, ninguna postulación lleva
// puntuación —exactamente como hoy—.

/** Score + marca del último análisis `done` de esa persona sobre ese link. */
export interface LinkFitScore {
  readonly score: number;
  readonly degraded: boolean;
}

/** Fuente registrada por otro módulo (p. ej. `match`). */
export interface ApplicationFitScoreSource {
  /**
   * Consulta por lote: un `userId` y un conjunto de `linkId`. Devuelve, por link, el `score` y la marca de degradado
   * del último análisis por fecha de finalización entre los que terminaron en `done`. Los `failed`, `running` y
   * vencidos no cuentan. Sin análisis `done` para un link, ese link no aparece en el mapa.
   */
  scoresFor(
    userId: string,
    linkIds: readonly string[],
  ): Promise<ReadonlyMap<string, LinkFitScore>>;
}

const EMPTY_SOURCE: ApplicationFitScoreSource = {
  scoresFor: () => Promise.resolve(new Map()),
};

/**
 * Registro de la fuente de puntuaciones. Lo provee y lo exporta `ApplicationsModule`; quien sepa de análisis se
 * registra en su `onModuleInit`. Por defecto no devuelve ninguna puntuación.
 */
@Injectable()
export class ApplicationFitScores {
  private source: ApplicationFitScoreSource = EMPTY_SOURCE;

  /** `true` cuando alguien sustituyó la implementación por defecto. */
  get registered(): boolean {
    return this.source !== EMPTY_SOURCE;
  }

  register(source: ApplicationFitScoreSource): void {
    this.source = source;
  }

  scoresFor(
    userId: string,
    linkIds: readonly string[],
  ): Promise<ReadonlyMap<string, LinkFitScore>> {
    if (linkIds.length === 0) {
      return Promise.resolve(new Map());
    }
    return this.source.scoresFor(userId, linkIds);
  }
}
