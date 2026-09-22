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
import { RouterLink } from '@angular/router';
import { SEARCH_DOC_TYPES, type SearchDocType, type SearchHit } from '@linkvault/shared';
import { isApiFailure } from '../../core/api/api-error';
import { GroupsStore } from '../../core/groups/groups.store';
import { SearchStore } from '../../core/search/search.store';
import { RequestError } from '../../shared/ui/request-error';
import { searchHitRoute } from './search-hit-route';

/**
 * Pantalla de búsqueda (`/buscar`, spec web/search, D8). Siempre hybrid (sin toggle de modo);
 * filtros solo `docType` + `groupId`.
 */
@Component({
  selector: 'lv-search-page',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    RequestError,
    RouterLink,
  ],
  providers: [SearchStore],
  templateUrl: './search.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchPage {
  private readonly store = inject(SearchStore);
  private readonly groups = inject(GroupsStore);

  protected readonly queryDraft = signal('');
  protected readonly emptyDraft = signal(false);

  protected readonly loading = this.store.loading;
  protected readonly searched = this.store.searched;
  protected readonly hits = this.store.hits;
  protected readonly isEmpty = this.store.isEmpty;
  protected readonly degraded = this.store.degraded;
  protected readonly failure = this.store.failure;
  protected readonly docType = this.store.docType;
  protected readonly groupId = this.store.groupId;
  protected readonly groupOptions = this.groups.groups;

  protected readonly docTypes = SEARCH_DOC_TYPES;

  protected readonly unavailable = computed(() =>
    isApiFailure(this.failure(), 503, 'search_unavailable'),
  );

  constructor() {
    void this.groups.load();
  }

  protected onQueryDraft(value: string): void {
    this.queryDraft.set(value);
    this.emptyDraft.set(false);
  }

  protected onDocTypeChange(value: SearchDocType | ''): void {
    this.store.setDocType(value === '' ? null : value);
  }

  protected onGroupChange(value: string | ''): void {
    this.store.setGroupId(value === '' ? null : value);
  }

  protected async submit(): Promise<void> {
    const trimmed = this.queryDraft().trim();
    if (trimmed.length === 0) {
      this.emptyDraft.set(true);
      return;
    }
    this.emptyDraft.set(false);
    await this.store.run(trimmed);
  }

  protected routeFor(hit: SearchHit): string | null {
    return searchHitRoute(hit);
  }
}
