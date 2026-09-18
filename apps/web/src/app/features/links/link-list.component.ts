import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import type { JobLinkSummary } from '@linkvault/shared';
import { type RequestFailure, isApiFailure, toRequestFailure } from '../../core/api/api-error';
import { SessionStore } from '../../core/auth/session.store';
import { LinksStore } from '../../core/links/links.store';
import { confirmWith } from '../../shared/ui/confirm.dialog';
import { RequestError } from '../../shared/ui/request-error';
import { EditPreviewDialog, type EditPreviewDialogData } from './edit-preview.dialog';
import { LinkCard } from './link-card.component';

/** De qué lista son los links: la de un grupo o la privada. Solo cambia el texto del estado vacío. */
export type LinkListScope = 'group' | 'mine';

/**
 * Lista de links compartida por el detalle del grupo y por `/mis-links` (D9). Cada fila es una `LinkCard`, que es quien
 * sabe pintar una oferta; la lista pone el estado vacío y resuelve las acciones que necesitan saber de qué lista se
 * trata.
 *
 * Recibe los links ya cargados, así que quien la usa decide cuándo mostrarla y el estado vacío no aparece mientras la
 * página carga. Quitar sí lo resuelve ella: la confirmación y el destino (grupo o lista privada) son los mismos en las
 * dos pantallas y `LinksStore` ya sabe de cuál se trata.
 */
@Component({
  selector: 'lv-link-list',
  imports: [LinkCard, RequestError],
  templateUrl: './link-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkList {
  readonly links = input.required<JobLinkSummary[]>();
  readonly scope = input.required<LinkListScope>();
  /** `true` si quien mira es `owner` del grupo: puede quitar también lo que compartieron otros. */
  readonly canModerate = input(false);

  private readonly store = inject(LinksStore);
  private readonly dialog = inject(MatDialog);
  private readonly session = inject(SessionStore);

  /** `true` mientras se quita o se relee un link: las dos acciones bloquean los botones de la lista. */
  protected readonly working = signal(false);
  /** Cuántas lecturas van listas de las que se están esperando; `null` cuando no hay ninguna en curso. */
  protected readonly reading = this.store.reading;
  protected readonly failure = signal<RequestFailure | null>(null);

  /**
   * La API puede negar un reintento que la tarjeta sí ofrecía: entre que se pintó y se pulsó, la lectura pudo terminar
   * con un motivo que no se reintenta. Eso se explica con sus palabras, no con el error genérico.
   */
  protected readonly notRetryable = computed(() =>
    isApiFailure(this.failure(), 409, 'enrichment_not_retryable'),
  );

  /** Quitar lo ofrece a quien compartió el link y al owner; en la lista privada, todo link propio se puede quitar. */
  protected canRemove(link: JobLinkSummary): boolean {
    if (this.scope() === 'mine') {
      return true;
    }
    const userId = this.session.user()?.id;
    return this.canModerate() || (userId !== undefined && link.sharedBy?.userId === userId);
  }

  /**
   * Abre la corrección a mano de una oferta. El diálogo guarda y deja la tarjeta actualizada en el store, así que aquí
   * no hay nada que recargar: el link es el mismo, solo cambia lo que dice.
   */
  protected editPreview(link: JobLinkSummary): void {
    this.failure.set(null);
    this.dialog.open<EditPreviewDialog, EditPreviewDialogData>(EditPreviewDialog, {
      data: { link },
    });
  }

  /** Vuelve a pedir la lectura de una oferta que falló por algo pasajero. */
  protected async retry(link: JobLinkSummary): Promise<void> {
    if (this.working()) {
      return;
    }
    this.working.set(true);
    this.failure.set(null);
    try {
      await this.store.retryEnrichment(link.id);
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
    } finally {
      this.working.set(false);
    }
  }

  /** Solo se borra la relación con este grupo o con esta lista: la vacante sigue en los demás. */
  protected async remove(link: JobLinkSummary): Promise<void> {
    const confirmed = await confirmWith(this.dialog, {
      title: $localize`:@@links.list.removeTitle:Quitar el enlace`,
      message:
        this.scope() === 'mine'
          ? $localize`:@@links.list.removeMessageMine:Se quita de tu lista; la oferta sigue disponible en tus grupos.`
          : $localize`:@@links.list.removeMessageGroup:Se quita de este grupo; la oferta sigue disponible en otros grupos.`,
      confirmLabel: $localize`:@@links.list.removeConfirm:Quitar`,
    });
    if (!confirmed) {
      return;
    }
    this.working.set(true);
    this.failure.set(null);
    try {
      await this.store.remove(link.id);
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
    } finally {
      this.working.set(false);
    }
  }
}
