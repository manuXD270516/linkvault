import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { verifyEmailRequestSchema } from '@linkvault/shared';
import { type RequestFailure, isApiFailure, toRequestFailure } from '../../core/api/api-error';
import { AuthApi } from '../../core/auth/auth.api';
import { SessionRestore } from '../../core/auth/session-restore';
import { SessionStore } from '../../core/auth/session.store';
import { RequestError } from '../../shared/ui/request-error';

type VerifyPhase = 'loading' | 'success' | 'invalid' | 'error';

@Component({
  selector: 'lv-verify-email-page',
  imports: [MatButtonModule, RequestError, RouterLink],
  templateUrl: './verify-email.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VerifyEmailPage {
  private readonly authApi = inject(AuthApi);
  private readonly sessionRestore = inject(SessionRestore);
  protected readonly session = inject(SessionStore);
  /** Token del enlace; solo en memoria (no se escribe en storage del navegador). */
  private readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token')?.trim() ?? '';

  protected readonly phase = signal<VerifyPhase>(this.token.length === 0 ? 'invalid' : 'loading');
  protected readonly failure = signal<RequestFailure | null>(null);

  constructor() {
    if (this.token.length > 0) {
      void this.verify();
    }
  }

  /**
   * Verifica el email y espera a que la sesión termine de restaurarse antes de decidir nada: abrir el enlace del correo
   * es una carga completa, y si el refresh llega después de la verificación trae el perfil que el servidor leyó antes
   * de confirmarla (`emailVerified` `false`) y deja el aviso hasta recargar. `allSettled` y no `all`: un fallo de la
   * verificación no debe adelantarse a la restauración (la pista de invitados parpadearía).
   */
  private async verify(): Promise<void> {
    this.phase.set('loading');
    this.failure.set(null);
    try {
      const request = verifyEmailRequestSchema.parse({ token: this.token });
      const [verification] = await Promise.allSettled([
        this.authApi.verifyEmail(request),
        this.sessionRestore.restore(),
      ]);
      if (verification.status === 'rejected') {
        throw verification.reason;
      }
    } catch (error: unknown) {
      const failure = toRequestFailure(error);
      this.failure.set(failure);
      this.phase.set(isApiFailure(failure, 400, 'invalid_token') ? 'invalid' : 'error');
      return;
    }
    if (this.session.isAuthenticated()) {
      await this.refreshProfile();
    }
    this.phase.set('success');
  }

  /**
   * Pide el perfil ya con la verificación confirmada. Si falla, la verificación ocurrió igual: se marca en local sobre
   * el usuario que haya, y sin usuario (el interceptor limpió la sesión) no se fabrica ninguno.
   */
  private async refreshProfile(): Promise<void> {
    try {
      await this.authApi.getProfile();
    } catch {
      const user = this.session.user();
      if (user !== null) {
        this.session.setUser({ ...user, emailVerified: true });
      }
    }
  }
}
