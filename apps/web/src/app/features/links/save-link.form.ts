import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { PublicShare } from '@linkvault/shared';
import {
  SHARE_NOTE_MAX_LENGTH,
  commentTextLength,
  normalizeCommentText,
  saveLinkRequestSchema,
} from '@linkvault/shared';
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
 *
 * En un grupo ofrece además la nota para el grupo (D3 de group-comments). Si la oferta ya estaba, la nota no se añade:
 * se dice y el texto se queda en el campo, para que la persona decida qué hacer con él (business 5).
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
    note: ['', zodValidator(saveLinkRequestSchema.shape.note)],
  });
  protected readonly submitting = signal(false);
  protected readonly failure = signal<RequestFailure | null>(null);
  /** Nombres de los grupos propios, distintos del destino, donde el link ya estaba. */
  protected readonly alreadyInGroups = signal<string | null>(null);
  /** Quién compartió el link aquí antes; solo se rellena cuando la relación ya existía. */
  protected readonly sharedByName = signal<string | null>(null);
  /** `true` si la oferta ya estaba en el grupo y la nota escrita no se añadió. */
  protected readonly noteDiscarded = signal(false);
  /**
   * El enlace público con el que nació el link, cuando el grupo comparte en público. Viene **en la respuesta** de
   * guardar (business 1), así que decir el alcance y ofrecer copiarlo no cuesta ninguna petición más. Este es el único
   * momento en que enterarse sirve de algo: la persona está a punto de pegar algo en el chat.
   */
  protected readonly publicShare = signal<PublicShare | null>(null);
  /** `true` si la oferta recién guardada todavía no se ha leído: copiar su enlace avisa, pero copia igual. */
  protected readonly savedUnread = signal(false);
  protected readonly linkCopied = signal(false);
  protected readonly invalidUrl = computed(() =>
    isApiFailure(this.failure(), 400, 'invalid_url'),
  );

  /** La nota solo se ofrece en un grupo: ni en `/mis-links` ni en la importación. */
  protected readonly inGroup = computed(() => this.store.scope()?.kind === 'group');
  protected readonly noteMaxLength = SHARE_NOTE_MAX_LENGTH;
  private readonly note = toSignal(this.form.controls.note.valueChanges, {
    initialValue: this.form.controls.note.value,
  });
  /** Longitud de la nota como la mide la API: normalizada y en code points. */
  protected readonly noteLength = computed(() =>
    commentTextLength(normalizeCommentText(this.note())),
  );
  protected readonly noteTooLong = computed(() => this.noteLength() > SHARE_NOTE_MAX_LENGTH);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.failure.set(null);
    this.alreadyInGroups.set(null);
    this.sharedByName.set(null);
    this.noteDiscarded.set(false);
    this.publicShare.set(null);
    this.linkCopied.set(false);
    const { url, note } = this.form.getRawValue();
    const withNote = this.inGroup() && normalizeCommentText(note).length > 0;
    try {
      const response = await this.store.save(url.trim(), withNote ? note : undefined);
      const alreadyThere = response.shared === 'already_there';
      this.form.reset();
      if (withNote && alreadyThere) {
        this.form.controls.note.setValue(note);
        this.noteDiscarded.set(true);
      }
      const groups = response.alreadyInGroups.map((group) => group.name);
      this.alreadyInGroups.set(groups.length > 0 ? groups.join(', ') : null);
      this.sharedByName.set(alreadyThere ? (response.sharedBy?.displayName ?? null) : null);
      this.publicShare.set(response.link.publicShare ?? null);
      this.savedUnread.set(response.link.previewStatus === 'pending');
    } catch (error: unknown) {
      // El campo conserva lo escrito: con `invalid_url` el usuario tiene que corregir esa misma URL.
      this.failure.set(toRequestFailure(error));
    } finally {
      this.submitting.set(false);
    }
  }

  /** Copia el enlace público que ya trajo la respuesta: sin otra petición a la API. */
  protected async copyPublicLink(): Promise<void> {
    const share = this.publicShare();
    if (share === null) {
      return;
    }
    this.failure.set(null);
    try {
      await navigator.clipboard.writeText(share.url);
      this.linkCopied.set(true);
    } catch {
      this.failure.set({ kind: 'unknown' });
    }
  }
}
