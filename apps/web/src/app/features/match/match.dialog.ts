import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Router } from '@angular/router';
import {
  MATCH_PROGRESS_STEPS,
  type JobLinkSummary,
  type MatchProgressStep,
  type MatchReport,
  type MatchSuggestion,
  type MissingSkill,
} from '@linkvault/shared';
import { isApiFailure } from '../../core/api/api-error';
import { SessionStore } from '../../core/auth/session.store';
import { CvStore } from '../../core/cv/cv.store';
import { MatchStore } from '../../core/match/match.store';
import {
  PasteDescriptionDialog,
  type PasteDescriptionDialogData,
} from '../links/paste-description.dialog';
import { MatchBadge } from './match-badge.component';
import { matchProgressStepLabel } from './match-labels';
import {
  formatRetryAtPhrase,
  retryAtFromMinutes,
} from './match-retry-at';
import {
  MATCH_SUGGESTIONS_PAGE_SIZE,
  sortSuggestionsByEvidence,
} from './sort-suggestions';

/** Datos que necesita el diálogo; la tarjeta de oferta los rellena al abrirlo (tarea 16.16). */
export interface MatchDialogData {
  linkId: string;
  jobTitle: string;
  /** Link completo para "Pegar la descripción" cuando la oferta aún no se ha leído. */
  link: JobLinkSummary;
}

/**
 * Resultado al cerrar: quien abre (tarjeta) puede reabrir tras `/mi-cv` o `/perfil` sin disparar análisis
 * (spec web/cv-match, tarea 15.4 / 16.16).
 */
export type MatchDialogResult =
  | { kind: 'change-cv' }
  | { kind: 'give-consent' }
  | undefined;

/** Ancho del diálogo de encaje. */
export const MATCH_DIALOG_SIZE = {
  width: 'min(560px, 95vw)',
  maxWidth: '100vw',
  maxHeight: '90vh',
} as const;

/**
 * Diálogo "Tu encaje con esta oferta" (D13–D14, ADR-030 §11, spec web/cv-match).
 *
 * **No pide análisis al abrirse**: carga el estado (GET) y el CV marcado, enseña por dónde saldrá el CV y espera a
 * "Analizar". El store vive aquí: cerrar destruye el sondeo.
 */
