import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { TextFieldModule } from '@angular/cdk/text-field';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  InjectionToken,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
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
  COMMENT_TEXT_MAX_LENGTH,
  type CommentPage,
  type GroupLinkComment,
  type GroupLinkCommentsMessage,
  commentTextLength,
  normalizeCommentText,
} from '@linkvault/shared';
import { type RequestFailure, hasApiErrorCode, toRequestFailure } from '../../core/api/api-error';
import { LinksApi } from '../../core/links/links.api';
import { SessionStore } from '../../core/auth/session.store';
import { EventsChannel } from '../../core/events/events.channel';
import { LinksStore } from '../../core/links/links.store';
import { confirmWith } from '../../shared/ui/confirm.dialog';
import { RequestError } from '../../shared/ui/request-error';
import { CommentAgo } from './comment-ago.component';

/** El hilo que se abre: el link en ese grupo, cómo se llama la oferta y si quien mira es el propietario. */
export interface CommentsDialogData {
  groupId: string;
  linkId: string;
  /** Lo que la tarjeta muestra como título: el de la vacante o la etiqueta derivada de la URL. */
  headline: string;
  /** `true` si quien mira es el propietario del grupo: puede borrar cualquier comentario. */
  canModerate: boolean;
}

/**
 * Tamaño del hilo en pantallas a partir de `sm`. `maxWidth` es `100vw` para que por debajo de `sm` pueda ocupar la
 * pantalla completa: el ancho de verdad lo pone `width`, que nunca pasa del 95 % de la ventana.
 */
export const COMMENTS_DIALOG_SIZE = { width: 'min(640px, 95vw)', maxWidth: '100vw' } as const;

/** Clase del panel en pantalla completa: quita las esquinas redondeadas (`styles.scss`). */
export const FULL_SCREEN_PANEL_CLASS = 'lv-dialog-fullscreen';

/** Lo que el hilo usa del viewport visual (`window.visualViewport`). */
export interface VisualViewportLike extends EventTarget {
  readonly height: number;
  readonly offsetTop: number;
}

/**
 * El viewport visual del navegador, o `null` donde no existe. Es un token para que los tests simulen el teclado de un
 * móvil sin tocar `window`.
 */
export const VISUAL_VIEWPORT = new InjectionToken<VisualViewportLike | null>('VISUAL_VIEWPORT', {
  providedIn: 'root',
  factory: () => (typeof window === 'undefined' ? null : (window.visualViewport ?? null)),
});

/** Qué se dice cuando publicar falla. */
type PostError = { kind: 'tooMany'; minutes: number | null } | { kind: 'failed' };

/** `'gone'` si el hilo se cerró porque la oferta ya no está en el grupo (o la persona ya no es miembro). */
export type CommentsDialogResult = 'gone' | undefined;

/**
 * Hilo de comentarios de un link en un grupo (D11 de group-comments, spec web/group-comments "Hilo de comentarios"). Pinta
 * en orden cronológico, el más reciente abajo, con "Ver comentarios anteriores" arriba mientras queden más.
 *
 * El hilo no vive en ningún store: es de este diálogo y se olvida al cerrarlo. Lo que sí cambia la tarjeta (publicar y
 * borrar) pasa por `LinksStore`, que aplica el resumen de la respuesta.
 */
