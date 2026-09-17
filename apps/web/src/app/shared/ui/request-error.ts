import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { RequestFailure } from '../../core/api/api-error';

/**
 * Mensajes comunes de fallo de una petición (spec web/auth): demasiados intentos, sin conexión y error genérico. Cada
 * formulario muestra antes sus mensajes propios (p. ej. credenciales incorrectas) y delega el resto aquí.
 */
@Component({
  selector: 'lv-request-error',
  template: `
    <p class="text-(--mat-sys-error)" role="alert">
      @switch (kind()) {
        @case ('tooManyAttempts') {
          @let minutes = retryAfterMinutes();
          @if (minutes !== null) {
            <ng-container i18n="@@error.tooManyAttempts"
              >Demasiados intentos. Vuelve a intentarlo en {{ minutes }}
              {minutes, plural, =1 {minuto} other {minutos}}</ng-container
            >
          } @else {
            <ng-container i18n="@@error.tooManyAttemptsLater"
              >Demasiados intentos. Vuelve a intentarlo más tarde</ng-container
            >
          }
        }
        @case ('offline') {
          <ng-container i18n="@@error.offline"
            >No pudimos conectar con LinkVault. Revisa tu conexión</ng-container
          >
        }
        @default {
          <ng-container i18n="@@error.unknown">Algo salió mal. Inténtalo de nuevo</ng-container>
        }
      }
    </p>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestError {
  readonly failure = input.required<RequestFailure>();

  protected readonly kind = computed(() => {
    const failure = this.failure();
    if (failure.kind === 'offline') {
      return 'offline';
    }
    if (failure.kind === 'api' && failure.status === 429 && failure.code === 'too_many_attempts') {
      return 'tooManyAttempts';
    }
    return 'unknown';
  });

  protected readonly retryAfterMinutes = computed(() => {
    const failure = this.failure();
    return failure.kind === 'api' ? failure.retryAfterMinutes : null;
  });
}
