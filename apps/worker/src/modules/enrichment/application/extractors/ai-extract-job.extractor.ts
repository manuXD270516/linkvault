import { extractJobTask, type RunTaskFn } from '@linkvault/ai';
import {
  NOTHING_EXTRACTED,
  type ExtractionContext,
  type ExtractionOutcome,
  type ExtractorStrategy,
} from '../../domain/extractors/extractor';
import type { PageContent } from '../../domain/page-content';
import { draftFrom } from '../../domain/preview-draft';

// Tercera etapa de la cadena (D3 y D7 de link-enrichment): `runTask('extract-job')` sobre el texto limpio de la
// página. Vive en `application/` y no en `domain/` porque necesita un puerto —`RUN_TASK`—, que es lo único que el
// worker conoce del módulo de IA: los SDK de proveedores no se importan fuera de `libs/ai` (ADR-014).
//
// Tres decisiones se ven aquí y las tres son de D7:
//
// - **`ctx.userId = link.createdBy`**: sin eso, las cuotas por usuario y tarea de ADR-018 §9 no aplicarían nunca a
//   `extract-job` y el registro de uso no diría de quién fue el gasto. La relectura que pide otra persona se atribuye
//   igualmente a quien guardó el link, porque el `JobLink` es de quien lo trajo (queda dicho en ADR-022).
// - **`outputLanguage` fijo `es`**: el `JobLink` es canónico y compartido, así que su preview lo ven todos los
//   miembros de todos los grupos donde esté y no puede depender de las preferencias de una persona. Además evita que
//   el worker tenga que leer `users`.
// - **Una degradación no falla el job**: el link se queda con lo que sacaron las etapas anteriores (`partial`), que
//   es mejor que perder también eso.

export const AI_EXTRACT_JOB_EXTRACTOR_ID = 'ai:extract-job';

export class AiExtractJobExtractor implements ExtractorStrategy {
  readonly id = AI_EXTRACT_JOB_EXTRACTOR_ID;

  constructor(private readonly runTask: RunTaskFn) {}

  supports(page: PageContent): boolean {
    // Sin texto no hay nada que leer, y llamar a un proveedor con la cadena vacía sería gastar plazo y cuota a cambio
    // de nada.
    return page.text.trim() !== '';
  }

  async extract(context: ExtractionContext): Promise<ExtractionOutcome> {
    // Plazo agotado: la etapa se salta y el link se queda con lo obtenido hasta aquí.
    if (context.remainingMs <= 0) return NOTHING_EXTRACTED;

    try {
      const result = await this.runTask(
        extractJobTask,
        { text: context.page.text },
        {
          userId: context.createdBy,
          // `extract-job` es `public`: la página es pública y el consentimiento de nadie condiciona su routing
          // (ADR-014). Se declara a `false` porque el worker no lee `users` y no le consta ninguno.
          aiConsent: { externalProviders: false },
          outputLanguage: 'es',
          signal: this.deadlineSignal(context),
        },
      );

      if (result.status !== 'success') return NOTHING_EXTRACTED;

      const { isJobPosting, preview } = result.output;
      // Lo que no es una vacante no aporta ni un campo: con un schema que exige `title`, un modelo a temperatura 0
      // inventaría un título para un vídeo, y el motivo `not_a_job` existe justo para no guardarlo.
      if (!isJobPosting) return { draft: {}, isJobPosting: false };

      return {
        draft: draftFrom(this.id, preview ?? {}),
        isJobPosting: true,
      };
    } catch {
      // Un proveedor que revienta o un plazo que vence no son un fallo del enriquecimiento: son una etapa menos.
      return NOTHING_EXTRACTED;
    }
  }

  /** El plazo de la etapa es lo que queda del plazo del link, y nunca más que él. */
  private deadlineSignal(context: ExtractionContext): AbortSignal {
    const own = AbortSignal.timeout(context.remainingMs);
    return context.signal === undefined
      ? own
      : AbortSignal.any([own, context.signal]);
  }
}
