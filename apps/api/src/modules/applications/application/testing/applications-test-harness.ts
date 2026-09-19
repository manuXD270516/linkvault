import { ChangeApplicationStatus } from '../change-application-status.usecase';
import { GetApplicationTimeline } from '../get-application-timeline.usecase';
import { ListGroupTrackers } from '../list-group-trackers.usecase';
import { ListMyApplications } from '../list-my-applications.usecase';
import { TrackLink } from '../track-link.usecase';
import { UntrackApplication } from '../untrack-application.usecase';
import { UpdateApplication } from '../update-application.usecase';
import {
  InMemoryApplicationGroups,
  InMemoryApplicationLinks,
  InMemoryApplicationUserDirectory,
  MovableClock,
} from './applications-test-doubles';
import { InMemoryApplicationRepository } from './in-memory-application.repository';

// Casos de uso de `applications` montados sobre el repositorio en memoria y los dobles de sus puertos, para los tests
// unitarios (D12 de applications-tracking). Cada test crea el suyo.

export interface ApplicationsHarness {
  readonly clock: MovableClock;
  readonly repository: InMemoryApplicationRepository;
  readonly links: InMemoryApplicationLinks;
  readonly groups: InMemoryApplicationGroups;
  readonly directory: InMemoryApplicationUserDirectory;
  readonly trackLink: TrackLink;
  readonly changeStatus: ChangeApplicationStatus;
  readonly update: UpdateApplication;
  readonly timeline: GetApplicationTimeline;
  readonly untrack: UntrackApplication;
  readonly listMine: ListMyApplications;
  readonly trackers: ListGroupTrackers;
}

export function applicationsHarness(): ApplicationsHarness {
  const clock = new MovableClock();
  const repository = new InMemoryApplicationRepository();
  const links = new InMemoryApplicationLinks();
  const groups = new InMemoryApplicationGroups();
  const directory = new InMemoryApplicationUserDirectory();
  return {
    clock,
    repository,
    links,
    groups,
    directory,
    trackLink: new TrackLink(repository, links, clock),
    changeStatus: new ChangeApplicationStatus(repository, links, clock),
    update: new UpdateApplication(repository, links, clock),
    timeline: new GetApplicationTimeline(repository),
    untrack: new UntrackApplication(repository),
    listMine: new ListMyApplications(repository, links),
    trackers: new ListGroupTrackers(groups, links, repository, directory),
  };
}

/** Identificador con la forma de un ObjectId a partir de un número. */
export function objectId(value: number): string {
  return value.toString(16).padStart(24, '0');
}
