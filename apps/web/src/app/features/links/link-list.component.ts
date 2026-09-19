import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { Application, GroupTracker, JobLinkSummary, PreviewFieldName } from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';
import {
  type RequestFailure,
  hasApiErrorCode,
  isApiFailure,
  toRequestFailure,
} from '../../core/api/api-error';
import { ApplicationsStore } from '../../core/applications/applications.store';
import { SessionStore } from '../../core/auth/session.store';
import { LinksStore } from '../../core/links/links.store';
import { ApplicationMoves } from '../applications/application-moves';
import { ShareInvitation } from '../applications/share-invitation';
import { confirmWith } from '../../shared/ui/confirm.dialog';
import { RequestError } from '../../shared/ui/request-error';
import {
  COMMENTS_DIALOG_SIZE,
  CommentsDialog,
  type CommentsDialogData,
  type CommentsDialogResult,
} from './comments.dialog';
import { EditPreviewDialog, type EditPreviewDialogData } from './edit-preview.dialog';
import { LinkCard } from './link-card.component';
import { linkLabel } from './link-preview';
import { PasteDescriptionDialog, type PasteDescriptionDialogData } from './paste-description.dialog';

/** Cuánto se ve "Esta oferta ya no está en el grupo" tras cerrarse el hilo. */
const GONE_NOTICE_MS = 6000;

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
  /** Grupo de la lista, para sus estados compartidos y la invitación a compartir; `null` en `/mis-links`. */
  readonly groupId = input<string | null>(null);

  private readonly store = inject(LinksStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly session = inject(SessionStore);
  private readonly applications = inject(ApplicationsStore);
  private readonly moves = inject(ApplicationMoves);
  private readonly invitation = inject(ShareInvitation);

  /** Links cuyo estado ya se pidió desde esta lista: cada página y cada link añadido se piden una sola vez. */
  private readonly requested = new Set<string>();
  /** Links cuyo último gesto respondió que ya se seguían (otra pestaña): muestran "Ya la seguías". */
  protected readonly alreadyTracked = signal<ReadonlySet<string>>(new Set());
  /** `true` si "Postulé" sobre una oferta seguida chocó con un cambio de otra pestaña. */
  protected readonly trackingConflict = signal(false);

  /** `true` mientras se quita, se relee o se deshace un pegado: las tres acciones bloquean los botones de la lista. */
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

  constructor() {
    // Estados de postulaciones por bloques (D11, critic 13): uno por cada página que se pinta y otro por los links que
    // entran al guardar o importar. Lo ya pedido no se vuelve a pedir: la recarga tras guardar trae la primera página
    // entera y solo lo nuevo hace falta.
    effect(() => {
      const fresh = this.links()
        .map((link) => link.id)
        .filter((id) => !this.requested.has(id));
      const groupId = this.groupId();
      if (fresh.length === 0) {
        return;
      }
      for (const id of fresh) {
        this.requested.add(id);
      }
      untracked(() => {
        void this.applications.loadOwn(fresh);
        if (groupId !== null) {
          void this.applications.loadShared(groupId, fresh);
        }
      });
    });
    // Al volver a la pestaña, los compartidos de todo lo cargado, por bloques de hasta 50: es lo que puede haber
    // cambiado en otra sesión (D8: no hay aviso en vivo).
    const onVisibilityChange = (): void => {
      const groupId = this.groupId();
      if (document.visibilityState === 'visible' && groupId !== null) {
        void this.applications.loadShared(
          groupId,
          this.links().map((link) => link.id),
        );
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    inject(DestroyRef).onDestroy(() =>
      document.removeEventListener('visibilitychange', onVisibilityChange),
    );
  }

  protected own(link: JobLinkSummary): Application | null {
    return this.applications.byLinkId()[link.id] ?? null;
  }

  /** Estados compartidos del link en el grupo; `null` fuera de un grupo, donde no se muestran avatares. */
  protected trackersOf(link: JobLinkSummary): readonly GroupTracker[] | null {
    const groupId = this.groupId();
    return groupId === null ? null : (this.applications.shared()[groupId]?.[link.id] ?? []);
  }

  /**
   * "Me interesa" o "Postulé" (spec web/applications, "Seguir desde la tarjeta de la oferta"). Sin seguirla, empieza a
   * seguirla; si ya la sigue en "Guardada" o "Interés", "Postulé" la mueve. "Postulé" pregunta la fecha si no la hay.
   * En un grupo, si queda privada, se invita a compartir (D7).
   */
  protected async trackGesture(link: JobLinkSummary, gesture: 'interested' | 'applied'): Promise<void> {
    if (this.working()) {
      return;
    }
    this.failure.set(null);
    this.trackingConflict.set(false);
    const current = this.own(link);
    if (current !== null) {
      if (gesture === 'applied') {
        await this.markApplied(link, current);
      }
      return;
    }
    let appliedAt: string | undefined;
    if (gesture === 'applied') {
      const answer = await this.moves.askAppliedDate();
      if (answer === null) {
        return;
      }
      appliedAt = answer.appliedAt;
    }
    this.working.set(true);
    try {
      const { application, created } = await this.applications.track(link.id, gesture, appliedAt);
      this.setAlreadyTracked(link.id, !created);
      this.invite(application, gesture);
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
    } finally {
      this.working.set(false);
    }
  }

  private async markApplied(link: JobLinkSummary, current: Application): Promise<void> {
    this.working.set(true);
    try {
      const outcome = await this.moves.move(current, 'applied');
      if (outcome.kind === 'moved') {
        this.setAlreadyTracked(link.id, false);
        this.invite(outcome.application, 'applied');
      } else if (outcome.kind === 'conflict') {
        this.trackingConflict.set(true);
      } else if (outcome.kind === 'failed') {
        this.failure.set(outcome.failure);
      }
    } finally {
      this.working.set(false);
    }
  }

  private setAlreadyTracked(linkId: string, already: boolean): void {
    const next = new Set(this.alreadyTracked());
    if (already) {
      next.add(linkId);
    } else {
      next.delete(linkId);
    }
    this.alreadyTracked.set(next);
  }

  /** Solo en un grupo: en `/mis-links` no hay nadie mirando (D7). La propia invitación descarta lo ya compartido. */
  private invite(application: Application, gesture: 'interested' | 'applied'): void {
    if (this.groupId() !== null) {
      void this.invitation.offer(application, gesture);
    }
  }

  /** Quitar lo ofrece a quien compartió el link y al owner; en la lista privada, todo link propio se puede quitar. */
  protected canRemove(link: JobLinkSummary): boolean {
    return this.scope() === 'mine' || this.isSharerOrOwner(link);
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

  /**
   * Abre el pegado de la descripción. Como la corrección a mano, el diálogo deja la tarjeta actualizada en el store al
   * terminar, así que aquí no hay nada más que hacer.
   */
  protected pasteDescription(link: JobLinkSummary): void {
    this.failure.set(null);
    this.dialog.open<PasteDescriptionDialog, PasteDescriptionDialogData>(PasteDescriptionDialog, {
      data: { link },
    });
  }

  /** Devuelve a lo anterior, en una sola petición, todos los campos del último pegado de ese link. */
  protected async undoPaste(link: JobLinkSummary, fields: PreviewFieldName[]): Promise<void> {
    if (this.working()) {
      return;
    }
    this.working.set(true);
    this.failure.set(null);
    try {
      await this.store.undoPaste(link.id, fields);
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
    } finally {
      this.working.set(false);
    }
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

  /**
   * Abre el hilo del link en el grupo. Si se cierra porque la oferta ya no está en el grupo (un `404` al abrir o al
   * publicar), se dice y se vuelve a pedir la lista, que todavía la enseñaba.
   */
  protected async openComments(link: JobLinkSummary): Promise<void> {
    const groupId = this.groupId();
    if (groupId === null) {
      return;
    }
    this.failure.set(null);
    const title = link.preview?.title;
    const ref = this.dialog.open<CommentsDialog, CommentsDialogData, CommentsDialogResult>(
      CommentsDialog,
      {
        data: {
          groupId,
          linkId: link.id,
          headline: title === undefined || title.length === 0 ? linkLabel(link.displayUrl) : title,
          canModerate: this.canModerate(),
        },
        autoFocus: 'dialog',
        ...COMMENTS_DIALOG_SIZE,
      },
    );
    const result = await firstValueFrom(ref.afterClosed());
    if (result === 'gone') {
      this.snackBar.open(
        $localize`:@@comments.gone:Esta oferta ya no está en el grupo`,
        undefined,
        { duration: GONE_NOTICE_MS, politeness: 'assertive' },
      );
      void this.store.reload();
    }
  }

  /** Quitar la nota lo pueden quien compartió el link y el propietario del grupo (D3 de group-comments). */
  protected canRemoveNote(link: JobLinkSummary): boolean {
    return this.scope() === 'group' && link.note !== undefined && this.isSharerOrOwner(link);
  }

  /**
   * Quita la nota tras confirmarlo. La confirmación dice de quién es: la propia solo avisa de que no se puede deshacer;
   * la ajena, que desaparece para todo el grupo (business 5, iteración 2). La tarjeta la deja de mostrar sin recargar.
   */
  protected async removeNote(link: JobLinkSummary): Promise<void> {
    const groupId = this.groupId();
    if (groupId === null || this.working()) {
      return;
    }
    const sharer = link.sharedBy;
    const own = sharer !== undefined && sharer.userId === this.session.user()?.id;
    const confirmed = await confirmWith(this.dialog, {
      title: $localize`:@@comments.note.removeTitle:Quitar la nota`,
      message:
        own || sharer === undefined
          ? $localize`:@@comments.note.removeOwn:¿Quitar la nota? No se puede deshacer.`
          : $localize`:@@comments.note.removeOther:¿Quitar la nota de ${sharer.displayName}:NAME:? Desaparecerá para todo el grupo y no se puede deshacer.`,
      confirmLabel: $localize`:@@comments.note.removeConfirm:Quitar la nota`,
    });
    if (!confirmed) {
      return;
    }
    this.working.set(true);
    this.failure.set(null);
    try {
      await this.store.removeNote(groupId, link.id);
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
      // La oferta ya no está en el grupo: la lista se vuelve a pedir para no seguir enseñándola.
      if (hasApiErrorCode(error, 404, 'link_not_found')) {
        void this.store.reload();
      }
    } finally {
      this.working.set(false);
    }
  }

  private isSharerOrOwner(link: JobLinkSummary): boolean {
    const userId = this.session.user()?.id;
    return this.canModerate() || (userId !== undefined && link.sharedBy?.userId === userId);
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
