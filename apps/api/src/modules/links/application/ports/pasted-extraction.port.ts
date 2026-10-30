import type { JobPreview } from '@linkvault/shared';

// Puerto de la lectura del texto pegado (D1 y D2 de paste-job-description). El adaptador de producción va sobre
// `runTask('extract-pasted-job')` dentro de la misma petición: el texto solo existe en la memoria de este proceso
// mientras dura, y nunca se escribe en el outbox, en la cola, en la caché ni en los logs. Solo tipos y el token.
//
// El resultado es una unión cerrada y **nunca una excepción** por lo que no depende de nosotros. Cada caso en que la IA
// no leyó el texto tiene su variante (ADR-060 §5): `quota_exceeded` (cuota propia), `consent_required` (falta el permiso
// de quien pega), `capacity_exhausted` (el proveedor agotó su cupo), `disabled` (lectura no disponible por configuración
// o política de datos) y `unavailable` (todo lo demás: plazo agotado, avería, degradado sin caso propio). Solo un error de
// programación —un fixture que falta en `replay`, un prompt roto— sale como excepción, porque tiene que hacer fallar
// el test que lo provoca.

export const PASTED_EXTRACTION = Symbol('PASTED_EXTRACTION');

/** Lo que se le pide leer: el texto pegado y, como contexto, el título y la empresa que la persona escribió aparte. */
export interface PastedExtractionRequest {
  /** Quien pega: el gasto es suyo y su consentimiento decide si un proveedor externo es elegible. */
  readonly userId: string;
  /** Texto de la oferta. El adaptador le quita emails y teléfonos antes de que llegue a la IA. */
  readonly text: string;
  readonly knownTitle?: string;
  readonly knownCompany?: string;
  /** Se aborta si el cliente cierra la conexión: no se gasta IA para un diálogo que ya nadie mira. */
  readonly signal?: AbortSignal;
}

export type PastedExtraction =
  /** La IA reconoció una oferta. `fields` puede venir vacío o con huecos: el dominio solo escribe lo que dice algo. */
  | { readonly outcome: 'extracted'; readonly fields: Partial<JobPreview> }
  /** La IA respondió que el texto no es una oferta. */
  | { readonly outcome: 'not_a_job_posting' }
  /** La IA degradó o no respondió dentro del plazo, o degradó sin un caso propio. */
  | { readonly outcome: 'unavailable' }
  /**
   * Quien pega agotó su cuota diaria de `extract-pasted-job`. `retryAt` es el instante en que se libera su ejecución
   * contada más antigua; sin él, el caso de uso anuncia la ventana entera.
   */
  | { readonly outcome: 'quota_exceeded'; readonly retryAt?: Date }
  /** Falta el permiso de quien pega para enviar datos a proveedores externos, y es lo primero que falta. */
  | { readonly outcome: 'consent_required' }
  /** El proveedor agotó su cupo: no se sabe cuándo vuelve. */
  | { readonly outcome: 'capacity_exhausted' }
  /** La lectura no está disponible por configuración o política de datos: reintentar no lo cambia. */
  | { readonly outcome: 'disabled' };

export interface PastedExtractionPort {
  extract(request: PastedExtractionRequest): Promise<PastedExtraction>;
}
