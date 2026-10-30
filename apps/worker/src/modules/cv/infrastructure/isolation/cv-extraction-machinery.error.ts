import { CHILD_CODE_PATTERN } from './child-protocol';

/** Causas de maquinaria: lo que pasa antes de que el hijo se anuncie listo (D6). Lista cerrada. */
export type MachineryCause = 'boot_error' | 'boot_timeout' | 'protocol';

/**
 * Fallo de la maquinaria de lectura: el script del hijo ausente, una biblioteca que no carga, 5 s sin `ready`, una
 * línea inválida antes de `ready`. **Lanza**, para que la cola reintente; agotados los intentos, el CV queda en
 * `internal_error`.
 *
 * El mensaje es **fijo** y no hay `cause` encadenada: BullMQ guarda `error.message` en `job.failedReason`, así que
 * nada del hijo ni del CV puede entrar aquí. De lo que diga el hijo solo se conserva un `code` que cumpla el patrón.
 */
export class CvExtractionMachineryError extends Error {
  readonly machineryCause: MachineryCause;
  readonly code: string | undefined;

  constructor(machineryCause: MachineryCause, code?: string) {
    super(`cv extraction machinery failure: ${machineryCause}`);
    this.name = 'CvExtractionMachineryError';
    this.machineryCause = machineryCause;
    this.code =
      code !== undefined && CHILD_CODE_PATTERN.test(code) ? code : undefined;
  }
}
