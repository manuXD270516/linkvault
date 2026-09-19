import type {
  ExtractionOutcome,
  ExtractorStrategy,
} from './extractors/extractor';
import type { PageContent } from './page-content';
import { mergeDrafts } from './merge';
import {
  hasRequiredFields,
  valuesOfDraft,
  type PreviewDraft,
} from '@linkvault/shared';

// Orquestador de la cadena de extracción (D3 y D7 de link-enrichment). Puro: recibe la página ya parseada y las
// etapas ya construidas, y no sabe de HTML, de red ni de IA.
//
// Tres reglas, y las tres importan:
//
// - **Parada temprana**: en cuanto la pasada tiene `title` y `company` no se ejecuta ninguna etapa más. Es lo que
//   evita llamar a la IA por una página cuyo JSON-LD ya lo decía todo, que es la mayoría de las que sí podemos leer.
// - **Reparto del plazo**: cada etapa recibe lo que queda del plazo por link. Cuando no queda, las etapas restantes
//   se saltan, y el link se queda con lo obtenido hasta ahí: una importación grande no puede esperar los tiempos
//   máximos de toda la cadena de proveedores por cada link.
// - **Una etapa que se rompe no tira la pasada**: lo que sacaron las anteriores se guarda igual.

export interface ExtractionChainInput {
  readonly page: PageContent;
  /** Quién guardó el link: la etapa de IA se atribuye a esa persona (D7). */
  readonly createdBy: string;
  /** Instante (epoch ms) en que vence el plazo por link. */
  readonly deadlineAt: number;
  readonly signal?: AbortSignal;
}

export interface ExtractionChainResult {
  /** Lo que la pasada propone, ya mezclado con la regla de "gana la etapa anterior". */
  readonly draft: PreviewDraft;
  /** Etapas que llegaron a ejecutarse, en orden. Es lo que permite afirmar que la IA no se llamó. */
  readonly ran: readonly string[];
  /**
   * Qué es la página, si alguna etapa se pronunció: `false` es lo que convierte una pasada sin campos en `not_a_job`
   * en vez de en `no_data`. Un `true` de cualquier etapa manda sobre un `false` posterior: quien encontró un
   * `JobPosting` publicado por el sitio sabe más que quien no supo leer la página.
   */
  readonly isJobPosting?: boolean;
}

export class ExtractionChain {
  /** `extractors` llega **en el orden de D3**: ese orden es el contrato, y es lo que decide los empates. */
  constructor(
    private readonly extractors: readonly ExtractorStrategy[],
    private readonly now: () => number,
  ) {}

  async run(input: ExtractionChainInput): Promise<ExtractionChainResult> {
    const drafts: PreviewDraft[] = [];
    const ran: string[] = [];
    const verdicts: boolean[] = [];

    for (const extractor of this.extractors) {
      // Parada temprana: con los obligatorios ya leídos, seguir preguntando no cambiaría el resultado.
      if (hasRequiredFields(valuesOfDraft(mergeDrafts(drafts)))) break;
      if (!extractor.supports(input.page)) continue;

      const remainingMs = input.deadlineAt - this.now();
      // Sin plazo no se empieza una etapa: arrancarla para abandonarla a mitad solo gasta el tiempo de otro link.
      if (remainingMs <= 0) break;

      const outcome = await this.runStage(extractor, input, remainingMs);
      if (outcome === null) continue;

      ran.push(extractor.id);
      drafts.push(outcome.draft);
      if (outcome.isJobPosting !== undefined)
        verdicts.push(outcome.isJobPosting);
    }

    return {
      draft: mergeDrafts(drafts),
      ran,
      isJobPosting: verdicts.length === 0 ? undefined : verdicts.includes(true),
    };
  }

  /** `null` cuando la etapa se rompió: lo que hayan sacado las demás se guarda igual. */
  private async runStage(
    extractor: ExtractorStrategy,
    input: ExtractionChainInput,
    remainingMs: number,
  ): Promise<ExtractionOutcome | null> {
    try {
      return await extractor.extract({
        page: input.page,
        createdBy: input.createdBy,
        remainingMs,
        signal: input.signal,
      });
    } catch {
      return null;
    }
  }
}
