import type {
  Application,
  EditWrite,
  StartedTracking,
  StatusWrite,
} from '../../domain/application.entity';
import type {
  ApplicationEvent,
  NewApplicationEvent,
} from '../../domain/application-event';
import { isApplicationId, isLinkId, isUserId } from '../../domain/identifier';
import type {
  ApplicationRepository,
  SharedApplication,
  TrackResult,
} from '../ports/application-repository.port';

// Repositorio de postulaciones en memoria para tests de application (D12 de applications-tracking). No es un adaptador
// de producción: el real es `MongoApplicationRepository`. Impone lo mismo que él —único `(userId, linkId)`, escritura
// del estado condicionada por `version` con el evento solo si casa, borrado con sus eventos y el mismo predicado de
// identificador—, para que un caso de uso probado aquí se comporte igual contra Mongo. Devuelve copias: un test no
// altera el estado por accidente.

export class InMemoryApplicationRepository implements ApplicationRepository {
  private readonly applications = new Map<string, Application>();
  private readonly events: ApplicationEvent[] = [];
  private nextId = 1;

  /** Cuántas veces se leyeron postulaciones compartidas: lo usa el test de las lecturas fijas (D6). */
  sharedOnCalls = 0;

  /** Todas las postulaciones guardadas, en orden de alta. */
  get all(): Application[] {
    return [...this.applications.values()].map((application) =>
      structuredClone(application),
    );
  }

  /** Todos los eventos guardados, de cualquier postulación. */
  get allEvents(): ApplicationEvent[] {
    return this.events.map((event) => structuredClone(event));
  }

  create(tracking: StartedTracking): Promise<TrackResult> {
    const existing = [...this.applications.values()].find(
      (application) =>
        application.userId === tracking.application.userId &&
        application.linkId === tracking.application.linkId,
    );
    if (existing !== undefined) {
      return Promise.resolve({
        application: structuredClone(existing),
        created: false,
      });
    }
    const application: Application = {
      ...tracking.application,
      id: this.newId(),
    };
    this.applications.set(application.id, application);
    this.appendEvent(application, tracking.event);
    return Promise.resolve({
      application: structuredClone(application),
      created: true,
    });
  }

  findOwned(
    applicationId: string,
    userId: string,
  ): Promise<Application | null> {
    const application = this.owned(applicationId, userId);
    return Promise.resolve(application ? structuredClone(application) : null);
  }

  changeStatus(
    applicationId: string,
    userId: string,
    write: StatusWrite,
    event: NewApplicationEvent,
  ): Promise<boolean> {
    const application = this.owned(applicationId, userId);
    // Misma condición que el adaptador real: sin postulación o con otra versión no se escribe nada, tampoco el evento.
    if (
      application === undefined ||
      application.version !== write.expectedVersion
    ) {
      return Promise.resolve(false);
    }
    const { stageLabel: _stage, appliedAt: _appliedAt, ...rest } = application;
    const updated: Application = {
      ...rest,
      status: write.status,
      ...(write.stageLabel === undefined
        ? {}
        : { stageLabel: write.stageLabel }),
      ...(write.appliedAt === undefined ? {} : { appliedAt: write.appliedAt }),
      statusChangedAt: write.statusChangedAt,
      updatedAt: write.updatedAt,
      version: application.version + 1,
    };
    this.applications.set(updated.id, updated);
    this.appendEvent(updated, event);
    return Promise.resolve(true);
  }

  update(
    applicationId: string,
    userId: string,
    write: EditWrite,
  ): Promise<Application | null> {
    const application = this.owned(applicationId, userId);
    if (application === undefined) {
      return Promise.resolve(null);
    }
    const updated: Application = {
      ...application,
      ...(write.notes === undefined ? {} : { notes: write.notes }),
      ...(write.visibility === undefined
        ? {}
        : { visibility: write.visibility }),
      updatedAt: write.updatedAt,
    };
    this.applications.set(updated.id, updated);
    return Promise.resolve(structuredClone(updated));
  }

  delete(applicationId: string, userId: string): Promise<boolean> {
    const application = this.owned(applicationId, userId);
    if (application === undefined) {
      return Promise.resolve(false);
    }
    this.applications.delete(application.id);
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      if (this.events[index]?.applicationId === application.id) {
        this.events.splice(index, 1);
      }
    }
    return Promise.resolve(true);
  }

  listByUser(
    userId: string,
    linkIds?: readonly string[],
  ): Promise<Application[]> {
    if (!isUserId(userId)) {
      return Promise.resolve([]);
    }
    const wanted =
      linkIds === undefined
        ? undefined
        : new Set(linkIds.filter((linkId) => isLinkId(linkId)));
    const found = [...this.applications.values()]
      .filter((application) => application.userId === userId)
      .filter(
        (application) => wanted === undefined || wanted.has(application.linkId),
      )
      // Mismo orden que el adaptador real: `updatedAt` y `_id` descendentes.
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() ||
          right.id.localeCompare(left.id),
      );
    return Promise.resolve(
      found.map((application) => structuredClone(application)),
    );
  }

  eventsOf(applicationId: string, userId: string): Promise<ApplicationEvent[]> {
    if (!isApplicationId(applicationId) || !isUserId(userId)) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      this.events
        .filter(
          (event) =>
            event.applicationId === applicationId && event.userId === userId,
        )
        .sort(
          (left, right) =>
            left.at.getTime() - right.at.getTime() ||
            left.id.localeCompare(right.id),
        )
        .map((event) => structuredClone(event)),
    );
  }

  sharedOn(
    linkIds: readonly string[],
    memberIds: readonly string[],
  ): Promise<SharedApplication[]> {
    this.sharedOnCalls += 1;
    const links = new Set(linkIds);
    const members = new Set(memberIds);
    return Promise.resolve(
      [...this.applications.values()]
        .filter(
          (application) =>
            application.visibility === 'group' &&
            links.has(application.linkId) &&
            members.has(application.userId),
        )
        .map((application) => ({
          linkId: application.linkId,
          userId: application.userId,
          status: application.status,
          statusChangedAt: new Date(application.statusChangedAt),
        })),
    );
  }

  /** Cambia una postulación guardada como lo haría otra escritura, sin evento ni reglas. Solo para preparar tests. */
  overwrite(applicationId: string, changes: Partial<Application>): void {
    const application = this.applications.get(applicationId);
    if (application === undefined) {
      throw new Error(`No application ${applicationId} to overwrite`);
    }
    this.applications.set(applicationId, { ...application, ...changes });
  }

  private owned(
    applicationId: string,
    userId: string,
  ): Application | undefined {
    if (!isApplicationId(applicationId) || !isUserId(userId)) {
      return undefined;
    }
    const application = this.applications.get(applicationId);
    return application?.userId === userId ? application : undefined;
  }

  private appendEvent(
    application: Application,
    event: NewApplicationEvent,
  ): void {
    this.events.push({
      ...event,
      id: this.newId(),
      applicationId: application.id,
      userId: application.userId,
    });
  }

  private newId(): string {
    const id = this.nextId.toString(16).padStart(24, '0');
    this.nextId += 1;
    return id;
  }
}
