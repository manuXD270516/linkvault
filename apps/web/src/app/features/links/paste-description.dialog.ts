import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  type JobLinkSummary,
  PASTED_TEXT_MAX_LENGTH,
  type PastedDescriptionRequest,
} from '@linkvault/shared';
import { type RequestFailure, isApiFailure, toRequestFailure } from '../../core/api/api-error';
import { LinksStore } from '../../core/links/links.store';
import { RequestError } from '../../shared/ui/request-error';
import { EditPreviewDialog, type EditPreviewDialogData } from './edit-preview.dialog';
import { whenText } from './paste-when';

/**
 * El link que se va a completar, tal y como lo tiene la pantalla que abre el diálogo. El diálogo no sabe de qué lista
 * viene: lo abren la lista de un grupo, `/mis-links` y, más adelante, el seguimiento de candidaturas.
 */
export interface PasteDescriptionDialogData {
  link: JobLinkSummary;
}

/**
 * Completar una oferta pegando su descripción (spec web/links, paste-job-description). La persona pega el texto tal
 * como lo ve y, aparte, el título y la empresa, porque lo que se copia desde la app del móvil casi nunca trae la
 * cabecera.
 *
 * El título y la empresa vienen precargados con lo que ya dice la tarjeta y **solo viajan si la persona los cambió**:
 * enviarlos siempre atribuiría a quien pega un título que leyó la página, lo fijaría como escrito a mano y ninguna
 * lectura podría ya mejorarlo.
 *
 * El texto pegado vive solo en este diálogo mientras está abierto: no se guarda en el store ni en ningún otro sitio. Un
 * error de la API se explica sin cerrar el diálogo, así que lo pegado se conserva para volver a intentarlo.
 */
