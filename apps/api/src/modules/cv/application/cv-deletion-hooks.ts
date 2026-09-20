import { Injectable } from '@nestjs/common';
import type { TransactionSession } from '../../../infrastructure/outbox/transaction-session';

// Cascada del borrado de un CV sin romper los límites entre módulos (ADR-030 §4).
//
// El borrado vive en `MongoCvRepository.remove` y su sesión es privada, pero los análisis de encaje los escribe
// `match`, que no puede entrar aquí ni al revés fuera de las entradas públicas. La solución es este registro: `cv`
// ejecuta los hooks registrados **dentro** de su transacción y sigue sin conocer a nadie. Sin hooks registrados el
// borrado se comporta exactamente como antes.
//
// La cascada va en la misma transacción a propósito: un oyente in-process de `cv.deleted` sería un dual-write —si el
// proceso muere entre el commit y el oyente, los análisis (con texto literal del CV) sobreviven sin reintento—.

/** Lo que un módulo registra para limpiar lo suyo cuando desaparece un CV. */
export interface CvDeletionHook {
  /**
   * Borra lo que cuelga de ese CV dentro de la misma transacción. Recibe también el `userId` del dueño porque el
   * repositorio de análisis indexa por ambos.
   */
  deleteRelationsOf(
    cvId: string,
    userId: string,
    session: TransactionSession,
  ): Promise<void>;
}

/**
 * Registro de hooks del borrado de CV. Lo provee y lo exporta `CvModule`; quien quiera limpiar lo suyo se registra en
 * su `onModuleInit`, así que la dependencia va del otro módulo a `cv`, que es la dirección permitida.
 */
@Injectable()
export class CvDeletionHooks {
  private readonly hooks: CvDeletionHook[] = [];

  /** Cuántos hooks hay registrados. Por defecto, ninguno. */
  get size(): number {
    return this.hooks.length;
  }

  register(hook: CvDeletionHook): void {
    this.hooks.push(hook);
  }

  /**
   * Ejecuta todos los hooks en orden de registro, con la sesión de la transacción. Si uno falla, la excepción sube y la
   * transacción entera se deshace: nunca queda un CV borrado con análisis huérfanos.
   */
  async runAll(
    cvId: string,
    userId: string,
    session: TransactionSession,
  ): Promise<void> {
    for (const hook of this.hooks) {
      await hook.deleteRelationsOf(cvId, userId, session);
    }
  }
}
