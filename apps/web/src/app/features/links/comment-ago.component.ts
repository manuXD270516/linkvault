import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Cuándo se escribió un comentario, en la forma que se lee: al momento, en minutos, en horas, ayer o la fecha. */
export type CommentAge =
  | { kind: 'now' }
  | { kind: 'minutes'; value: number }
  | { kind: 'hours'; value: number }
  | { kind: 'yesterday' }
  | { kind: 'date' };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Edad de un comentario respecto a `now` (D11 de group-comments): menos de un minuto es "hace un momento"; menos de una
 * hora, minutos; el mismo día de calendario de quien mira, horas; el día anterior, "ayer"; y lo demás, la fecha. Una
 * fecha en el futuro (relojes desajustados) se lee como "hace un momento".
 */
export function commentAge(createdAt: string, now: Date): CommentAge {
  const created = new Date(createdAt);
  const elapsed = now.getTime() - created.getTime();
  if (elapsed < MINUTE_MS) {
    return { kind: 'now' };
  }
  if (elapsed < HOUR_MS) {
    return { kind: 'minutes', value: Math.floor(elapsed / MINUTE_MS) };
  }
  const today = startOfDay(now);
  if (created.getTime() >= today) {
    return { kind: 'hours', value: Math.floor(elapsed / HOUR_MS) };
  }
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  return created.getTime() >= yesterday.getTime() ? { kind: 'yesterday' } : { kind: 'date' };
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "hace un momento / hace N min / hace N h / ayer / dd/MM/yyyy" de un comentario, en la tarjeta y en el hilo. */
@Component({
  selector: 'lv-comment-ago',
  imports: [DatePipe],
  template: `@let age = ageOf();
    <time [attr.datetime]="createdAt()" data-testid="comment-ago"
      >@switch (age.kind) {
        @case ('now') {
          <ng-container i18n="@@comments.ago.now">hace un momento</ng-container>
        }
        @case ('minutes') {
          @let minutes = age.kind === 'minutes' ? age.value : 0;
          <ng-container i18n="@@comments.ago.minutes">hace {{ minutes }} min</ng-container>
        }
        @case ('hours') {
          @let hours = age.kind === 'hours' ? age.value : 0;
          <ng-container i18n="@@comments.ago.hours">hace {{ hours }} h</ng-container>
        }
        @case ('yesterday') {
          <ng-container i18n="@@comments.ago.yesterday">ayer</ng-container>
        }
        @default {
          {{ createdAt() | date: 'dd/MM/yyyy' }}
        }
      }</time
    >`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommentAgo {
  readonly createdAt = input.required<string>();
  /** Instante de referencia; solo lo fijan los tests. */
  readonly now = input<Date | null>(null);

  protected readonly ageOf = computed(() => commentAge(this.createdAt(), this.now() ?? new Date()));
}