@Component({
  selector: 'lv-paste-description-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, RequestError],
  templateUrl: './paste-description.dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PasteDescriptionDialog {
  private readonly store = inject(LinksStore);
  private readonly dialogRef =
    inject<MatDialogRef<PasteDescriptionDialog, JobLinkSummary | undefined>>(MatDialogRef);
  private readonly dialog = inject(MatDialog);
  private readonly locale = inject(LOCALE_ID);
  private readonly link = inject<PasteDescriptionDialogData>(MAT_DIALOG_DATA).link;

  /** Lo que la tarjeta ya dice: es contra lo que se decide si la persona cambió el título o la empresa. */
  private readonly knownTitle = this.link.preview?.title ?? '';
  private readonly knownCompany = this.link.preview?.company ?? '';

  protected readonly maxLength = PASTED_TEXT_MAX_LENGTH;
  protected readonly text = signal('');
  protected readonly title = signal(this.knownTitle);
  protected readonly company = signal(this.knownCompany);
  protected readonly submitting = signal(false);
  protected readonly failure = signal<RequestFailure | null>(null);

  /** La API mide el texto sin los espacios exteriores, así que aquí se mide igual. */
  protected readonly length = computed(() => this.text().trim().length);
  protected readonly tooLong = computed(
    () => this.length() > PASTED_TEXT_MAX_LENGTH || isApiFailure(this.failure(), 400, 'text_too_long'),
  );
  protected readonly canSubmit = computed(
    () => this.length() > 0 && this.length() <= PASTED_TEXT_MAX_LENGTH && !this.submitting(),
  );

  /**
   * Cuál de los mensajes propios del pegado toca, o `null` si el fallo es de los comunes (sin conexión, error genérico).
   * Cada código dice lo que pasa de verdad: solo `extraction_unavailable` invita a reintentar «en un rato». Hay dos `429`
   * y se dicen distinto: pegar demasiado seguido se arregla esperando un poco; agotar la cuota de IA, no antes de la hora
   * que anuncia la API.
   */
  protected readonly problem = computed(() => {
    const failure = this.failure();
    if (isApiFailure(failure, 422, 'not_a_job_posting')) {
      return 'notAJobPosting';
    }
    if (isApiFailure(failure, 503, 'extraction_unavailable')) {
      return 'unavailable';
    }
    if (isApiFailure(failure, 503, 'ai_capacity_exhausted')) {
      return 'capacityExhausted';
    }
    if (isApiFailure(failure, 503, 'extraction_disabled')) {
      return 'disabled';
    }
    if (isApiFailure(failure, 409, 'ai_consent_required')) {
      return 'consentRequired';
    }
    if (isApiFailure(failure, 429, 'too_many_attempts')) {
      return 'tooManyPastes';
    }
    if (isApiFailure(failure, 429, 'ai_quota_exceeded')) {
      return 'quotaExceeded';
    }
    return null;
  });

  /**
   * Cuándo se podrá volver a pegar, solo con `ai_quota_exceeded`; `null` si no hay `Retry-After` o la hora cae más allá
   * de mañana (el diálogo usa entonces el texto sin hora). `ai_capacity_exhausted` ignora el `Retry-After` a propósito.
   */
  protected readonly quotaWhen = computed(() => {
    const failure = this.failure();
    if (this.problem() !== 'quotaExceeded' || failure?.kind !== 'api') {
      return null;
    }
    return whenText(new Date(), failure.retryAfterMinutes, this.locale);
  });

  /** Donde reenviar no arregla nada o casi seguro vuelve a fallar, «Completar a mano» es la acción principal. */
  protected readonly handIsPrimary = computed(() => {
    const reason = this.problem();
    return (
      reason === 'capacityExhausted' ||
      reason === 'quotaExceeded' ||
      reason === 'disabled' ||
      reason === 'consentRequired'
    );
  });

  /** Reenviar como acción secundaria («Reintentar»): solo ante el cupo de la IA, que a veces se libera en segundos. */
  protected readonly offersRetry = computed(() => this.problem() === 'capacityExhausted');

  /** Tras cualquier fallo del envío, propio del pegado o común, se puede seguir a mano sin cerrar nada. */
  protected readonly canCompleteByHand = computed(() => this.failure() !== null && !this.submitting());

  protected onText(event: Event): void {
    this.text.set((event.target as HTMLTextAreaElement).value);
  }

  protected onTitle(event: Event): void {
    this.title.set((event.target as HTMLInputElement).value);
  }

  protected onCompany(event: Event): void {
    this.company.set((event.target as HTMLInputElement).value);
  }

  protected async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }
    this.submitting.set(true);
    this.failure.set(null);
    // Mientras la IA lee no se puede cerrar el diálogo sin querer: la respuesta llegaría a una tarjeta que ya nadie mira.
    this.dialogRef.disableClose = true;
    try {
      this.dialogRef.close(await this.store.pasteDescription(this.link.id, this.request()));
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
    } finally {
      this.submitting.set(false);
      this.dialogRef.disableClose = false;
    }
  }

  /**
   * Cierra este diálogo y abre la corrección a mano del mismo link, con lo pegado como referencia que solo vive en la
   * memoria de ese diálogo (no entra en el store ni viaja en la petición). El título y la empresa pasan solo si la persona
   * los cambió aquí, con la misma regla de `changed()`, y entran como valores ya modificados.
   */
  protected completeByHand(): void {
    const reference: NonNullable<EditPreviewDialogData['reference']> = { text: this.text() };
    const title = changed(this.title(), this.knownTitle);
    if (title !== null) {
      reference.title = title;
    }
    const company = changed(this.company(), this.knownCompany);
    if (company !== null) {
      reference.company = company;
    }
    this.dialogRef.close(undefined);
    this.dialog.open<EditPreviewDialog, EditPreviewDialogData>(EditPreviewDialog, {
      data: { link: this.link, reference },
    });
  }

  /** El texto tal cual y, de la cabecera, solo lo que la persona cambió respecto de la tarjeta. */
  private request(): PastedDescriptionRequest {
    const request: PastedDescriptionRequest = { text: this.text() };
    const title = changed(this.title(), this.knownTitle);
    if (title !== null) {
      request.title = title;
    }
    const company = changed(this.company(), this.knownCompany);
    if (company !== null) {
      request.company = company;
    }
    return request;
  }
}

/**
 * El valor escrito si es distinto del que había y dice algo; si no, `null`. Vaciar un campo precargado no es un cambio
 * que este diálogo pueda enviar —el contrato no admite cadenas vacías—: para eso está completar la oferta a mano.
 */
function changed(value: string, known: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed === known.trim() ? null : trimmed;
}