@Component({
  selector: 'lv-comments-dialog',
  imports: [
    CommentAgo,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    RequestError,
    TextFieldModule,
  ],
  templateUrl: './comments.dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommentsDialog {
  private readonly api = inject(LinksApi);
  private readonly store = inject(LinksStore);
  private readonly session = inject(SessionStore);
  private readonly dialog = inject(MatDialog);
  private readonly dialogRef =
    inject<MatDialogRef<CommentsDialog, CommentsDialogResult>>(MatDialogRef);
  private readonly injector = inject(Injector);
  protected readonly data = inject<CommentsDialogData>(MAT_DIALOG_DATA);

  /** Lo cargado del hilo, del más antiguo al más reciente. */
  protected readonly comments = signal<GroupLinkComment[]>([]);
  /** Cursor de la página siguiente hacia atrás; `null` cuando ya no quedan más antiguos. */
  private readonly olderCursor = signal<string | null>(null);
  protected readonly hasOlder = computed(() => this.olderCursor() !== null);
  protected readonly loaded = signal(false);
  protected readonly loadingOlder = signal(false);
  protected readonly isEmpty = computed(() => this.loaded() && this.comments().length === 0);
  /** Fallo de una lectura que no es un `404`: el hilo sigue abierto con lo que ya tenía. */
  protected readonly failure = signal<RequestFailure | null>(null);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  /** `true` por debajo del punto de corte `sm`: el hilo ocupa la pantalla completa (business 9). */
  protected readonly fullScreen = signal(false);
  /**
   * Alto y desplazamiento del viewport visual, que es lo que queda por encima del teclado en un móvil. En pantalla
   * completa el diálogo mide eso, así que el pie con "Comentar" queda siempre a la vista. `null` sin esa API.
   */
  private readonly visualViewport = signal<{ height: number; offsetTop: number } | null>(null);
  protected readonly frameHeight = computed(() => {
    const viewport = this.visualViewport();
    return this.fullScreen() ? (viewport === null ? '100dvh' : `${viewport.height}px`) : null;
  });
  protected readonly frameOffset = computed(() => {
    const viewport = this.visualViewport();
    return this.fullScreen() && viewport !== null && viewport.offsetTop > 0
      ? `translateY(${viewport.offsetTop}px)`
      : null;
  });

  /** Lo escrito: se conserva ante cualquier error (spec "Escribir un comentario"). */
  protected readonly draft = signal('');
  /** Longitud de lo que se publicaría: normalizado y en code points, como lo mide la API. */
  protected readonly draftLength = computed(() =>
    commentTextLength(normalizeCommentText(this.draft())),
  );
  protected readonly maxLength = COMMENT_TEXT_MAX_LENGTH;
  protected readonly tooLong = computed(() => this.draftLength() > COMMENT_TEXT_MAX_LENGTH);
  protected readonly posting = signal(false);
  /** El comentario que se está borrando (o cuya confirmación está abierta); `null` si ninguno. */
  protected readonly deletingId = signal<string | null>(null);
  protected readonly canPost = computed(
    () => this.draftLength() > 0 && !this.tooLong() && !this.posting(),
  );
  private readonly postFailure = signal<RequestFailure | null>(null);
  /** Qué se dice si publicar falla: los `429` con su espera; lo demás, el mensaje genérico. */
  protected readonly postError = computed((): PostError | null => {
    const failure = this.postFailure();
    if (failure === null) {
      return null;
    }
    return failure.kind === 'api' && failure.status === 429 && failure.code === 'too_many_attempts'
      ? { kind: 'tooMany', minutes: failure.retryAfterMinutes }
      : { kind: 'failed' };
  });

  /** `true` si llegaron comentarios que el aviso no traía (varios a la vez): se ofrece "Ver comentarios nuevos". */
  protected readonly newAvailable = signal(false);

  constructor() {
    this.followBreakpoint();
    this.followVisualViewport();
    inject(EventsChannel)
      .groupLinkComments.pipe(takeUntilDestroyed())
      .subscribe((message) => this.applyNotice(message));
    void this.loadFirstPage();
  }

  /** Vuelve a pedir la primera página cuando llegaron más comentarios de los que traía el aviso. */
  protected async loadNewer(): Promise<void> {
    this.newAvailable.set(false);
    await this.loadFirstPage();
  }

  /**
   * Aviso en vivo de este link en este grupo (spec "Comentarios en vivo"). Un alta que viene en el resumen se añade,
   * sin repetir la que ya estuviera (la propia llega también por la respuesta); una que no viene ofrece "Ver comentarios
   * nuevos"; un borrado se quita. La tarjeta la actualiza `LinksStore` con el mismo aviso.
   */
  private applyNotice(message: GroupLinkCommentsMessage): void {
    if (message.groupId !== this.data.groupId || message.linkId !== this.data.linkId) {
      return;
    }
    if (message.change === 'deleted') {
      this.dropComment(message.commentId);
      return;
    }
    if (this.comments().some((comment) => comment.id === message.commentId)) {
      return;
    }
    const fresh = message.comments.latest.find((comment) => comment.id === message.commentId);
    if (fresh === undefined) {
      this.newAvailable.set(true);
      return;
    }
    this.comments.set(mergeChronologically(this.comments(), [fresh]));
    this.scrollToEnd();
  }

  protected onDraft(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  /** Ctrl+Enter (Cmd+Enter en macOS) publica; Enter a secas es un salto de línea. */
  protected onDraftKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void this.post();
    }
  }

  /**
   * Publica lo escrito. El botón y el atajo no hacen nada mientras hay un envío en curso, así que nunca salen dos
   * peticiones. El comentario se añade abajo del hilo y la tarjeta cambia con el resumen de la respuesta (`LinksStore`).
   */
  protected async post(): Promise<void> {
    if (!this.canPost()) {
      return;
    }
    this.posting.set(true);
    this.postFailure.set(null);
    try {
      const { comment } = await this.store.postComment(
        this.data.groupId,
        this.data.linkId,
        this.draft(),
      );
      this.comments.set(mergeChronologically(this.comments(), [comment]));
      this.draft.set('');
      this.scrollToEnd();
    } catch (error: unknown) {
      if (isGone(error)) {
        this.dialogRef.close('gone');
        return;
      }
      this.postFailure.set(toRequestFailure(error));
    } finally {
      this.posting.set(false);
    }
  }

  /** "Borrar" se ofrece en lo propio y, al propietario del grupo, en todo (D4 de group-comments). */
  protected canDelete(comment: GroupLinkComment): boolean {
    return this.data.canModerate || this.isMine(comment);
  }

  /**
   * Borra un comentario tras confirmarlo, con un texto distinto si es ajeno: desaparece para todo el grupo. Mientras la
   * confirmación está abierta o la petición en curso, los botones de borrar no responden. Un `404 comment_not_found` ya
   * es lo pedido (se borró en otra pestaña) y se trata como éxito; la tarjeta toma el resumen de la respuesta.
   */
  protected async remove(comment: GroupLinkComment): Promise<void> {
    if (this.deletingId() !== null) {
      return;
    }
    this.deletingId.set(comment.id);
    try {
      const confirmed = await confirmWith(this.dialog, {
        title: $localize`:@@comments.delete.title:Borrar el comentario`,
        message: this.isMine(comment)
          ? $localize`:@@comments.delete.own:¿Borrar tu comentario? No se puede deshacer.`
          : $localize`:@@comments.delete.other:¿Borrar el comentario de ${comment.author.displayName}:NAME:? Desaparecerá para todo el grupo y no se puede deshacer.`,
        confirmLabel: $localize`:@@comments.delete.confirm:Borrar`,
      });
      if (!confirmed) {
        return;
      }
      this.failure.set(null);
      await this.store.deleteComment(this.data.groupId, this.data.linkId, comment.id);
      this.dropComment(comment.id);
    } catch (error: unknown) {
      this.fail(error);
    } finally {
      this.deletingId.set(null);
    }
  }

  private isMine(comment: GroupLinkComment): boolean {
    return comment.author.userId === this.session.user()?.id;
  }

  private dropComment(commentId: string): void {
    this.comments.set(this.comments().filter((comment) => comment.id !== commentId));
  }

  /** Pantalla completa por debajo de `sm`, y el tamaño normal por encima; sigue al giro del móvil. */
  private followBreakpoint(): void {
    const subscription = inject(BreakpointObserver)
      .observe(Breakpoints.XSmall)
      .subscribe(({ matches }) => {
        this.fullScreen.set(matches);
        if (matches) {
          this.dialogRef.addPanelClass(FULL_SCREEN_PANEL_CLASS);
          this.dialogRef.updateSize('100vw', '100dvh');
        } else {
          this.dialogRef.removePanelClass(FULL_SCREEN_PANEL_CLASS);
          this.dialogRef.updateSize(COMMENTS_DIALOG_SIZE.width, '');
        }
      });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }

  private followVisualViewport(): void {
    const viewport = inject(VISUAL_VIEWPORT);
    if (viewport === null) {
      return;
    }
    const update = (): void =>
      this.visualViewport.set({ height: viewport.height, offsetTop: viewport.offsetTop });
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    inject(DestroyRef).onDestroy(() => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    });
  }

  /** Trae la página siguiente hacia atrás y la pone arriba, sin repetir ni perder lo que ya se ve. */
  protected async loadOlder(): Promise<void> {
    const cursor = this.olderCursor();
    if (cursor === null || this.loadingOlder()) {
      return;
    }
    this.loadingOlder.set(true);
    this.failure.set(null);
    try {
      const page = await this.api.comments(this.data.groupId, this.data.linkId, { cursor });
      this.comments.set(mergeChronologically(chronological(page), this.comments()));
      this.olderCursor.set(page.nextCursor ?? null);
    } catch (error: unknown) {
      this.fail(error);
    } finally {
      this.loadingOlder.set(false);
    }
  }

  /** La primera página, con el más reciente abajo y a la vista. */
  private async loadFirstPage(): Promise<void> {
    this.failure.set(null);
    try {
      const page = await this.api.comments(this.data.groupId, this.data.linkId);
      this.comments.set(chronological(page));
      this.olderCursor.set(page.nextCursor ?? null);
      this.loaded.set(true);
      this.scrollToEnd();
    } catch (error: unknown) {
      this.fail(error);
    }
  }

  /**
   * Un `404` (`group_not_found` o `link_not_found`) es que la oferta ya no está en el grupo o que quien mira ya no es
   * miembro: el hilo se cierra y quien lo abrió lo dice y recarga la lista. Lo demás se muestra dentro del hilo.
   */
  private fail(error: unknown): void {
    if (isGone(error)) {
      this.dialogRef.close('gone');
      return;
    }
    this.failure.set(toRequestFailure(error));
  }

  /** Lleva el hilo al final tras pintarse: lo último que se escribió es lo que se quiere ver. */
  private scrollToEnd(): void {
    afterNextRender(
      () => {
        const element = this.scroller()?.nativeElement;
        if (element !== undefined) {
          element.scrollTop = element.scrollHeight;
        }
      },
      { injector: this.injector },
    );
  }
}

/** La API da el hilo del más reciente al más antiguo; en pantalla va al revés. */
function chronological(page: CommentPage): GroupLinkComment[] {
  return [...page.items].reverse();
}

/**
 * Une dos tramos del hilo sin repetir ningún comentario (por `id`) y en orden cronológico, con el mismo desempate que
 * la API (`createdAt` y después `id`): da igual que un aviso en vivo llegue antes o después de la respuesta propia.
 */
function mergeChronologically(
  first: readonly GroupLinkComment[],
  second: readonly GroupLinkComment[],
): GroupLinkComment[] {
  const byId = new Map<string, GroupLinkComment>();
  for (const comment of [...first, ...second]) {
    byId.set(comment.id, comment);
  }
  return [...byId.values()].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function isGone(error: unknown): boolean {
  return (
    hasApiErrorCode(error, 404, 'group_not_found') || hasApiErrorCode(error, 404, 'link_not_found')
  );
}
