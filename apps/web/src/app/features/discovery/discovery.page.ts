import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { DiscoveryBoard, DiscoveryHit } from '@linkvault/shared';
import { isApiFailure } from '../../core/api/api-error';
import {
  DiscoveryStore,
  type DiscoverySaveOutcome,
} from '../../core/discovery/discovery.store';
import { RequestError } from '../../shared/ui/request-error';

/** Boards del selector V0 (D5 / ADR-043). */
const DISCOVERY_BOARDS: readonly DiscoveryBoard[] = ['all', 'getonboard', 'remoteok'];

/**
 * Pantalla de discovery (`/descubrir`, spec web/discovery, D4 / D5). Busca en bolsas, muestra
 * degradación y guarda hits en la lista privada con feedback explícito.
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
export class DiscoveryPage {
  private readonly store = inject(DiscoveryStore);

  protected readonly queryDraft = signal('');
  protected readonly boards = DISCOVERY_BOARDS;

  protected readonly loading = this.store.loading;
  protected readonly searched = this.store.searched;
  protected readonly results = this.store.results;
  protected readonly isEmpty = this.store.isEmpty;
  protected readonly degraded = this.store.degraded;
  protected readonly failure = this.store.failure;
  protected readonly board = this.store.board;
  protected readonly saveOutcomes = this.store.saveOutcomes;
  protected readonly savingUrls = this.store.savingUrls;

  protected readonly disabled = computed(() =>
    isApiFailure(this.failure(), 503, 'discovery_disabled'),
  );

  protected onQueryDraft(value: string): void {
    this.queryDraft.set(value);
  }

  protected onBoardChange(value: DiscoveryBoard): void {
    this.store.setBoard(value);
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
