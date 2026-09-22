import { Inject, Injectable } from '@nestjs/common';
import type { GroupVisibility } from '../domain/group';
import type { GroupRole } from '../domain/membership';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
} from './ports/group-repository.port';

// Única entrada de otros módulos a `groups` (D7). Es lo que consumirá `job-links` para saber si alguien puede ver un
// link de un grupo; ningún archivo de dominio, aplicación o infraestructura de otro módulo lee las colecciones de
// `groups` (lo comprueba el lint). Solo lecturas: crear, unirse o expulsar pasa por la API, no por aquí.

/** Grupo del usuario visto desde fuera del módulo: el identificador, el nombre, el rol y el ajuste, nada más. */
export interface UserGroupRef {
  readonly groupId: string;
  /** Lo necesita `links` para decir "ya lo tienes en Backend Bolivia" sin leer la colección de grupos. */
  readonly name: string;
  readonly role: GroupRole;
  /**
   * Si un link que entra en el grupo nace publicado (D3 de public-preview-share). Viaja aquí porque `links` ya pide los
   * grupos del usuario para `alreadyInGroups`: así lo obtiene **sin una lectura más**, y sigue sin leer las colecciones
   * de `groups`.
   */
  readonly defaultVisibility: GroupVisibility;
}

@Injectable()
export class GroupsFacade {
  constructor(
    @Inject(GROUP_REPOSITORY) private readonly groups: GroupRepository,
  ) {}

  /** `true` si el usuario es miembro del grupo, con cualquier rol. Un identificador mal formado responde `false`. */
  async isMember(groupId: string, userId: string): Promise<boolean> {
    return (await this.membershipOf(groupId, userId)) !== null;
  }

  /**
   * Rol del usuario en el grupo, o `null` si no es miembro, el grupo no existe o el identificador está mal formado. Lo
   * usa `links` para dejar que el `owner` quite un link que compartió otro, sin poder leer nada más de `groups`.
   */
  async membershipOf(groupId: string, userId: string): Promise<GroupRole | null> {
    const membership = await this.groups.findMembership(groupId, userId);
    return membership === null ? null : membership.role;
  }

  /**
   * Identificadores de los miembros del grupo. Lo usa `links` para saber a quién avisar de un link compartido ahí; no
   * salen nombres ni emails, que son de `users`. Un grupo que no existe devuelve una lista vacía.
   */
  async memberIdsOf(groupId: string): Promise<string[]> {
    const members = await this.groups.listMembers(groupId);
    return members.map((member) => member.userId);
  }

  /**
   * Grupos del usuario, del más reciente al más antiguo. Las membresías huérfanas no aparecen (D6), así que quien
   * filtre por esta lista nunca verá contenido de un grupo borrado.
   */
  async getGroupsOf(userId: string): Promise<UserGroupRef[]> {
    const memberships = await this.groups.listGroupsOfUser(userId);
    return memberships.map((membership) => ({
      groupId: membership.group.id,
      name: membership.group.name,
      role: membership.role,
      defaultVisibility: membership.group.defaultVisibility,
    }));
  }

  /**
   * `true` si el usuario es único owner de algún grupo con otros miembros (bloqueo del borrado de cuenta, D4).
   */
  async ownershipBlocksAccountDeletion(userId: string): Promise<boolean> {
    for (const membership of await this.getGroupsOf(userId)) {
      if (membership.role !== 'owner') {
        continue;
      }
      const members = await this.memberIdsOf(membership.groupId);
      if (members.length > 1) {
        return true;
      }
    }
    return false;
  }

  /**
   * Dentro de la txn del borrado de cuenta: borra grupos de los que es único miembro (vía
   * `deleteGroupInSession` + `GroupDeletionHooks`) y suelta el resto de membresías.
   */
  async detachUserInSession(
    userId: string,
    session: object,
  ): Promise<void> {
    const memberships = await this.getGroupsOf(userId);
    for (const membership of memberships) {
      if (membership.role === 'owner') {
        const result = await this.groups.deleteGroupInSession(
          membership.groupId,
          userId,
          session,
        );
        if (result !== 'deleted') {
          throw new Error(
            `Account deletion expected to delete owned group "${membership.groupId}" (${result})`,
          );
        }
        continue;
      }
      await this.groups.removeMembershipInSession(
        membership.groupId,
        userId,
        session,
      );
    }
  }
}
