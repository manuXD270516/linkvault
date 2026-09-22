import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { type RequestFailure, toRequestFailure } from '../../core/api/api-error';
import { AuthApi } from '../../core/auth/auth.api';
import { SessionStore } from '../../core/auth/session.store';
import { RequestError } from '../../shared/ui/request-error';

/**
 * Aviso persistente en rutas autenticadas mientras `emailVerified` sea `false` (spec web/auth).
 * Reenvío solo autenticado; V0 sin enlace de ayuda.
 */
@Component({
  selector: 'lv-email-unverified-banner',
  imports: [MatButtonModule, RequestError],
  template: `
    @if (session.needsEmailVerification()) {
      <aside
        class="flex flex-col gap-2 border-b border-(--mat-sys-outline-variant) bg-(--mat-sys-surface-container) px-4 py-3 text-sm"
        role="status"
        data-testid="email-unverified-banner"
      >
        <p i18n="@@emailVerify.banner.message">
          Tu email aún no está verificado. Revisa tu bandeja o reenvía el correo de verificación.
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <button
            mat-stroked-button
            type="button"
            [disabled]="resending()"
            (click)="resend()"
            i18n="@@emailVerify.banner.resend"
          >
            Reenviar correo
          </button>
          @if (resent()) {
            <p class="m-0 text-(--mat-sys-on-surface-variant)" i18n="@@emailVerify.banner.resent">
              Si procede, te hemos enviado un correo de verificación.
            </p>
          }
        </div>
        @if (failure(); as currentFailure) {
          <lv-request-error [failure]="currentFailure" />
        }
      </aside>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailUnverifiedBanner {
  protected readonly session = inject(SessionStore);
  private readonly authApi = inject(AuthApi);

  protected readonly resending = signal(false);
  protected readonly resent = signal(false);
  protected readonly failure = signal<RequestFailure | null>(null);

  protected async resend(): Promise<void> {
    this.resending.set(true);
    this.failure.set(null);
    this.resent.set(false);
    try {
      await this.authApi.resendVerifyEmail();
      this.resent.set(true);
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
    } finally {
      this.resending.set(false);
    }
  }
}
