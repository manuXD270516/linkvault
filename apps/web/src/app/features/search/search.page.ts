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
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import {
  APPLICATION_STATUSES,
  SEARCH_DOC_TYPES,
  type ApplicationStatus,
  type JobModality,
  type SearchDocType,
  type SearchHit,
} from '@linkvault/shared';
import { isApiFailure } from '../../core/api/api-error';
import { GroupsStore } from '../../core/groups/groups.store';
import {
  SearchStore,
  type SearchSalaryCurrency,
} from '../../core/search/search.store';
import { RequestError } from '../../shared/ui/request-error';
import { searchHitRoute } from './search-hit-route';

const JOB_MODALITIES: readonly JobModality[] = [
  'remote',
  'hybrid',
  'onsite',
  'unknown',
];

const SALARY_CURRENCIES: readonly SearchSalaryCurrency[] = ['BOB', 'USD'];

/**
 * Pantalla de búsqueda (`/buscar`, spec web/search, D8 / D3 / D4). Siempre hybrid (sin toggle de
 * modo); filtros `docType`, `groupId`, LatAm, rango salarial y `openOnly` con D3b bidireccional.
 */
@Component({
  selector: 'lv-search-page',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
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
  protected readonly modality = this.store.modality;
  protected readonly applicationStatus = this.store.applicationStatus;
  protected readonly salaryCurrency = this.store.salaryCurrency;
  protected readonly openOnly = this.store.openOnly;
  protected readonly minSalary = this.store.minSalary;
  protected readonly maxSalary = this.store.maxSalary;
  protected readonly groupOptions = this.groups.groups;

  protected readonly docTypes = SEARCH_DOC_TYPES;
  protected readonly modalities = JOB_MODALITIES;
  protected readonly applicationStatuses = APPLICATION_STATUSES;
  protected readonly salaryCurrencies = SALARY_CURRENCIES;

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

  protected onModalityChange(value: JobModality | ''): void {
    this.store.setModality(value === '' ? null : value);
  }

  protected onApplicationStatusChange(value: ApplicationStatus | ''): void {
    this.store.setApplicationStatus(value === '' ? null : value);
  }

  protected onSalaryCurrencyChange(value: SearchSalaryCurrency | ''): void {
    this.store.setSalaryCurrency(value === '' ? null : value);
  }

  protected onOpenOnlyChange(checked: boolean): void {
    this.store.setOpenOnly(checked);
  }

  protected onMinSalaryChange(raw: number | string | null): void {
    this.store.setMinSalary(parseSalaryInput(raw));
  }

  protected onMaxSalaryChange(raw: number | string | null): void {
    this.store.setMaxSalary(parseSalaryInput(raw));
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

/** Vacío → null; entero ≥ 0 → número; basura / negativo / decimal → null (no envía el filtro). */
function parseSalaryInput(raw: number | string | null): number | null {
  if (raw === null || raw === '') {
    return null;
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0 || !Number.isInteger(raw)) {
      return null;
    }
    return raw;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || !/^\d+$/.test(trimmed)) {
    return null;
  }
  return Number(trimmed);
}
