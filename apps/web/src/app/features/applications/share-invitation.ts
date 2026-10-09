import { Injectable, inject } from '@angular/core';
import { MatSnackBar, type MatSnackBarRef } from '@angular/material/snack-bar';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import type { Application, ApplicationVisibility } from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';
import { type ApplicationRef, ApplicationsStore } from '../../core/applications/applications.store';
import { SHARE_NOTICE_MIN_MS, ShareNotice, type ShareNoticeData } from './share-notice.component';

/**
 * Invitación a compartir tras el gesto (D7, ADR-024 §7). Solo la ofrece el detalle de un grupo y solo si la postulación
 * resultante es privada: en `/mis-links` no hay grupo mirando, y una ya compartida no necesita invitación.
 *
 * "Compartir" y "Deshacer" actúan sobre la postulación **capturada en el gesto**, no sobre la que haya en el store al
 * pulsar. Un `404 application_not_found` (se dejó de seguir en otra pestaña) se trata en silencio: el store ya la quitó
 * y la tarjeta vuelve a ofrecer los gestos. Sin pulsar nada, la postulación sigue privada.
 *
 * El aviso pertenece a la página del grupo donde se abrió (design D8 de usage-guide-fixes): se cierra en cuanto el router
 * empieza una navegación a otro **path** (un cambio solo de query o de fragmento no cuenta), con el desenlace de dejarlo
 * ir, y no se abre si la persona ya salió o está saliendo —la API tarda entre el gesto y la respuesta—.
 */
@Injectable({ providedIn: 'root' })
export class ShareInvitation {
  private readonly snackBar = inject(MatSnackBar);
  private readonly store = inject(ApplicationsStore);
  private readonly router = inject(Router);

  async offer(application: Application, gesture: 'interested' | 'applied'): Promise<void> {
    if (application.visibility !== 'private') {
      return;
    }
    const ref: ApplicationRef = { id: application.id, linkId: application.linkId };
    const gesturePath = pathOf(this.router.url);
    let open: MatSnackBarRef<ShareNotice> | null = null;
    // Salir de la página cierra el aviso abierto: sin acción, así que el desenlace es el de dejarlo ir. Una navegación
    // que luego se cancela ya lo cerró al empezar y no lo reabre (P1-D).
    const leaving = this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart && pathOf(event.url) !== gesturePath) {
        open?.dismiss();
      } else if (event instanceof NavigationEnd && pathOf(event.urlAfterRedirects) !== gesturePath) {
        open?.dismiss();
      }
    });
    const show = async (data: ShareNoticeData): Promise<boolean> => {
      // Antes de abrir: la persona no puede haber salido ni estar saliendo (la API tardó, N9).
      if (!this.onPage(gesturePath)) {
        return false;
      }
      open = this.snackBar.openFromComponent(ShareNotice, { data, politeness: 'polite' });
      const { dismissedByAction } = await firstValueFrom(open.afterDismissed());
      open = null;
      return dismissedByAction;
    };
    try {
      if (!(await show({ kind: 'invite', gesture }))) {
        return;
      }
      if (!(await this.setVisibility(ref, 'group'))) {
        return;
      }
      if (await show({ kind: 'shared' })) {
        await this.setVisibility(ref, 'private');
      }
    } finally {
      leaving.unsubscribe();
    }
  }

  /**
   * `true` si la persona sigue en la página del gesto: el path actual es el suyo y ninguna navegación en curso va a
   * otro. Mientras una navegación está en vuelo la URL todavía es la vieja, por eso se mira también la señal.
   */
  private onPage(gesturePath: string): boolean {
    if (pathOf(this.router.url) !== gesturePath) {
      return false;
    }
    const navigation = this.router.currentNavigation();
    if (navigation === null) {
      return true;
    }
    const target = navigation.finalUrl ?? navigation.extractedUrl;
    return pathOf(this.router.serializeUrl(target)) === gesturePath;
  }

  /** `true` si quedó con esa visibilidad; `false` si ya no existía o falló (y entonces se dice). */
  private async setVisibility(ref: ApplicationRef, visibility: ApplicationVisibility): Promise<boolean> {
    try {
      return (await this.store.update(ref, { visibility })) !== null;
    } catch {
      this.snackBar.open(
        $localize`:@@applications.share.failed:No se pudo cambiar lo que ven tus grupos. Inténtalo desde el tablero.`,
        undefined,
        { duration: SHARE_NOTICE_MIN_MS, politeness: 'assertive' },
      );
      return false;
    }
  }
}

/** El path de una URL, sin query ni fragmento: los filtros del grupo cambian la query y no son salir de la página. */
function pathOf(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? '';
}
