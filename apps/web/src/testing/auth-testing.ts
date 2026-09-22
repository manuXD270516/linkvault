import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { type HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type EnvironmentProviders, type Provider, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  AI_CONSENT_TEXT_VERSION,
  type GroupDetail,
  type GroupMember,
  type GroupSummary,
  type JobLinkSummary,
  type SessionResponse,
  type UserProfile,
} from '@linkvault/shared';
import { appRoutes } from '../app/app.routes';
import { authInterceptor } from '../app/core/auth/auth.interceptor';
import { REFRESH_LOCKS } from '../app/core/auth/refresh-coordination';
import { EventsChannel } from '../app/core/events/events.channel';

/** Utilidades compartidas por los tests de páginas de `web`. No las importa código de producción. */

export const testUser: UserProfile = {
  id: 'u1',
  email: 'ana@example.com',
  displayName: 'Ana',
  aiConsent: {
    externalProviders: false,
    consentedAt: null,
    textVersion: null,
    currentTextVersion: AI_CONSENT_TEXT_VERSION,
  },
  outputLanguage: 'es',
  /** `redactName` nace activado (ADR-030 §10). */
  redactName: true,
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

/**
 * Responde al grupo, a sus miembros y a la primera página de sus links, las tres peticiones que `/grupos/:id` hace al
 * entrar. Los links se piden los últimos, ya sabiendo que el grupo existe.
 */
export async function flushGroupDetail(
  http: HttpTestingController,
  detail: GroupDetail,
  members: GroupMember[] = [],
  links: JobLinkSummary[] = [],
): Promise<void> {
  const url = `/api/groups/${detail.id}`;
  const group = await vi.waitFor(() => http.expectOne({ method: 'GET', url }));
  group.flush(detail);
  const list = await vi.waitFor(() => http.expectOne({ method: 'GET', url: `${url}/members` }));
  list.flush(members);
  const page = await vi.waitFor(() => http.expectOne(`${url}/links?limit=20`));
  page.flush({ items: links, total: links.length });
}

/**
 * Comprueba que no quedó ninguna petición sin responder, cerrando antes el canal de eventos: las pantallas de links lo
 * abren con una petición que **no termina nunca** (es un flujo SSE), así que sin cerrarlo `verify()` la contaría como
 * pendiente en cualquier test que pase por ellas. Al cerrarlo queda cancelada, que es lo que se ignora.
 */
export function verifyNoPendingRequests(http: HttpTestingController): void {
  TestBed.inject(EventsChannel).disconnect();
  flushPendingApplicationStates(http);
  http.verify({ ignoreCancelled: true });
}

/**
 * Responde vacío a las peticiones de fondo que las pantallas disparan solas al pintar (estados de postulaciones
 * y listado BYOK del perfil). Los tests que no las ejercitan no tienen por qué responderlas a mano.
 */
export function flushPendingApplicationStates(http: HttpTestingController): void {
  const pending = http.match(
    (request) =>
      request.method === 'GET' &&
      (request.url === '/api/users/me/ai-keys' ||
        (request.url === '/api/applications' && request.params.has('linkIds')) ||
        /^\/api\/groups\/[^/]+\/applications$/.test(request.url)),
  );
  for (const pendingRequest of pending) {
    if (!pendingRequest.cancelled) {
      if (pendingRequest.request.url === '/api/users/me/ai-keys') {
        pendingRequest.flush({ keys: [] });
      } else {
        pendingRequest.flush({ items: [] });
      }
    }
  }
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
