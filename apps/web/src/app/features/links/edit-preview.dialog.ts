import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  type JobLinkSummary,
  type JobSalary,
  type SalaryPeriod,
  type StoredPreview,
  type UpdatePreviewRequest,
  updatePreviewRequestSchema,
} from '@linkvault/shared';
import { type RequestFailure, toRequestFailure } from '../../core/api/api-error';
import { LinksStore } from '../../core/links/links.store';
import { RequestError } from '../../shared/ui/request-error';
import { fieldOrigin, originText } from './link-preview';

/** El link que se va a corregir, con su preview y la procedencia de cada campo tal como los devolvió la API. */
export interface EditPreviewDialogData {
  link: JobLinkSummary;
}

/**
 * Campos que este formulario deja corregir. `skills` y `languages` quedan fuera **a propósito**: son listas de objetos
 * (una habilidad sabe si es obligatoria, un idioma su nivel) y editarlas pide una pantalla propia; se enseñan con su
 * origen, como el resto, pero no se tocan aquí.
 */
const EDITABLE_FIELDS = [
  'title',
  'company',
  'location',
  'modality',
  'seniority',
  'salary',
  'summary',
  'postedAt',
  'expiresAt',
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/**
 * Corregir a mano el preview de una oferta (spec web/links). Cada campo enseña de dónde salió su valor —de la página,
 * de la IA, de la descripción que alguien pegó o de una persona, con su nombre— porque el link es compartido y lo que una persona corrige lo ven las demás.
 *
 * Solo viajan a la API los campos que cambiaron: enviarlos todos marcaría como escrito a mano lo que nadie tocó, y a
 * partir de ahí ninguna relectura podría mejorarlo. Un campo que vuelve a lo anterior viaja aparte, en `revert`.
 *
 * El error de la API se muestra sin cerrar el diálogo: lo escrito no se pierde.
 */
@Component({
  selector: 'lv-edit-preview-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    NgTemplateOutlet,
    ReactiveFormsModule,
    RequestError,
  ],
  templateUrl: './edit-preview.dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditPreviewDialog {
  private readonly store = inject(LinksStore);
  private readonly dialogRef =
    inject<MatDialogRef<EditPreviewDialog, JobLinkSummary | undefined>>(MatDialogRef);
  private readonly link = inject<EditPreviewDialogData>(MAT_DIALOG_DATA).link;

  private readonly preview: StoredPreview = this.link.preview ?? {};
  private readonly sources = this.link.previewSources ?? {};

  protected readonly form = inject(NonNullableFormBuilder).group({
    title: [this.preview.title ?? ''],
    company: [this.preview.company ?? ''],
    location: [this.preview.location ?? ''],
    modality: [this.preview.modality ?? 'unknown'],
    seniority: [this.preview.seniority ?? 'unknown'],
    salaryMin: [amountText(this.preview.salary?.min)],
    salaryMax: [amountText(this.preview.salary?.max)],
    salaryCurrency: [this.preview.salary?.currency ?? ''],
    // El periodo se declara a mano: `''` es "no lo dice", y el constructor de formularios ensancharía la unión a
    // `string`, que ya no valdría como periodo del contrato.
    salaryPeriod: new FormControl<SalaryPeriod | ''>(this.preview.salary?.period ?? '', {
      nonNullable: true,
    }),
    summary: [this.preview.summary ?? ''],
    postedAt: [this.preview.postedAt ?? ''],
    expiresAt: [this.preview.expiresAt ?? ''],
  });

  protected readonly saving = signal(false);
  protected readonly failure = signal<RequestFailure | null>(null);
  /** Campos marcados para volver a lo anterior; se excluyen de lo que se escribe a mano. */
  private readonly reverting = signal<readonly EditableField[]>([]);

  /** De dónde salió el valor de ese campo, en palabras; `null` si nadie lo ha escrito todavía. */
  protected origin(field: EditableField): string | null {
    return originText(fieldOrigin(this.sources[field]));
  }

  /**
   * Solo se puede volver a lo anterior en un campo que una persona puso —escribiéndolo o pegando la descripción— y que
   * desplazó otro valor: lo que había es lo que guarda `replaced`, con su origen y su autor.
   */
  protected canRevert(field: EditableField): boolean {
    return this.displaced(field) !== undefined;
  }

  protected isReverting(field: EditableField): boolean {
    return this.reverting().includes(field);
  }

  /**
   * Marca (o desmarca) un campo para volver a lo anterior y enseña ya el valor que recuperará, para que la persona vea
   * a qué va a volver antes de guardar.
   */
  protected toggleRevert(field: EditableField): void {
    if (this.isReverting(field)) {
      this.reverting.update((fields) => fields.filter((name) => name !== field));
      this.show(field, this.preview[field] ?? null);
      return;
    }
    const replaced = this.displaced(field);
    if (replaced === undefined) {
      return;
    }
    this.reverting.update((fields) => [...fields, field]);
    this.show(field, replaced.value);
  }

  /** La entrada que desplazó quien puso ese campo; lo automático nunca guarda nada, porque ahí no actuó nadie. */
  private displaced(field: EditableField): { value: unknown } | undefined {
    const entry = this.sources[field];
    return entry === undefined || entry.source === 'auto' ? undefined : entry.replaced;
  }

  protected async submit(): Promise<void> {
    if (this.saving()) {
      return;
    }
    const request = this.request();
    if (request === null) {
      this.dialogRef.close(undefined);
      return;
    }
    this.saving.set(true);
    this.failure.set(null);
    try {
      this.dialogRef.close(await this.store.updatePreview(this.link.id, request));
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
    } finally {
      this.saving.set(false);
    }
  }

  /** Lo que se va a enviar, o `null` si no hay nada que cambiar. */
  private request(): UpdatePreviewRequest | null {
    const fields = this.changedFields();
    const revert = this.reverting();
    if (revert.length === 0 && Object.keys(fields).length === 0) {
      return null;
    }
    const request: UpdatePreviewRequest = {};
    if (Object.keys(fields).length > 0) {
      request.fields = fields;
    }
    if (revert.length > 0) {
      request.revert = [...revert];
    }
    // Cota de cordura antes de salir: el cuerpo tiene que valer para la API, que juzga lo demás.
    return updatePreviewRequestSchema.safeParse(request).success ? request : null;
  }

  /** Solo lo que la persona cambió respecto de lo guardado; el resto no se toca ni se marca como suyo. */
  private changedFields(): StoredPreview {
    const value = this.form.getRawValue();
    const changed: StoredPreview = {};
    const write = <Field extends EditableField>(
      field: Field,
      next: StoredPreview[Field],
    ): void => {
      if (this.isReverting(field)) {
        return;
      }
      if (!same(next, this.preview[field] ?? null)) {
        changed[field] = next;
      }
    };

    // Un título vacío no es una corrección: la oferta se quedaría sin nombre y el contrato no lo admite.
    if (value.title.trim().length > 0) {
      write('title', value.title.trim());
    }
    write('company', emptyToNull(value.company));
    write('location', emptyToNull(value.location));
    // `unknown` y un resumen vacío son "no se sabe", igual que la ausencia del campo: en un preview que nunca los tuvo
    // no son un cambio, y escribirlos marcaría como escrito a mano algo que nadie tocó.
    if (value.modality !== 'unknown' || this.preview.modality !== undefined) {
      write('modality', value.modality);
    }
    if (value.seniority !== 'unknown' || this.preview.seniority !== undefined) {
      write('seniority', value.seniority);
    }
    write('salary', this.salaryValue());
    if (value.summary.trim().length > 0 || this.preview.summary !== undefined) {
      write('summary', value.summary.trim());
    }
    write('postedAt', emptyToNull(value.postedAt));
    write('expiresAt', emptyToNull(value.expiresAt));
    return changed;
  }

  /** El salario escrito; sin ninguna de sus partes, la oferta pasa a no decir salario (`null`). */
  private salaryValue(): JobSalary | null {
    const { salaryMin, salaryMax, salaryCurrency, salaryPeriod } = this.form.getRawValue();
    const min = amountValue(salaryMin);
    const max = amountValue(salaryMax);
    const currency = emptyToNull(salaryCurrency);
    const period = salaryPeriod === '' ? null : salaryPeriod;
    if (min === null && max === null && currency === null && period === null) {
      return null;
    }
    return { min, max, currency, period };
  }

  /** Escribe en el formulario el valor de un campo; el salario ocupa cuatro controles y va aparte. */
  private show(field: EditableField, value: unknown): void {
    if (field === 'salary') {
      const salary = isSalary(value) ? value : null;
      this.form.patchValue({
        salaryMin: amountText(salary?.min),
        salaryMax: amountText(salary?.max),
        salaryCurrency: salary?.currency ?? '',
        salaryPeriod: salary?.period ?? '',
      });
      return;
    }
    this.form.get(field)?.setValue(typeof value === 'string' ? value : '');
  }
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function amountText(amount: number | null | undefined): string {
  return amount === null || amount === undefined ? '' : String(amount);
}

/** Una cifra escrita a mano; lo que no sea un número no es una cifra y se lee como "no lo dice". */
function amountValue(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const amount = Number(trimmed);
  return Number.isFinite(amount) ? amount : null;
}

function isSalary(value: unknown): value is JobSalary {
  return typeof value === 'object' && value !== null && 'min' in value && 'currency' in value;
}

/** Igualdad para decidir si un campo cambió; el salario se compara por sus cuatro partes. */
function same(next: unknown, current: unknown): boolean {
  if (isSalary(next) && isSalary(current)) {
    return (
      next.min === current.min &&
      next.max === current.max &&
      next.currency === current.currency &&
      next.period === current.period
    );
  }
  return next === current;
}
