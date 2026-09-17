import type { GroupRole } from '@linkvault/shared';
import type { Clock } from '../ports/clock.port';
import type {
  GroupMembership,
  UserGroup,
} from '../ports/group-membership.port';
import type { LinkUserDirectory } from '../ports/link-user-directory.port';
import type { Outbox, OutboxEvent } from '../ports/outbox.port';
import type { TransactionSession } from '../ports/transaction-session';

// Dobles en memoria de los puertos pequeños de `links` para tests de application (D10 de job-links). No son adaptadores
// de producción: los reales viven en infrastructure. Ninguno emula el rollback de una transacción —para eso están los
// tests de integración—, pero sí el resto del contrato: identificadores mal formados, idempotencia y una sola consulta.

/** Sesión de mentira que reparten los dobles: solo tiene que ser el mismo objeto de principio a fin. */
export const IN_MEMORY_SESSION: TransactionSession = Object.freeze({
  inMemory: true,
});

export class MovableClock implements Clock {
  constructor(public current = new Date('2026-09-17T10:00:00.000Z')) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Outbox en memoria: acumula los eventos escritos, en orden, para que un test compruebe qué se encolará. */
export class InMemoryOutbox implements Outbox {
  private readonly events: { event: OutboxEvent; session: TransactionSession }[] =
    [];

  /** Eventos escritos, en orden. */
  get appended(): readonly OutboxEvent[] {
    return this.events.map((entry) => entry.event);
  }

  /** Cuántos eventos se escribieron; distingue "un evento por link" de "ninguno". */
  get size(): number {
    return this.events.length;
  }

  /** `true` si todos los eventos se escribieron con esa sesión, es decir, dentro de la transacción del alta. */
  allWrittenWith(session: TransactionSession): boolean {
    return this.events.every((entry) => entry.session === session);
  }

  append(event: OutboxEvent, session: TransactionSession): Promise<void> {
    this.events.push({ event, session });
    return Promise.resolve();
  }
}

/** Pertenencia en memoria: se declara quién está en qué grupo y con qué rol. Un id desconocido no es miembro de nada. */
export class InMemoryGroupMembership implements GroupMembership {
  private readonly groups = new Map<string, { name: string }>();
  private readonly roles = new Map<string, GroupRole>();
  /** Cuántas veces se preguntó por los grupos del usuario: lo usa el test que descarta el N+1 de `alreadyInGroups`. */
  groupsOfCalls = 0;

  /** Declara el nombre de un grupo, para `alreadyInGroups`. */
  withGroup(groupId: string, name: string): this {
    this.groups.set(groupId, { name });
    return this;
  }

  /** Declara la membresía de alguien en un grupo (y el grupo, si no estaba). */
  withMember(
    groupId: string,
    userId: string,
    role: GroupRole = 'member',
    name = 'Backend Bolivia',
  ): this {
    if (!this.groups.has(groupId)) {
      this.withGroup(groupId, name);
    }
    this.roles.set(keyOf(groupId, userId), role);
    return this;
  }

  membershipOf(groupId: string, userId: string): Promise<GroupRole | null> {
    return Promise.resolve(this.roles.get(keyOf(groupId, userId)) ?? null);
  }

  groupsOf(userId: string): Promise<UserGroup[]> {
    this.groupsOfCalls += 1;
    const groups: UserGroup[] = [];
    for (const [key, role] of this.roles) {
      const [groupId, member] = key.split('|');
      if (member !== userId || groupId === undefined) {
        continue;
      }
      groups.push({
        groupId,
        name: this.groups.get(groupId)?.name ?? '',
        role,
      });
    }
    return Promise.resolve(groups);
  }
}

/** Directorio de nombres visibles en memoria. Un id que nadie registró no aparece en el mapa, como el real. */
export class InMemoryLinkUserDirectory implements LinkUserDirectory {
  private readonly names = new Map<string, string>();
  /** Cuántas consultas se hicieron: un listado resuelve todos los nombres de la página de una vez. */
  calls = 0;

  set(userId: string, displayName: string): this {
    this.names.set(userId, displayName);
    return this;
  }

  displayNamesOf(userIds: readonly string[]): Promise<Map<string, string>> {
    this.calls += 1;
    const found = new Map<string, string>();
    for (const userId of new Set(userIds)) {
      const displayName = this.names.get(userId);
      if (displayName !== undefined) {
        found.set(userId, displayName);
      }
    }
    return Promise.resolve(found);
  }
}

function keyOf(groupId: string, userId: string): string {
  return `${groupId}|${userId}`;
}
