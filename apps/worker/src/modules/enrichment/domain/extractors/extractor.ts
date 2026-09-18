import type { PreviewDraft } from '@linkvault/shared';
import type { PageContent } from '../page-content';

// La etapa de la cadena de extracción (D3 de link-enrichment). El orden en que se ejecutan es el contrato: es lo que
// decide los empates dentro de una pasada, así que no hay confianza numérica que calcular.
//
// El dominio define la forma; quién la implementa depende de la etapa. `json-ld` y `metadata` son puras y viven aquí;
// `ai:extract-job` necesita el puerto de IA y vive en `application/`; `headless` es un hueco cuyo `supports` devuelve
// `false` mientras el flag esté apagado.

export interface ExtractionContext {
  readonly page: PageContent;
  /** Quién guardó el link: la ejecución de la IA se atribuye a esa persona (D7). */
  readonly createdBy: string;
  /** Lo que queda del plazo por link (`ENRICH_DEADLINE_MS`) al llegar a esta etapa. */
  readonly remainingMs: number;
  /** Señal del plazo total del link, para la etapa que hable con alguien de fuera. */
  readonly signal?: AbortSignal;
}

/**
 * Lo que devuelve una etapa. Es un objeto y no el borrador a secas porque el motivo `not_a_job` (D5) necesita saber si
 * alguien se pronunció sobre **qué** es la página, además de qué campos sacó de ella: una página sin campos de la que
 * nadie dijo nada es `no_data`, y una de la que la IA dijo que no es una vacante es `not_a_job`. Son dos mensajes
 * distintos para quien mira, y uno lleva a "quítalo" y el otro a "reintenta o complétalo".
 */
export interface ExtractionOutcome {
  readonly draft: PreviewDraft;
  /** `undefined` cuando la etapa no se pronuncia, que es lo normal. */
  readonly isJobPosting?: boolean;
}

export interface ExtractorStrategy {
  /** Identificador que queda escrito en la procedencia de cada campo: `json-ld`, `metadata`, `ai:extract-job`… */
  readonly id: string;
  /** Si tiene sentido ejecutarla sobre esa página. Una etapa que no aporta nada no se ejecuta. */
  supports(page: PageContent): boolean;
  extract(context: ExtractionContext): Promise<ExtractionOutcome>;
}

/** La etapa no sacó nada y no se pronuncia sobre qué es la página. */
export const NOTHING_EXTRACTED: ExtractionOutcome = { draft: {} };
