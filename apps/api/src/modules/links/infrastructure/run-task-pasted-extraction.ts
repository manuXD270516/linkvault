import {
  extractPastedJobTask,
  type ExtractPastedJobInput,
  type RunTaskFn,
} from '@linkvault/ai';
import { scrubContactDetails } from '@linkvault/shared';
import type { LinkUserDirectory } from '../application/ports/link-user-directory.port';
import type {
  PastedExtraction,
  PastedExtractionPort,
  PastedExtractionRequest,
} from '../application/ports/pasted-extraction.port';

/**
 * Adaptador PASTED_EXTRACTION sobre `runTask('extract-pasted-job')` (D1 y D2 de paste-job-description).
 *
 * - **Higiene antes**: el texto pasa por `scrubContactDetails`, la misma que se aplica a las páginas, así que a la IA
 *   no le llega ni un email ni un teléfono aunque quien llame se olvide. Limpiar dos veces no cambia nada, así que la
 *   clave determinista es la misma que la del golden, cuyos inputs se guardan ya limpios.
 * - **Consentimiento de quien pega**, leído de su perfil por la fachada de `users`: lo pegado es un dato personal suyo
 *   y la tarea es `personal`, así que un proveedor externo solo es elegible si lo aceptó.
 * - `ctx.userId` es quien pega —el gasto y la cuota son suyos— y `outputLanguage` es fijo `es`, porque el preview es
 *   compartido (ADR-022 §6).
 * - **Plazo**: `ctx.signal` combina `PASTE_EXTRACTION_TIMEOUT_MS` con el cierre de la conexión del cliente. `runTask`
 *   convierte un aborto en `degraded`, que aquí es "no disponible".
 *
 * Nada del texto se registra: ni aquí ni en `runTask`, que no persiste prompts renderizados.
 */
export class RunTaskPastedExtraction implements PastedExtractionPort {
  constructor(
    private readonly runTask: RunTaskFn,
    private readonly directory: LinkUserDirectory,
    private readonly timeoutMs: number,
  ) {}

  async extract(request: PastedExtractionRequest): Promise<PastedExtraction> {
    const text = scrubContactDetails(request.text);
    if (text === '') {
      // Sin nada que leer no se llama a la IA. El caso de uso ya lo comprueba antes; esto es defensa.
      return { outcome: 'not_a_job_posting' };
    }
    const input: ExtractPastedJobInput = {
      text,
      ...(request.knownTitle === undefined
        ? {}
        : { knownTitle: request.knownTitle }),
      ...(request.knownCompany === undefined
        ? {}
        : { knownCompany: request.knownCompany }),
    };
    const consent = await this.directory.aiConsentOf(request.userId);

    const result = await this.runTask(extractPastedJobTask, input, {
      userId: request.userId,
      aiConsent: { externalProviders: consent.externalProviders },
      outputLanguage: 'es',
      signal: this.deadline(request.signal),
    });

    if (result.status === 'degraded') {
      return result.reason === 'quota_exceeded'
        ? { outcome: 'quota_exceeded' }
        : { outcome: 'unavailable' };
    }
    if (!result.output.isJobPosting) {
      return { outcome: 'not_a_job_posting' };
    }
    return { outcome: 'extracted', fields: result.output.preview ?? {} };
  }

  /** El plazo de la lectura y, si llega, el cierre de la conexión del cliente: lo primero que ocurra. */
  private deadline(clientClosed: AbortSignal | undefined): AbortSignal {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return clientClosed === undefined
      ? timeout
      : AbortSignal.any([timeout, clientClosed]);
  }
}
