import type { JobPreview } from '@linkvault/shared';

// Puerto de la lectura del texto pegado (D1 y D2 de paste-job-description). El adaptador de producción va sobre
// `runTask('extract-pasted-job')` dentro de la misma petición: el texto solo existe en la memoria de este proceso
// mientras dura, y nunca se escribe en el outbox, en la cola, en la caché ni en los logs. Solo tipos y el token.
//
// El resultado es una unión cerrada y **nunca una excepción** por lo que no depende de nosotros: una IA que degrada o
// que no responde a tiempo es `unavailable`, y la cuota diaria agotada es `quota_exceeded`. Solo un error de
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
  /** La IA degradó o no respondió dentro del plazo. */
  | { readonly outcome: 'unavailable' }
  /** Quien pega agotó su cuota diaria de `extract-pasted-job`. */
  | { readonly outcome: 'quota_exceeded' };

export interface PastedExtractionPort {
  extract(request: PastedExtractionRequest): Promise<PastedExtraction>;
}
