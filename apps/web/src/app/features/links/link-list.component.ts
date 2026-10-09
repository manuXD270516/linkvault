import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type TemplateRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { Application, GroupTracker, JobLinkSummary, PreviewFieldName } from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';
import {
  type RequestFailure,
  hasApiErrorCode,
  isApiFailure,
  namesApiErrorField,
  toRequestFailure,
} from '../../core/api/api-error';
import { ApplicationsStore } from '../../core/applications/applications.store';
import { SessionStore } from '../../core/auth/session.store';
import { LinksStore } from '../../core/links/links.store';
import { MatchBusyRegistry } from '../../core/match/match-busy.registry';
import { MatchReopenStore } from '../../core/match/match-reopen.store';
import { ApplicationMoves } from '../applications/application-moves';
import { ShareInvitation } from '../applications/share-invitation';
import { confirmWith } from '../../shared/ui/confirm.dialog';
import { RequestError } from '../../shared/ui/request-error';
import type { MatchDialogData } from '../match/match.dialog';
import { openMatchDialog } from '../match/open-match-dialog';
import {
  COMMENTS_DIALOG_SIZE,
  CommentsDialog,
  type CommentsDialogData,
  type CommentsDialogResult,
} from './comments.dialog';
import { EditPreviewDialog, type EditPreviewDialogData } from './edit-preview.dialog';
import { emptyCardNotice, emptyCardNoticeText } from './empty-card-notice';
import { LinkCard } from './link-card.component';
import { linkLabel } from './link-preview';
import { PasteDescriptionDialog, type PasteDescriptionDialogData } from './paste-description.dialog';
import {
  ReopenExpiresDialog,
  type ReopenExpiresDialogData,
} from './reopen-expires.dialog';

/** Cuánto se ve "Esta oferta ya no está en el grupo" tras cerrarse el hilo. */
const GONE_NOTICE_MS = 6000;

