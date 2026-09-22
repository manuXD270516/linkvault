import { Injectable } from '@angular/core';

/** Scope del Service Worker de push (mismo origen que el SPA). */
export const PUSH_SW_URL = '/sw.js';

/**
 * Acceso al API de push del navegador. Se inyecta para poder mockear permiso / SW en tests
 * (spec web/notifications: permiso denegado no bloquea email).
 */
@Injectable({ providedIn: 'root' })
export class PushBrowser {
  supported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  permission(): NotificationPermission {
    return Notification.permission;
  }

  async requestPermission(): Promise<NotificationPermission> {
    return Notification.requestPermission();
  }

  async registerServiceWorker(): Promise<ServiceWorkerRegistration> {
    return navigator.serviceWorker.register(PUSH_SW_URL);
  }

  async readyRegistration(): Promise<ServiceWorkerRegistration> {
    return navigator.serviceWorker.ready;
  }

  async getSubscription(
    registration: ServiceWorkerRegistration,
  ): Promise<PushSubscription | null> {
    return registration.pushManager.getSubscription();
  }

  async subscribe(
    registration: ServiceWorkerRegistration,
    applicationServerKey: Uint8Array,
  ): Promise<PushSubscription> {
    return registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey as BufferSource,
    });
  }
}

/** VAPID en base64 URL-safe → `Uint8Array` para `PushManager.subscribe`. */
export function vapidKeyToBytes(base64Url: string): Uint8Array {
  const padded = base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

/** Extrae el cuerpo tipado de una `PushSubscription` del navegador. */
export function toPushSubscriptionRequest(subscription: PushSubscription): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.['p256dh'];
  const auth = json.keys?.['auth'];
  if (
    typeof endpoint !== 'string' ||
    endpoint.length === 0 ||
    typeof p256dh !== 'string' ||
    typeof auth !== 'string'
  ) {
    throw new Error('Incomplete push subscription');
  }
  return { endpoint, keys: { p256dh, auth } };
}
