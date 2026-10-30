import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { RequestFailure } from '../../core/api/api-error';
import { API_ERROR_COPY } from './api-error-copy';

/** Estados con los que un fallo puede ser pasajero (típicamente el proxy durante un despliegue). */
const TRANSIENT_STATUSES: readonly number[] = [502, 503, 504];

type RequestErrorKind =
  | 'offline'
  | 'tooManyAttempts'
  | 'memberNotFound'
  | 'ownerCannotLeave'
  | 'consentTextOutdated'
  | 'vaultUnavailable'
  | 'unavailable'
  | 'unknown';

/** Código con texto común → variante del componente. Debe coincidir con las entradas `common` de `API_ERROR_COPY`. */
const COMMON_KIND: Readonly<Record<string, RequestErrorKind>> = {
  too_many_attempts: 'tooManyAttempts',
  member_not_found: 'memberNotFound',
  owner_cannot_leave: 'ownerCannotLeave',
  consent_text_outdated: 'consentTextOutdated',
  vault_unavailable: 'vaultUnavailable',
};

/**
 * Mensajes comunes de fallo de una petición (spec web/request-errors, ADR-062): sin conexión, texto común por código,
 * servicio no disponible (502-504 sin código o con un código `fallback`) y fallo inesperado. Cada formulario muestra
 * antes sus mensajes propios (p. ej. credenciales incorrectas) y delega el resto aquí.
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
        @case ('memberNotFound') {
          <ng-container i18n="@@error.memberNotFound"
            >Esa persona ya no está en el grupo. Recarga la página para ver la
            lista actual</ng-container
          >
        }
        @case ('ownerCannotLeave') {
          <ng-container i18n="@@error.ownerCannotLeave"
            >Ahora eres propietario de este grupo. Recarga la página y nombra
            propietario a otro miembro para poder salir</ng-container
          >
        }
        @case ('consentTextOutdated') {
          <ng-container i18n="@@error.consentTextOutdated"
            >El texto del permiso cambió. Recarga la página para leer la versión
            vigente</ng-container
          >
        }
        @case ('vaultUnavailable') {
          <ng-container i18n="@@error.vaultUnavailable"
            >LinkVault no tiene activado el guardado de claves de IA. Tu clave
            no se guardó</ng-container
          >
        }
        @case ('unavailable') {
          <ng-container i18n="@@error.unavailable"
            >LinkVault no está disponible en este momento. Inténtalo en unos
            minutos</ng-container
          >
        }
        @default {
          <ng-container i18n="@@error.unknown"
            >Algo salió mal. Inténtalo de nuevo</ng-container
          >
        }
      }
    </p>
    @if (reference(); as ref) {
      <p
        class="text-sm text-(--mat-sys-on-surface-variant)"
        data-testid="error-reference"
      >
        @if (ref.code !== null) {
          <ng-container i18n="@@error.reference"
            >Si lo reportas, menciona:
            <span class="whitespace-nowrap"
              >{{ ref.status }} · {{ ref.code }}</span
            ></ng-container
          >
        } @else {
          <ng-container i18n="@@error.referenceStatusOnly"
            >Si lo reportas, menciona:
            <span class="whitespace-nowrap">{{
              ref.status
            }}</span></ng-container
          >
        }
      </p>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestError {
  readonly failure = input.required<RequestFailure>();

  protected readonly kind = computed<RequestErrorKind>(() => {
    const failure = this.failure();
    if (failure.kind === 'offline') {
      return 'offline';
    }
    if (failure.kind !== 'api') {
      return 'unknown';
    }
    const { code, status } = failure;
    // 1. Texto común por código, sin mirar el estado: el estado de cada código es fijo en la API.
    if (code !== null && Object.hasOwn(COMMON_KIND, code)) {
      return COMMON_KIND[code];
    }
    // 2. Servicio no disponible: solo sin código o con un código `fallback` (un `local` o `unreachable` no se sabe
    //    si es pasajero; `vault_unavailable` y otros 503 de configuración nunca dicen «en unos minutos»).
    if (
      TRANSIENT_STATUSES.includes(status) &&
      (code === null || this.isFallbackCode(code))
    ) {
      return 'unavailable';
    }
    return 'unknown';
  });

  /** Línea «Si lo reportas, menciona: …»: solo con respuesta HTTP y con los mensajes por clase. */
  protected readonly reference = computed<{
    status: number;
    code: string | null;
  } | null>(() => {
    const failure = this.failure();
    const kind = this.kind();
    if (
      failure.kind !== 'api' ||
      (kind !== 'unavailable' && kind !== 'unknown')
    ) {
      return null;
    }
    const known =
      failure.code !== null && Object.hasOwn(API_ERROR_COPY, failure.code);
    return { status: failure.status, code: known ? failure.code : null };
  });

  protected readonly retryAfterMinutes = computed(() => {
    const failure = this.failure();
    return failure.kind === 'api' ? failure.retryAfterMinutes : null;
  });

  private isFallbackCode(code: string): boolean {
    return (
      Object.hasOwn(API_ERROR_COPY, code) && this.copyOf(code) === 'fallback'
    );
  }

  private copyOf(code: string): string {
    const table: Readonly<Record<string, { readonly copy: string }>> =
      API_ERROR_COPY;
    return table[code].copy;
  }
}
