import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { saveLinkRequestSchema } from '@linkvault/shared';
import { type RequestFailure, isApiFailure, toRequestFailure } from '../../core/api/api-error';
import { LinksStore } from '../../core/links/links.store';
import { zodValidator } from '../../shared/forms/zod-validator';
import { RequestError } from '../../shared/ui/request-error';

/**
 * Guardar una oferta pegando su URL, en el grupo abierto o en la lista privada: el destino lo sabe `LinksStore`, que
 * además recarga la lista al guardar, así que aparece sin recargar la página (spec web/links).
 *
 * Los avisos son independientes: `alreadyInGroups` dice en qué grupos propios ya estaba y solo `shared` `already_there`
 * dice que en este destino ya estaba y quién la compartió. Una vacante conocida que es nueva aquí (`created` `false`,
 * `shared` `created`) no lleva aviso ninguno.
 */
@Component({
  selector: 'lv-save-link-form',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    RequestError,
  ],
  templateUrl: './save-link.form.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaveLinkForm {
  private readonly store = inject(LinksStore);

  protected readonly form = inject(NonNullableFormBuilder).group({
    url: ['', zodValidator(saveLinkRequestSchema.shape.url)],
  });
  protected readonly submitting = signal(false);
  protected readonly failure = signal<RequestFailure | null>(null);
  /** Nombres de los grupos propios, distintos del destino, donde el link ya estaba. */
  protected readonly alreadyInGroups = signal<string | null>(null);
  /** Quién compartió el link aquí antes; solo se rellena cuando la relación ya existía. */
  protected readonly sharedByName = signal<string | null>(null);
  protected readonly invalidUrl = computed(() =>
    isApiFailure(this.failure(), 400, 'invalid_url'),
  );

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.failure.set(null);
    this.alreadyInGroups.set(null);
    this.sharedByName.set(null);
    try {
      const response = await this.store.save(this.form.getRawValue().url.trim());
      this.form.reset();
      const groups = response.alreadyInGroups.map((group) => group.name);
      this.alreadyInGroups.set(groups.length > 0 ? groups.join(', ') : null);
      this.sharedByName.set(
        response.shared === 'already_there' ? (response.sharedBy?.displayName ?? null) : null,
      );
    } catch (error: unknown) {
      // El campo conserva lo escrito: con `invalid_url` el usuario tiene que corregir esa misma URL.
      this.failure.set(toRequestFailure(error));
    } finally {
      this.submitting.set(false);
    }
  }
}