@Component({
  selector: 'lv-match-dialog',
  imports: [MatButtonModule, MatDialogModule, MatchBadge],
  providers: [MatchStore, CvStore],
  templateUrl: './match.dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MatchDialog {
  private readonly match = inject(MatchStore);
  private readonly cvs = inject(CvStore);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly dialogRef =
    inject<MatDialogRef<MatchDialog, MatchDialogResult>>(MatDialogRef);
  private readonly data = inject<MatchDialogData>(MAT_DIALOG_DATA);

  protected readonly jobTitle = this.data.jobTitle;
  protected readonly progressSteps = MATCH_PROGRESS_STEPS;

  /** Confirmación breve tras "Copiar"; no se persiste. */
  protected readonly copiedId = signal<string | null>(null);
  /** Índices del informe final ya marcados «no me convence» en esta sesión del diálogo. */
  protected readonly notConvincedIndexes = signal<ReadonlySet<number>>(new Set());
  /** Índice en vuelo de «no me convence», o `null`. */
  protected readonly notConvincedPending = signal<number | null>(null);
  /** `true` tras "Ver las N restantes": enseña todas sin reordenar ni pedir de nuevo. */
  protected readonly suggestionsExpanded = signal(false);

  protected readonly consent = computed(() => this.session.consentIsCurrent());
  protected readonly consentLoading = computed(() => this.session.consentLoading());

  protected readonly defaultCv = computed(() => this.cvs.defaultCv());
  protected readonly cvFileName = computed(() => this.defaultCv()?.fileName ?? null);

  protected readonly loading = computed(() => this.match.loading() || (!this.cvs.loaded() && this.cvs.loading()));
  protected readonly requesting = computed(() => this.match.requesting());
  protected readonly isRunning = computed(() => this.match.isRunning());
  protected readonly stalled = computed(() => this.match.stalled());
  protected readonly report = computed(() => this.match.report());
  protected readonly latest = computed(() => this.match.latest());
  protected readonly failure = computed(() => this.match.failure());
  protected readonly failureCode = computed(() => this.match.failureCode());
  protected readonly stale = computed(() => this.match.stale());
  protected readonly cvChanged = computed(() => this.match.cvChanged());
  protected readonly consentRequired = computed(() => this.match.consentRequired());
  protected readonly completedSteps = computed(() => this.match.completedSteps());
  protected readonly pendingSteps = computed(() => this.match.pendingSteps());
  protected readonly step = computed(() => this.match.step());
  protected readonly aiQuotaRetryAt = computed(() => this.match.aiQuotaRetryAt());

  /** Nombre del CV con el que se hizo el informe, si ya no es el marcado. */
  protected readonly analyzedCvFileName = computed((): string | null => {
    const latest = this.latest();
    if (latest === null || !this.cvChanged()) {
      return null;
    }
    return this.cvs.items().find((item) => item.id === latest.cvId)?.fileName ?? null;
  });

  protected readonly mustMissing = computed((): MissingSkill[] => {
    const report = this.report();
    return report?.missingSkills.filter((skill) => skill.importance === 'must') ?? [];
  });

  protected readonly niceMissing = computed((): MissingSkill[] => {
    const report = this.report();
    return report?.missingSkills.filter((skill) => skill.importance === 'nice') ?? [];
  });

  protected readonly sortedSuggestions = computed((): MatchSuggestion[] => {
    const report = this.report();
    if (report === null || report.degraded) {
      return [];
    }
    return sortSuggestionsByEvidence(report.suggestions);
  });

  protected readonly visibleSuggestions = computed((): MatchSuggestion[] => {
    const all = this.sortedSuggestions();
    if (this.suggestionsExpanded() || all.length <= MATCH_SUGGESTIONS_PAGE_SIZE) {
      return all;
    }
    return all.slice(0, MATCH_SUGGESTIONS_PAGE_SIZE);
  });

  protected readonly remainingSuggestions = computed((): number => {
    const total = this.sortedSuggestions().length;
    if (this.suggestionsExpanded() || total <= MATCH_SUGGESTIONS_PAGE_SIZE) {
      return 0;
    }
    return total - MATCH_SUGGESTIONS_PAGE_SIZE;
  });

  /** Fallo propio del análisis (no el genérico de RequestError). */
  protected readonly matchProblem = computed(() => {
    const failure = this.failure();
    if (failure === null) {
      return null;
    }
    if (isApiFailure(failure, 422, 'job_not_ready')) {
      return { kind: 'job_not_ready' as const };
    }
    if (isApiFailure(failure, 422, 'no_cv')) {
      return { kind: 'no_cv' as const };
    }
    if (isApiFailure(failure, 422, 'cv_not_ready')) {
      return { kind: 'cv_not_ready' as const };
    }
    if (isApiFailure(failure, 422, 'cv_not_readable')) {
      return { kind: 'cv_not_readable' as const };
    }
    if (failure.kind === 'api' && failure.status === 429) {
      const minutes = failure.retryAfterMinutes ?? 1;
      return {
        kind: 'rate_limit' as const,
        phrase: formatRetryAtPhrase(retryAtFromMinutes(minutes)),
      };
    }
    if (
      failure.kind === 'offline' ||
      failure.kind === 'unknown' ||
      (failure.kind === 'api' && failure.status >= 500)
    ) {
      return { kind: 'server' as const };
    }
    return { kind: 'server' as const };
  });

  protected readonly latestFailed = computed(
    () => this.latest()?.status === 'failed' && this.failureCode() === 'internal_error',
  );

  protected readonly degradedReason = computed(
    () => this.report()?.degradedReason ?? null,
  );

  protected readonly quotaRetryPhrase = computed((): string | null => {
    const at = this.aiQuotaRetryAt() ?? this.report()?.aiQuotaRetryAt;
    return at === undefined || at === null ? null : formatRetryAtPhrase(at);
  });

  /**
   * Fase principal de la UI. El informe solo se enseña cuando no hay análisis en curso (el anterior se conserva en
   * el store, pero la espera manda mientras corre uno nuevo).
   */
  protected readonly phase = computed(() => {
    if (this.consent() === 'unknown' && !this.consentLoading()) {
      return 'consent_unknown' as const;
    }
    if (this.consentLoading()) {
      return 'consent_checking' as const;
    }
    if (this.matchProblem()?.kind === 'job_not_ready') {
      return 'job_not_ready' as const;
    }
    if (this.matchProblem()?.kind === 'no_cv') {
      return 'no_cv' as const;
    }
    if (this.matchProblem()?.kind === 'cv_not_ready') {
      return 'cv_not_ready' as const;
    }
    if (this.matchProblem()?.kind === 'cv_not_readable') {
      return 'cv_not_readable' as const;
    }
    if (this.matchProblem()?.kind === 'rate_limit') {
      return 'rate_limit' as const;
    }
    if (this.matchProblem()?.kind === 'server' || this.latestFailed()) {
      return 'server_error' as const;
    }
    if (this.stalled()) {
      return 'stalled' as const;
    }
    if (this.isRunning() || this.requesting()) {
      return 'running' as const;
    }
    if (this.report() !== null) {
      return 'report' as const;
    }
    if (this.loading()) {
      return 'loading' as const;
    }
    return 'idle' as const;
  });

  /** Analizar solo con permiso conocido (vigente o no). */
  protected readonly canAnalyze = computed(
    () =>
      this.consent() !== 'unknown' &&
      !this.consentLoading() &&
      !this.isRunning() &&
      !this.requesting(),
  );

  constructor() {
    void this.bootstrap();
  }

  /**
   * Carga el estado del análisis y la lista de CV. **No** llama a `request`: abrir no manda el CV a ningún sitio
   * (ADR-030 §11).
   */
  private async bootstrap(): Promise<void> {
    await Promise.all([this.match.load(this.data.linkId), this.cvs.load()]);
  }

  protected stepLabel(step: MatchProgressStep): string {
    return matchProgressStepLabel(step);
  }

  protected isStepDone(step: MatchProgressStep): boolean {
    return this.completedSteps().includes(step);
  }

  protected isStepCurrent(step: MatchProgressStep): boolean {
    return this.step() === step;
  }

  /** Solo hechos, el actual o los que aún tocan: un saltado (degradado) no aparece. */
  protected isStepVisible(step: MatchProgressStep): boolean {
    return (
      this.isStepDone(step) ||
      this.isStepCurrent(step) ||
      this.pendingSteps().includes(step)
    );
  }

  protected showStepList(): boolean {
    const current = this.step();
    return (
      current !== null &&
      current !== 'done' &&
      current !== 'done-degraded' &&
      current !== 'failed'
    );
  }

  protected async analyze(): Promise<void> {
    if (!this.canAnalyze()) {
      return;
    }
    this.suggestionsExpanded.set(false);
    this.copiedId.set(null);
    this.notConvincedIndexes.set(new Set());
    this.notConvincedPending.set(null);
    await this.match.request();
  }

  protected async refresh(): Promise<void> {
    await this.match.refresh();
  }

  protected async retryConsent(): Promise<void> {
    await this.session.reloadConsent();
  }

  protected changeCv(): void {
    void this.router.navigate(['/mi-cv']);
    this.dialogRef.close({ kind: 'change-cv' });
  }

  protected giveConsent(): void {
    void this.router.navigate(['/perfil']);
    this.dialogRef.close({ kind: 'give-consent' });
  }

  protected uploadCv(): void {
    void this.router.navigate(['/mi-cv']);
    this.dialogRef.close({ kind: 'change-cv' });
  }

  protected pasteDescription(): void {
    this.dialog.open<PasteDescriptionDialog, PasteDescriptionDialogData>(PasteDescriptionDialog, {
      data: { link: this.data.link },
    });
  }

  protected expandSuggestions(): void {
    this.suggestionsExpanded.set(true);
  }

  protected suggestionKey(suggestion: MatchSuggestion, index: number): string {
    return `${suggestion.section}:${index}:${suggestion.after.slice(0, 24)}`;
  }

  /** Índice en `report.suggestions` (informe final), no el de la lista ordenada en pantalla. */
  protected suggestionReportIndex(suggestion: MatchSuggestion): number {
    const report = this.report();
    if (report === null) {
      return -1;
    }
    return report.suggestions.indexOf(suggestion);
  }

  protected async copySuggestion(suggestion: MatchSuggestion, index: number): Promise<void> {
    const key = this.suggestionKey(suggestion, index);
    try {
      await navigator.clipboard.writeText(suggestion.after);
      this.copiedId.set(key);
    } catch {
      this.copiedId.set(null);
    }
  }

  protected isCopied(suggestion: MatchSuggestion, index: number): boolean {
    return this.copiedId() === this.suggestionKey(suggestion, index);
  }

  protected isNotConvinced(suggestion: MatchSuggestion): boolean {
    const index = this.suggestionReportIndex(suggestion);
    return index >= 0 && this.notConvincedIndexes().has(index);
  }

  protected isNotConvincedPending(suggestion: MatchSuggestion): boolean {
    const index = this.suggestionReportIndex(suggestion);
    return index >= 0 && this.notConvincedPending() === index;
  }

  protected async markNotConvinced(suggestion: MatchSuggestion): Promise<void> {
    const index = this.suggestionReportIndex(suggestion);
    if (index < 0 || this.isNotConvinced(suggestion) || this.isNotConvincedPending(suggestion)) {
      return;
    }
    this.notConvincedPending.set(index);
    try {
      await this.match.submitFeedback(index);
      this.notConvincedIndexes.update((current) => new Set([...current, index]));
    } catch {
      // Sin toast: el botón sigue disponible para reintentar; el informe no cambia.
    } finally {
      this.notConvincedPending.set(null);
    }
  }

  protected isDegraded(report: MatchReport): boolean {
    return report.degraded;
  }

  protected showRetryForDegraded(): boolean {
    const reason = this.degradedReason();
    return reason === 'no_providers' || reason === 'providers_failed';
  }
}
