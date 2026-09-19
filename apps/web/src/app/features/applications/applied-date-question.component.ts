import { ChangeDetectionStrategy, Component, computed, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

/**
 * Respuesta a "¿Cuándo postulaste?". Con "Hoy" no lleva `appliedAt`: manda el reloj del servidor, y ni la zona horaria
 * ni un reloj de cliente adelantado pueden convertirlo en una fecha futura (D3, critic 4). Con otro día lleva la ISO de
 * la medianoche local de ese día.
 */
export interface AppliedDateAnswer {
  appliedAt?: string;
}

/** `YYYY-MM-DD` del día local de `date`, el formato de `<input type="date">`. */
export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** La medianoche local de un `YYYY-MM-DD`, en ISO. */
export function localMidnightIso(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).toISOString();
}

/**
 * "¿Cuándo postulaste?" (business 5, critic 4). "Hoy" es el botón principal y el primero que se puede enfocar, así que un
 * diálogo que solo hace esta pregunta lo enfoca al abrirse y Enter lo pulsa. "Otro día" despliega un selector que no
 * admite días futuros. Lo reutilizan el tablero, la tarjeta de la oferta y el diálogo de etapa.
 */
@Component({
  selector: 'lv-applied-date-question',
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <fieldset class="flex flex-col gap-2" data-testid="applied-date-question">
      <legend class="mb-2 font-medium" i18n="@@applications.appliedDate.question">
        ¿Cuándo postulaste?
      </legend>
      <div class="flex flex-wrap gap-2">
        <button
          mat-flat-button
          type="button"
          class="lv-applied-today"
          (click)="answerToday()"
          data-testid="applied-today"
          i18n="@@applications.appliedDate.today"
        >
          Hoy
        </button>
        @if (!otherDay()) {
          <button
            mat-stroked-button
            type="button"
            (click)="otherDay.set(true)"
            data-testid="applied-other-day"
            i18n="@@applications.appliedDate.otherDay"
          >
            Otro día
          </button>
        }
      </div>
      @if (otherDay()) {
        <mat-form-field>
          <mat-label i18n="@@applications.appliedDate.day">Día en que postulaste</mat-label>
          <input
            matInput
            type="date"
            [max]="today"
            [value]="day()"
            (input)="onDay($event)"
            (keydown.enter)="$event.preventDefault(); answerOtherDay()"
            data-testid="applied-day"
          />
        </mat-form-field>
        @if (isFuture()) {
          <p class="text-(--mat-sys-error)" role="alert" i18n="@@applications.appliedDate.future">
            No puede ser un día futuro
          </p>
        }
        <div>
          <button
            mat-flat-button
            type="button"
            [disabled]="!canConfirm()"
            (click)="answerOtherDay()"
            data-testid="applied-confirm"
            i18n="@@applications.appliedDate.confirm"
          >
            Usar ese día
          </button>
        </div>
      }
    </fieldset>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppliedDateQuestion {
  readonly answered = output<AppliedDateAnswer>();

  protected readonly today = localDay(new Date());
  protected readonly otherDay = signal(false);
  protected readonly day = signal('');

  /** Las cadenas `YYYY-MM-DD` se comparan bien como texto. */
  protected readonly isFuture = computed(() => this.day() !== '' && this.day() > this.today);
  protected readonly canConfirm = computed(() => this.day() !== '' && !this.isFuture());

  protected onDay(event: Event): void {
    this.day.set((event.target as HTMLInputElement).value);
  }

  protected answerToday(): void {
    this.answered.emit({});
  }

  protected answerOtherDay(): void {
    if (this.canConfirm()) {
      this.answered.emit({ appliedAt: localMidnightIso(this.day()) });
    }
  }
}