/** Cuánto se ve el aviso de haber copiado el enlace público, o el de que la oferta todavía se está leyendo. */
const COPY_NOTICE_MS = 6000;

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
  private readonly matchBusy = inject(MatchBusyRegistry);
  private readonly matchReopen = inject(MatchReopenStore);

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
  /** Comentarios del link que se va a quitar del grupo; lo lee el mensaje de la confirmación, que pluraliza. */
  protected readonly removingCommentCount = signal(0);
  /** `true` si el link que se va a quitar tiene enlace público: lo que se destruye se nombra antes de destruirlo. */
  protected readonly removingPublished = signal(false);
  /** El mensaje de quitar en un grupo vive en plantilla: un ICU no se puede escribir en TypeScript. */
  private readonly removeGroupMessage = viewChild.required<TemplateRef<unknown>>('removeGroupMessage');

  /**
   * La API puede negar un reintento que la tarjeta sí ofrecía: entre que se pintó y se pulsó, la lectura pudo terminar
   * con un motivo que no se reintenta. Eso se explica con sus palabras, no con el error genérico.
   */
  protected readonly notRetryable = computed(() =>
    isApiFailure(this.failure(), 409, 'enrichment_not_retryable'),
  );

  /**
   * `true` si el último gesto sobre el enlace público lo negó la API. Se dice **quién sí puede** cambiarlo, para que
   * nadie lo lea como un fallo nuestro (business 9): el rol pudo cambiar en otra pestaña.
   */
  protected readonly publicShareForbidden = computed(() =>
    isApiFailure(this.failure(), 403, 'forbidden'),
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

    // Tras volver de `/mi-cv` o `/perfil`, la lista se remonta: si quedó un diálogo pendiente y el link sigue aquí,
    // se reabre **sin** pedir análisis.
    effect(() => {
      const links = this.links();
      const pending = this.matchReopen.peek();
      if (pending === null || !links.some((item) => item.id === pending.linkId)) {
        return;
      }
      const data = this.matchReopen.consume();
      if (data !== null) {
        untracked(() => void this.openMatchDialog(data));
      }
    });
  }

  protected isMatchBusy(link: JobLinkSummary): boolean {
    return this.matchBusy.isBusy(link.id);
  }

  /**
   * Abre el diálogo de encaje sobre la lista. **No** pide análisis al abrirse. Si la persona va a cambiar de CV o a dar
   * permiso, se recuerda el diálogo para reabrirlo al volver.
   */
  protected async openMatch(link: JobLinkSummary): Promise<void> {
    await this.openMatchDialog({
      linkId: link.id,
      jobTitle: link.preview?.title?.trim() || linkLabel(link.displayUrl),
      link,
    });
  }

  private async openMatchDialog(data: MatchDialogData): Promise<void> {
    const ref = openMatchDialog(this.dialog, data);
    const result = await firstValueFrom(ref.afterClosed());
    if (result?.kind === 'change-cv' || result?.kind === 'give-consent') {
      this.matchReopen.remember(data);
    }
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
      const outcome = await this.moves.move(current, 'applied', this.groupId());
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
   * Reabre una vacante cerrada (ADR-041 / spec web/links). Sin body primero; si el API pide `expiresAt` (calendar o
   * caducidad pasada), abre el diálogo de fecha o limpiar caducidad. Tras éxito, snack honesto: las postulaciones
   * `expired` no se reabren solas (D4).
   */
  protected async reopen(link: JobLinkSummary): Promise<void> {
    if (this.working()) {
      return;
    }
    this.working.set(true);
    this.failure.set(null);
    try {
      await this.store.reopen(link.id);
      this.noticeReopened();
    } catch (error: unknown) {
      if (namesApiErrorField(error, 400, 'validation_error', 'expiresAt')) {
        this.working.set(false);
        await this.askExpiresThenReopen(link);
        return;
      }
      this.failure.set(toRequestFailure(error));
    } finally {
      this.working.set(false);
    }
  }

  /** Diálogo de fecha cuando calendar / `expiresAt` pasado lo exige; el diálogo guarda y actualiza la tarjeta. */
  private async askExpiresThenReopen(link: JobLinkSummary): Promise<void> {
    const result = await firstValueFrom(
      this.dialog
        .open<ReopenExpiresDialog, ReopenExpiresDialogData, JobLinkSummary | undefined>(
          ReopenExpiresDialog,
          { data: { link } },
        )
        .afterClosed(),
    );
    if (result !== undefined) {
      this.noticeReopened();
    }
  }

  /** Aviso tras reopen: no afirma que las postulaciones caducadas volvieron a abrirse. */
  private noticeReopened(): void {
    this.snackBar.open(
      $localize`:@@links.reopen.done:Oferta marcada como abierta. Las postulaciones caducadas no cambian solas.`,
      undefined,
      { duration: COPY_NOTICE_MS, politeness: 'polite' },
    );
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

  /**
   * Marca o desmarca know-someone y deja la tarjeta con el DTO slim mergeado (spec web/links know-someone). Solo en
   * vista de grupo; la lista privada no emite el evento.
   */
  protected async toggleKnowSomeone(link: JobLinkSummary, flagged: boolean): Promise<void> {
    const groupId = this.groupId();
    if (groupId === null || this.working()) {
      return;
    }
    this.working.set(true);
    this.failure.set(null);
    try {
      await this.store.setKnowSomeone(groupId, link.id, flagged);
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
      if (
        hasApiErrorCode(error, 404, 'link_not_found') ||
        hasApiErrorCode(error, 404, 'group_not_found')
      ) {
        void this.store.reload();
      }
    } finally {
      this.working.set(false);
    }
  }

  /**
   * Fija o desfija y mergea `{ pinned }` (spec web/links pin). Solo en vista de grupo; no reordena la lista.
   */
  protected async togglePinned(link: JobLinkSummary, pinned: boolean): Promise<void> {
    const groupId = this.groupId();
    if (groupId === null || this.working()) {
      return;
    }
    this.working.set(true);
    this.failure.set(null);
    try {
      await this.store.setPinned(groupId, link.id, pinned);
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
      if (
        hasApiErrorCode(error, 404, 'link_not_found') ||
        hasApiErrorCode(error, 404, 'group_not_found')
      ) {
        void this.store.reload();
      }
    } finally {
      this.working.set(false);
    }
  }

  /**
   * Reemplaza el conjunto de tags y mergea `{ tags }` (spec web/links tags). Solo en vista de grupo.
   */
  protected async saveTags(link: JobLinkSummary, tags: string[]): Promise<void> {
    const groupId = this.groupId();
    if (groupId === null || this.working()) {
      return;
    }
    this.working.set(true);
    this.failure.set(null);
    try {
      await this.store.setTags(groupId, link.id, tags);
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
      if (
        hasApiErrorCode(error, 404, 'link_not_found') ||
        hasApiErrorCode(error, 404, 'group_not_found')
      ) {
        void this.store.reload();
      }
    } finally {
      this.working.set(false);
    }
  }

  /**
   * Quién puede encender y apagar el enlace público: en un grupo, quien compartió el link y el propietario (ADR-027
   * §2). La **marca** de que está publicado la ve cualquier miembro, y eso lo decide la tarjeta.
   */
  protected canPublish(link: JobLinkSummary): boolean {
    return this.scope() === 'group' && this.isSharerOrOwner(link);
  }

  /**
   * Enciende el enlace público tras una confirmación que dice el alcance: quien lo pulsa está a punto de repartir una
   * URL que cualquiera puede abrir, y lo que no se ve —el grupo, su nombre, los comentarios— importa tanto como lo que
   * sí. La tarjeta se actualiza sin recargar la lista.
   */
  protected async publish(link: JobLinkSummary): Promise<void> {
    const groupId = this.groupId();
    if (groupId === null || this.working()) {
      return;
    }
    const confirmed = await confirmWith(this.dialog, {
      title: $localize`:@@links.public.shareTitle:Compartir con un enlace público`,
      message: $localize`:@@links.public.shareMessage:Cualquiera con este enlace podrá ver la oferta sin entrar en LinkVault. No verá el grupo ni los comentarios, y tu nombre solo lo verá quien ya comparta un grupo contigo. Puedes dejar de compartirlo cuando quieras.`,
      confirmLabel: $localize`:@@links.public.shareConfirm:Compartir`,
    });
    if (!confirmed) {
      return;
    }
    await this.runPublicShare(() => this.store.publish(groupId, link.id));
  }

  /**
   * Apaga el enlace público tras confirmarlo. El texto dice lo que de verdad pasa: el enlace muere para todo el mundo,
   * volver a encenderlo crea otro distinto, y la tarjeta que un chat ya pintó puede seguir viéndose ahí.
   */
  protected async unpublish(link: JobLinkSummary): Promise<void> {
    const groupId = this.groupId();
    if (groupId === null || this.working()) {
      return;
    }
    const confirmed = await confirmWith(this.dialog, {
      title: $localize`:@@links.public.stopTitle:Dejar de compartir`,
      message: $localize`:@@links.public.stopMessage:El enlace dejará de funcionar para todo el mundo, también para quien ya lo tenga. Si vuelves a activarlo, se creará un enlace nuevo. Las vistas previas ya enviadas en un chat pueden seguir viéndose ahí.`,
      confirmLabel: $localize`:@@links.public.stopConfirm:Dejar de compartir`,
    });
    if (!confirmed) {
      return;
    }
    await this.runPublicShare(() => this.store.unpublish(groupId, link.id));
  }

  /** Ejecuta el gesto del interruptor: un `403` se explica con sus palabras y un `404` vuelve a pedir la lista. */
  private async runPublicShare(action: () => Promise<unknown>): Promise<void> {
    this.working.set(true);
    this.failure.set(null);
    try {
      await action();
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

  /**
   * Copia la URL pública. Si la oferta todavía no se ha leído, **avisa y copia igualmente** (business 2): se comparte y
   * se reparte en el mismo minuto, y una tarjeta sin datos en WhatsApp no se puede rehacer porque el chat la cachea.
   * Avisar sin bloquear respeta que la persona sepa lo que hace.
   */
  protected async copyPublicLink(link: JobLinkSummary): Promise<void> {
    const share = link.publicShare;
    if (share === undefined) {
      return;
    }
    this.failure.set(null);
    try {
      await navigator.clipboard.writeText(share.url);
    } catch {
      this.failure.set({ kind: 'unknown' });
      return;
    }
    // El aviso depende de que la tarjeta no tenga puesto, no del nombre del estado (design D6 de usage-guide-fixes).
    const warning = emptyCardNotice(link, new Date());
    this.notice(
      warning === null
        ? $localize`:@@links.public.copied:Enlace copiado`
        : emptyCardNoticeText(warning),
    );
  }

  private notice(message: string): void {
    this.snackBar.open(message, undefined, { duration: COPY_NOTICE_MS, politeness: 'assertive' });
  }

  private isSharerOrOwner(link: JobLinkSummary): boolean {
    const userId = this.session.user()?.id;
    return this.canModerate() || (userId !== undefined && link.sharedBy?.userId === userId);
  }

  /**
   * Solo se borra la relación con este grupo o con esta lista: la vacante sigue en los demás. En un grupo, la
   * confirmación dice cuántos comentarios se van con ella (spec web/links): el número sale del contador del link, no de
   * los dos que enseña la tarjeta.
   */
  protected async remove(link: JobLinkSummary): Promise<void> {
    this.removingCommentCount.set(link.comments?.count ?? 0);
    this.removingPublished.set(this.scope() === 'group' && link.publicShare !== undefined);
    const confirmed = await confirmWith(this.dialog, {
      title: $localize`:@@links.list.removeTitle:Quitar el enlace`,
      message:
        this.scope() === 'mine'
          ? $localize`:@@links.list.removeMessageMine:Se quita de tu lista; la oferta sigue disponible en tus grupos.`
          : this.removeGroupMessage(),
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
