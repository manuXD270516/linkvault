import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
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
 */
@Injectable({ providedIn: 'root' })
export class ShareInvitation {
  private readonly snackBar = inject(MatSnackBar);
  private readonly store = inject(ApplicationsStore);

  async offer(application: Application, gesture: 'interested' | 'applied'): Promise<void> {
    if (application.visibility !== 'private') {
      return;
    }
    const ref: ApplicationRef = { id: application.id, linkId: application.linkId };
    if (!(await this.show({ kind: 'invite', gesture }))) {
      return;
    }
    if (!(await this.setVisibility(ref, 'group'))) {
      return;
    }
    if (await this.show({ kind: 'shared' })) {
      await this.setVisibility(ref, 'private');
    }
  }

  /** Muestra el aviso y espera a que se cierre; `true` si se pulsó su acción principal. */
  private async show(data: ShareNoticeData): Promise<boolean> {
    const ref = this.snackBar.openFromComponent(ShareNotice, { data, politeness: 'polite' });
    const { dismissedByAction } = await firstValueFrom(ref.afterDismissed());
    return dismissedByAction;
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
