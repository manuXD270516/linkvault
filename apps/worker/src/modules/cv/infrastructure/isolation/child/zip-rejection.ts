import type { ChildFailureCause } from '../child-protocol';

/**
 * Un ZIP que el lector propio rechaza (D4). Lleva solo la causa de la lista cerrada del hijo: ningún texto del
 * archivo ni de la excepción interna.
 */
export class ZipRejection extends Error {
  constructor(readonly failure: ChildFailureCause) {
    super(`zip rejected: ${failure}`);
    this.name = 'ZipRejection';
  }
}
