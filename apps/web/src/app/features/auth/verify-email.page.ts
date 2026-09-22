import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { verifyEmailRequestSchema } from '@linkvault/shared';
import { type RequestFailure, isApiFailure, toRequestFailure } from '../../core/api/api-error';
import { AuthApi } from '../../core/auth/auth.api';
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

  private async verify(): Promise<void> {
    this.phase.set('loading');
    this.failure.set(null);
    try {
      await this.authApi.verifyEmail(verifyEmailRequestSchema.parse({ token: this.token }));
      if (this.session.isAuthenticated()) {
        await this.authApi.getProfile();
      }
      this.phase.set('success');
    } catch (error: unknown) {
      const failure = toRequestFailure(error);
      this.failure.set(failure);
      this.phase.set(isApiFailure(failure, 400, 'invalid_token') ? 'invalid' : 'error');
    }
  }
}
