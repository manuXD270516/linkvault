import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MAT_SNACK_BAR_DATA, MatSnackBarRef } from '@angular/material/snack-bar';
import { ShareScopeDialog } from './share-scope.dialog';

/** Mínimo que un aviso sigue a la vista (business 4): da tiempo a leerlo y a llegar a él con el teclado. */
export const SHARE_NOTICE_MIN_MS = 10_000;

/**
 * Qué aviso se muestra:
 * - `invite`: tras "Me interesa" o "Postulé" en un grupo, con el alcance en una línea, "Compartir" y "Qué verán".
 * - `shared`: "Compartido · Deshacer".
 * La acción principal cierra el aviso con `dismissWithAction`; quien lo abrió decide qué hacer.
 */
export type ShareNoticeData =
  | { kind: 'invite'; gesture: 'interested' | 'applied' }
  | { kind: 'shared' };

/**
 * Aviso de compartir tras el gesto (D7). Se abre con `openFromComponent` porque lleva dos acciones y un snackbar simple
 * solo admite una. El contenedor del snackbar lo anuncia con `aria-live` (`politeness: 'polite'`).
 *
 * No tiene duración propia: no se cierra antes de 10 s ni mientras el foco esté dentro (o en "Qué verán"); pasado el
 * mínimo, se cierra en cuanto el foco no está en él.
 */
@Component({
  selector: 'lv-share-notice',
  imports: [MatButtonModule],
  template: `
    <div class="flex flex-wrap items-center gap-2" (focusout)="onFocusOut($event)" data-testid="share-notice">
      @if (data.kind === 'invite') {
        <span class="flex-1" data-testid="share-notice-text">
          @if (data.gesture === 'applied') {
            <ng-container i18n="@@applications.share.inviteApplied"
              >¿Que tus grupos vean que postulaste a esta oferta? También quien entre después.</ng-container
            >
          } @else {
            <ng-container i18n="@@applications.share.inviteInterested"
              >¿Que tus grupos vean que te interesa esta oferta? También quien entre después.</ng-container
            >
          }
        </span>
        <button mat-button type="button" (click)="showScope()" data-testid="share-notice-scope" i18n="@@applications.share.whatTheyWillSee">
          Qué verán
        </button>
        <button mat-flat-button type="button" (click)="act()" data-testid="share-notice-share" i18n="@@applications.share.share">
          Compartir
        </button>
      } @else {
        <span class="flex-1" data-testid="share-notice-text" i18n="@@applications.share.shared">Compartido</span>
        <button mat-button type="button" (click)="act()" data-testid="share-notice-undo" i18n="@@applications.share.undo">
          Deshacer
        </button>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareNotice {
  protected readonly data = inject<ShareNoticeData>(MAT_SNACK_BAR_DATA);
  private readonly snackBarRef = inject<MatSnackBarRef<ShareNotice>>(MatSnackBarRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly dialog = inject(MatDialog);

  /** `true` cuando ya pasó el mínimo: desde ahí, perder el foco lo cierra. */
  private readonly minimumElapsed = signal(false);
  /** `true` mientras "Qué verán" está abierto: el foco está en el diálogo, no fuera del aviso. */
  private readonly showingScope = signal(false);

  constructor() {
    const timer = setTimeout(() => {
      this.minimumElapsed.set(true);
      this.dismissIfIdle();
    }, SHARE_NOTICE_MIN_MS);
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }

  protected act(): void {
    this.snackBarRef.dismissWithAction();
  }

  protected showScope(): void {
    this.showingScope.set(true);
    this.dialog
      .open(ShareScopeDialog)
      .afterClosed()
      .subscribe(() => {
        this.showingScope.set(false);
        this.dismissIfIdle();
      });
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.nativeElement.contains(next)) {
      return;
    }
    // El foco se va cuando termina de moverse: se mira en la siguiente vuelta, no en medio del cambio.
    setTimeout(() => this.dismissIfIdle());
  }

  private dismissIfIdle(): void {
    if (!this.minimumElapsed() || this.showingScope()) {
      return;
    }
    const active = this.host.nativeElement.ownerDocument.activeElement;
    if (active !== null && this.host.nativeElement.contains(active)) {
      return;
    }
    this.snackBarRef.dismiss();
  }
}
