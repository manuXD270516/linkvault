import type {
  GroupLinkCommentsChangedPayload,
  GroupLinkCommentsMessage,
  GroupRole,
  GroupVisibility,
  JobLinkSummary,
  LinkEnrichedPayload,
} from '@linkvault/shared';
import type { Clock } from '../ports/clock.port';
import type { CommentsBroadcaster } from '../ports/comments-broadcaster.port';
import type { CommentsChangedPublisher } from '../ports/comments-changed-publisher.port';
import type { EnrichmentBroadcaster } from '../ports/enrichment-broadcaster.port';
import type {
  GroupMembership,
  UserGroup,
} from '../ports/group-membership.port';
import type {
  LinkLimitDecision,
  LinkLimitKey,
  LinkLimiter,
} from '../ports/link-limiter.port';
import type {
  LinkUserAiConsent,
  LinkUserDirectory,
} from '../ports/link-user-directory.port';
import type { LinkEnrichedPublisher } from '../ports/link-enriched-publisher.port';
import type { Outbox, OutboxEvent } from '../../../../infrastructure/outbox/outbox.port';
import type { PublicUrls } from '../ports/public-urls.port';
import type {
  PastedExtraction,
  PastedExtractionPort,
  PastedExtractionRequest,
} from '../ports/pasted-extraction.port';
import type { TransactionSession } from '../../../../infrastructure/outbox/transaction-session';

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
  private readonly events: {
    event: OutboxEvent;
    session: TransactionSession;
  }[] = [];

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

/**
 * URLs públicas de un test (D5 de public-preview-share): los mismos orígenes que `.env.example`, para que un test pueda
 * comprobar la URL entera sin levantar la configuración.
 */
export class TestPublicUrls implements PublicUrls {
  constructor(
    private readonly pageBaseUrl = 'http://localhost:3000',
    readonly webBaseUrl = 'http://localhost:4200',
  ) {}

  pageUrlOf(slug: string): string {
    return `${this.pageBaseUrl}/p/${slug}`;
  }

  webUrlOf(slug: string): string {
    return `${this.webBaseUrl}/oferta/${slug}`;
  }
}

/** Pertenencia en memoria: se declara quién está en qué grupo y con qué rol. Un id desconocido no es miembro de nada. */
export class InMemoryGroupMembership implements GroupMembership {
  private readonly groups = new Map<
    string,
    { name: string; defaultVisibility: GroupVisibility }
  >();
  private readonly roles = new Map<string, GroupRole>();
  /** Cuántas veces se preguntó por los grupos del usuario: lo usa el test que descarta el N+1 de `alreadyInGroups`. */
  groupsOfCalls = 0;

  /** Declara el nombre de un grupo, para `alreadyInGroups`, y si lo que entra en él nace publicado (D3). */
  withGroup(
    groupId: string,
    name: string,
    defaultVisibility: GroupVisibility = 'public',
  ): this {
    this.groups.set(groupId, { name, defaultVisibility });
    return this;
  }

