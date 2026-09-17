import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { type HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type EnvironmentProviders, type Provider, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import type {
  GroupDetail,
  GroupMember,
  GroupSummary,
  SessionResponse,
  UserProfile,
} from '@linkvault/shared';
import { appRoutes } from '../app/app.routes';
import { authInterceptor } from '../app/core/auth/auth.interceptor';
import { REFRESH_LOCKS } from '../app/core/auth/refresh-coordination';

/** Utilidades compartidas por los tests de páginas de `web`. No las importa código de producción. */

export const testUser: UserProfile = {
  id: 'u1',
  email: 'ana@example.com',
  displayName: 'Ana',
  aiConsent: { externalProviders: false },
  outputLanguage: 'es',
  redactName: false,
  createdAt: '2026-09-17T10:00:00.000Z',
};

export function sessionWith(
  accessToken: string,
  user: UserProfile = testUser,
): SessionResponse {
  return { accessToken, expiresIn: 900, user };
}

export function apiError(
  code: string,
  status: number,
  headers: Record<string, string> = {},
): { body: { code: string; message: string }; options: { status: number; statusText: string; headers: Record<string, string> } } {
  return {
    body: { code, message: code },
    options: { status, statusText: String(status), headers },
  };
}

/** Rutas reales, interceptor real y API simulada con `HttpTestingController`. */
export function providePageTesting(): (Provider | EnvironmentProviders)[] {
  return [
    provideZonelessChangeDetection(),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideHttpClientTesting(),
    provideRouter(appRoutes),
    { provide: REFRESH_LOCKS, useValue: null },
  ];
}

/**
 * Responde a la carga de la lista que `/grupos` pide al entrar. Espera a la petición porque el router activa la página
 * en la detección de cambios, un paso después de que la URL ya sea `/grupos`.
 */
export async function flushGroupsList(
  http: HttpTestingController,
  groups: GroupSummary[] = [],
): Promise<void> {
  const request = await vi.waitFor(() => http.expectOne({ method: 'GET', url: '/api/groups' }));
  request.flush(groups);
}

/** Responde al grupo y a sus miembros, las dos peticiones que `/grupos/:id` hace al entrar. */
export async function flushGroupDetail(
  http: HttpTestingController,
  detail: GroupDetail,
  members: GroupMember[] = [],
): Promise<void> {
  const url = `/api/groups/${detail.id}`;
  const group = await vi.waitFor(() => http.expectOne({ method: 'GET', url }));
  group.flush(detail);
  const list = await vi.waitFor(() => http.expectOne({ method: 'GET', url: `${url}/members` }));
  list.flush(members);
}

export function typeInto(host: HTMLElement, selector: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(selector);
  if (!input) {
    throw new Error(`Input "${selector}" not found`);
  }
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

export function buttonWithText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find((element) =>
    element.textContent?.includes(text),
  );
  if (!button) {
    throw new Error(`Button "${text}" not found`);
  }
  return button;
}

export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
