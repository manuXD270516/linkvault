import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { DiscoveryBoard, DiscoveryHit, GroupSummary } from '@linkvault/shared';
import { isApiFailure } from '../../core/api/api-error';
import {
  DiscoveryStore,
  type DiscoverySaveOutcome,
} from '../../core/discovery/discovery.store';
import { GroupsStore } from '../../core/groups/groups.store';
import { RequestError } from '../../shared/ui/request-error';

/** Boards del selector V0 (D5 / ADR-043). */
const DISCOVERY_BOARDS: readonly DiscoveryBoard[] = ['all', 'getonboard', 'remoteok'];

/** Valor del mat-select para destino privado (ADR-045). */
const PRIVATE_DESTINATION = '';

/**
 * Pantalla de discovery (`/descubrir`, spec web/discovery, ADR-045). Busca en bolsas,
 * elige destino Privado|grupo a nivel de página y guarda hits con feedback explícito.
 */
@Component({
  selector: 'lv-discovery-page',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    RequestError,
  ],
  providers: [DiscoveryStore],
  templateUrl: './discovery.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscoveryPage implements OnInit {
  private readonly store = inject(DiscoveryStore);
  private readonly groupsStore = inject(GroupsStore);

  /** `true` tras al menos un intento de cargar grupos (éxito o fallo). */
  protected readonly groupsLoadAttempted = signal(false);

  protected readonly queryDraft = signal('');
  protected readonly boards = DISCOVERY_BOARDS;
  protected readonly privateDestination = PRIVATE_DESTINATION;

  protected readonly loading = this.store.loading;
  protected readonly searched = this.store.searched;
  protected readonly results = this.store.results;
  protected readonly isEmpty = this.store.isEmpty;
  protected readonly degraded = this.store.degraded;
  protected readonly failure = this.store.failure;
  protected readonly board = this.store.board;
  protected readonly saveDestination = this.store.saveDestination;
  protected readonly saveOutcomes = this.store.saveOutcomes;
  protected readonly savingUrls = this.store.savingUrls;

  protected readonly groups = this.groupsStore.groups;
  protected readonly groupsFailure = this.groupsStore.failure;

  protected readonly disabled = computed(() =>
    isApiFailure(this.failure(), 503, 'discovery_disabled'),
  );

  /** Selector usable aunque `loaded` sea false tras un fallo (ADR-045 D5b). */
  protected readonly destinationGroups = computed((): GroupSummary[] => this.groups());

  protected readonly showGroupsLoadWarning = computed(
    () => this.groupsLoadAttempted() && this.groupsFailure() !== null,
  );

  async ngOnInit(): Promise<void> {
    await this.groupsStore.load();
    this.groupsLoadAttempted.set(true);
    this.store.ensureDestinationAllowed(this.groups().map((group) => group.id));
  }

  protected onQueryDraft(value: string): void {
    this.queryDraft.set(value);
  }

  protected onBoardChange(value: DiscoveryBoard): void {
    this.store.setBoard(value);
  }

  protected onDestinationChange(value: string): void {
    this.store.setSaveDestination(value === PRIVATE_DESTINATION ? null : value);
  }

  /** Valor del select: `''` = privado. */
  protected destinationSelectValue(): string {
    return this.saveDestination() ?? PRIVATE_DESTINATION;
  }

  protected async submit(): Promise<void> {
    await this.store.run(this.queryDraft());
  }

  protected async save(hit: DiscoveryHit): Promise<void> {
    await this.store.save(hit);
  }

  protected outcomeFor(url: string): DiscoverySaveOutcome | null {
    return this.saveOutcomes()[url] ?? null;
  }

  protected isSaving(url: string): boolean {
    return this.savingUrls()[url] === true;
  }
}