  /** Cambia la visibilidad por defecto de un grupo ya declarado, como hace el owner con su ajuste. */
  withDefaultVisibility(
    groupId: string,
    defaultVisibility: GroupVisibility,
  ): this {
    const group = this.groups.get(groupId);
    this.groups.set(groupId, {
      name: group?.name ?? 'Backend Bolivia',
      defaultVisibility,
    });
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

  /** Saca a alguien del grupo, como salir o ser expulsado. */
  withoutMember(groupId: string, userId: string): this {
    this.roles.delete(keyOf(groupId, userId));
    return this;
  }

  /** Cuántas veces se preguntó por los miembros: lo usa el test de las lecturas fijas (D7 de group-comments). */
  memberIdsOfCalls = 0;
  membershipOfCalls = 0;

  membershipOf(groupId: string, userId: string): Promise<GroupRole | null> {
    this.membershipOfCalls += 1;
    return Promise.resolve(this.roles.get(keyOf(groupId, userId)) ?? null);
  }

  memberIdsOf(groupIds: readonly string[]): Promise<string[]> {
    this.memberIdsOfCalls += 1;
    const members = new Set<string>();
    for (const key of this.roles.keys()) {
      const [groupId, userId] = key.split('|');
      if (
        groupId !== undefined &&
        userId !== undefined &&
        groupIds.includes(groupId)
      ) {
        members.add(userId);
      }
    }
    return Promise.resolve([...members]);
  }

  groupsOf(userId: string): Promise<UserGroup[]> {
    this.groupsOfCalls += 1;
    const groups: UserGroup[] = [];
    for (const [key, role] of this.roles) {
      const [groupId, member] = key.split('|');
      if (member !== userId || groupId === undefined) {
        continue;
      }
      const group = this.groups.get(groupId);
      groups.push({
        groupId,
        name: group?.name ?? '',
        role,
        defaultVisibility: group?.defaultVisibility ?? 'public',
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

  /** Usuarios que aceptaron enviar sus datos a proveedores externos; los demás no. */
  private readonly consenting = new Set<string>();

  withConsent(userId: string): this {
    this.consenting.add(userId);
    return this;
  }

  private consentDown = false;

  /** Simula que el perfil no se puede leer (Mongo caído): `aiConsentOf` rechaza. */
  failConsent(): this {
    this.consentDown = true;
    return this;
  }

  aiConsentOf(userId: string): Promise<LinkUserAiConsent> {
    if (this.consentDown) {
      return Promise.reject(new Error('The user profile could not be read'));
    }
    return Promise.resolve({ externalProviders: this.consenting.has(userId) });
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

/**
 * Limitador en memoria con las mismas reglas que `CounterLinkLimiter`: ventana fija por clave y conteo antes de actuar.
 * `unavailable` simula que el contador no responde, para probar que la importación falla abierta y la relectura cerrada
 * **en el adaptador**, no aquí: este doble solo deja elegir la respuesta.
 */
export class InMemoryLinkLimiter implements LinkLimiter {
  /** Claves consumidas, en orden, para comprobar qué contó un caso de uso. */
  readonly consumed: LinkLimitKey[] = [];
  private readonly counters = new Map<string, number>();
  private readonly limits = new Map<string, number>();

  constructor(private readonly defaultLimit = Number.MAX_SAFE_INTEGER) {}

  /** Fija el límite de una clave concreta, para agotar una ventana sin repetir llamadas. */
  withLimit(key: LinkLimitKey, limit: number): this {
    this.limits.set(nameOfLimit(key), limit);
    return this;
  }

  /** Deja la clave sin cupo ya consumido, como si la ventana estuviera agotada. */
  exhaust(key: LinkLimitKey): this {
    this.limits.set(nameOfLimit(key), 0);
    return this;
  }

  /** Claves devueltas, en orden. */
  readonly refunded: LinkLimitKey[] = [];
  private down = false;

  /** Simula el contador caído con la respuesta que da el adaptador para un límite que falla cerrado y lo dice. */
  goDown(): this {
    this.down = true;
    return this;
  }

  /** Como `giveBack` del contador: baja sin pasar de cero. */
  refund(key: LinkLimitKey): Promise<void> {
    this.refunded.push(key);
    const name = nameOfLimit(key);
    this.counters.set(name, Math.max(0, (this.counters.get(name) ?? 0) - 1));
    return Promise.resolve();
  }

  consume(key: LinkLimitKey): Promise<LinkLimitDecision> {
    this.consumed.push(key);
    if (this.down) {
      return Promise.resolve({
        allowed: false,
        retryAfterSeconds: 60,
        unavailable: true,
      });
    }
    const name = nameOfLimit(key);
    const count = (this.counters.get(name) ?? 0) + 1;
    this.counters.set(name, count);
    const limit = this.limits.get(name) ?? this.defaultLimit;
    return Promise.resolve(
      count <= limit
        ? { allowed: true, retryAfterSeconds: 0 }
        : { allowed: false, retryAfterSeconds: 900 },
    );
  }
}

function nameOfLimit(key: LinkLimitKey): string {
  switch (key.kind) {
    case 'enrich-link':
      return `enrich-link:${key.linkId}`;
    case 'import':
      return `import:${key.userId}`;
    case 'paste-description':
      return `paste-description:${key.userId}`;
    case 'comment':
      return `comment:${key.userId}`;
    case 'public-page':
      return 'public-page';
    case 'public-preview':
      return 'public-preview';
    case 'public-page-slug':
      return `public-page:${key.slug}`;
  }
}

/**
 * Canal de salida en memoria: apunta qué link se envió a quién y permite declarar que no hay nadie escuchando, que es
 * el caso normal cuando el worker trabaja de madrugada.
 */
export class InMemoryEnrichmentBroadcaster implements EnrichmentBroadcaster {
  /** Envíos, en orden, para comprobar a quién se avisó y con qué. */
  readonly sent: { userId: string; link: JobLinkSummary }[] = [];
  private listening = true;

  /** Deja el canal sin ninguna conexión abierta. */
  withoutListeners(): this {
    this.listening = false;
    return this;
  }

  hasListeners(): boolean {
    return this.listening;
  }

  send(userId: string, link: JobLinkSummary): number {
    this.sent.push({ userId, link });
    return 1;
  }

  /** A quién se avisó, sin repetir y en orden de aviso. */
  get recipients(): string[] {
    return [...new Set(this.sent.map((entry) => entry.userId))];
  }
}

/**
 * Publicador de avisos en memoria: apunta lo publicado. Con `hang()`, publicar no termina nunca, que es como se prueba
 * que quien publica no espera a que termine; con `fail()`, falla como un Redis caído.
 */
export class InMemoryLinkEnrichedPublisher implements LinkEnrichedPublisher {
  readonly published: LinkEnrichedPayload[] = [];
  private mode: 'up' | 'hang' | 'fail' = 'up';

  hang(): this {
    this.mode = 'hang';
    return this;
  }

  fail(): this {
    this.mode = 'fail';
    return this;
  }

  publish(payload: LinkEnrichedPayload): Promise<void> {
    this.published.push(payload);
    switch (this.mode) {
      case 'up':
        return Promise.resolve();
      case 'hang':
        return new Promise<void>(() => undefined);
      case 'fail':
        return Promise.reject(new Error('Connection is closed.'));
    }
  }
}

/** Lectura del texto pegado que responde lo que se le diga, y apunta qué se le pidió. */
export class FakePastedExtraction implements PastedExtractionPort {
  readonly requests: PastedExtractionRequest[] = [];

  constructor(private answer: PastedExtraction = { outcome: 'unavailable' }) {}

  answering(answer: PastedExtraction): this {
    this.answer = answer;
    return this;
  }

  extract(request: PastedExtractionRequest): Promise<PastedExtraction> {
    this.requests.push(request);
    return Promise.resolve(this.answer);
  }
}

/**
 * Publicador de avisos de comentarios en memoria: apunta lo publicado. Con `hang()`, publicar no termina nunca, que es
 * como se prueba que el caso de uso no espera al aviso; con `fail()`, falla como un Redis caído.
 */
export class InMemoryCommentsChangedPublisher
  implements CommentsChangedPublisher
{
  readonly published: GroupLinkCommentsChangedPayload[] = [];
  private mode: 'up' | 'hang' | 'fail' = 'up';

  hang(): this {
    this.mode = 'hang';
    return this;
  }

  fail(): this {
    this.mode = 'fail';
    return this;
  }

  publish(payload: GroupLinkCommentsChangedPayload): Promise<void> {
    this.published.push(payload);
    switch (this.mode) {
      case 'up':
        return Promise.resolve();
      case 'hang':
        return new Promise<void>(() => undefined);
      case 'fail':
        return Promise.reject(new Error('Connection is closed.'));
    }
  }
}

/** Canal de salida de los avisos de comentarios en memoria: apunta qué se envió a quién. */
export class InMemoryCommentsBroadcaster implements CommentsBroadcaster {
  readonly sent: { userId: string; message: GroupLinkCommentsMessage }[] = [];
  private listening = true;

  /** Deja el canal sin ninguna conexión abierta. */
  withoutListeners(): this {
    this.listening = false;
    return this;
  }

  hasListeners(): boolean {
    return this.listening;
  }

  send(userId: string, message: GroupLinkCommentsMessage): number {
    this.sent.push({ userId, message });
    return 1;
  }

  /** A quién se avisó, sin repetir y en orden de aviso. */
  get recipients(): string[] {
    return [...new Set(this.sent.map((entry) => entry.userId))];
  }
}
