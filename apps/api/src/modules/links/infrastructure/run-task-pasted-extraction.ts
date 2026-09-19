import {
  extractPastedJobTask,
  type ExtractPastedJobInput,
  type RunTaskFn,
} from '@linkvault/ai';
import { scrubContactDetails } from '@linkvault/shared';
import { Logger } from '@nestjs/common';
import type {
  LinkUserAiConsent,
  LinkUserDirectory,
} from '../application/ports/link-user-directory.port';
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
 * - **Sin consentimiento legible, no disponible**: si la fachada no responde (Mongo caído), no se sabe qué proveedores
 *   son elegibles, y suponer cualquiera de las dos cosas sería peor que decir "inténtalo en un rato". Se responde
 *   `unavailable`, que el caso de uso convierte en 503 con `Retry-After` y con el intento devuelto.
 * - **Plazo**: `ctx.signal` combina `PASTE_EXTRACTION_TIMEOUT_MS` con el cierre de la conexión del cliente. `runTask`
 *   convierte un aborto en `degraded`, que aquí es "no disponible".
 *
 * Nada del texto se registra: ni aquí ni en `runTask`, que no persiste prompts renderizados.
 */
/** Lo que el adaptador necesita de un logger; `Logger` de Nest lo cumple. */
export interface PastedExtractionLogger {
  warn(message: string): void;
}

export class RunTaskPastedExtraction implements PastedExtractionPort {
  constructor(
    private readonly runTask: RunTaskFn,
    private readonly directory: LinkUserDirectory,
    private readonly timeoutMs: number,
    private readonly logger: PastedExtractionLogger = new Logger(
      RunTaskPastedExtraction.name,
    ),
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
    const consent = await this.consentOf(request.userId);
    if (consent === null) {
      return { outcome: 'unavailable' };
    }

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

  /** El consentimiento de quien pega, o `null` si no se pudo leer. Se registra el nombre del error, nunca el usuario. */
  private async consentOf(userId: string): Promise<LinkUserAiConsent | null> {
    try {
      return await this.directory.aiConsentOf(userId);
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `Could not read the AI consent of whoever pastes (${name}); the paste answers unavailable`,
      );
      return null;
    }
  }

  /** El plazo de la lectura y, si llega, el cierre de la conexión del cliente: lo primero que ocurra. */
  private deadline(clientClosed: AbortSignal | undefined): AbortSignal {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return clientClosed === undefined
      ? timeout
      : AbortSignal.any([timeout, clientClosed]);
  }
}
