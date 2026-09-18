import { Injectable } from '@nestjs/common';

// Cascada del borrado de un grupo sin romper los límites entre módulos (D7b de job-links).
//
// El borrado vive en `MongoGroupRepository.deleteGroup` y su sesión es privada, pero lo que cuelga de un grupo lo
// escriben otros módulos (`links` y, más adelante, comentarios o postulaciones), que no pueden entrar aquí ni al revés
// fuera de las entradas públicas. La solución es este registro: `groups` ejecuta los hooks registrados **dentro** de su
// transacción y sigue sin conocer a nadie. Sin hooks registrados el borrado se comporta exactamente como antes.

/** Sesión de la transacción de borrado. Opaca: quien la recibe solo la pasa a su propio repositorio. */
export type GroupDeletionSession = object;

/** Lo que un módulo registra para limpiar lo suyo cuando desaparece un grupo. */
export interface GroupDeletionHook {
  /** Borra las relaciones de ese grupo dentro de la misma transacción. Nunca borra agregados compartidos. */
  deleteRelationsOf(
    groupId: string,
    session: GroupDeletionSession,
  ): Promise<void>;
}

/**
 * Registro de hooks del borrado de grupo. Lo provee y lo exporta `GroupsModule`; quien quiera limpiar lo suyo se
 * registra en su `onModuleInit`, así que la dependencia va del otro módulo a `groups`, que es la dirección permitida.
 */
@Injectable()
export class GroupDeletionHooks {
  private readonly hooks: GroupDeletionHook[] = [];

  /** Cuántos hooks hay registrados. Por defecto, ninguno. */
  get size(): number {
    return this.hooks.length;
  }

  register(hook: GroupDeletionHook): void {
    this.hooks.push(hook);
  }

  /**
   * Ejecuta todos los hooks en orden de registro, con la sesión de la transacción. Si uno falla, la excepción sube y la
   * transacción entera se deshace: nunca queda un grupo borrado con relaciones huérfanas.
   */
  async runAll(
    groupId: string,
    session: GroupDeletionSession,
  ): Promise<void> {
    for (const hook of this.hooks) {
      await hook.deleteRelationsOf(groupId, session);
    }
  }
}
