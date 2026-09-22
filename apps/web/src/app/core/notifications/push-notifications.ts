import { Injectable, inject, signal } from '@angular/core';
import { type RequestFailure, toRequestFailure } from '../api/api-error';
import { NotificationsApi } from './notifications.api';
import {
  PushBrowser,
  toPushSubscriptionRequest,
  vapidKeyToBytes,
} from './push-browser';

/** Resultado de intentar activar o desactivar push; la UI lo traduce sin bloquear preferencias email. */
export type PushEnableOutcome =
  | { kind: 'enabled' }
  | { kind: 'disabled' }
  | { kind: 'unsupported' }
  | { kind: 'denied' }
  | { kind: 'vapid_unavailable' }
  | { kind: 'failed'; failure: RequestFailure };

/**
 * Flujo Web Push del SPA: SW + VAPID + alta/baja por endpoint (spec web/notifications, D4).
 * Fallos de permiso o VAPID no lanzan: la página de preferencias email sigue usable.
 */
@Injectable({ providedIn: 'root' })
export class PushNotifications {
  private readonly api = inject(NotificationsApi);
  private readonly browser = inject(PushBrowser);

  /** `true` si hay suscripción activa en este navegador (según último refresh). */
  readonly subscribed = signal(false);
  /** Último fallo de API al activar/desactivar (no el permiso denegado). */
  readonly failure = signal<RequestFailure | null>(null);

  supported(): boolean {
    return this.browser.supported();
  }

  /** Consulta la suscripción del SW sin pedir permiso. */
  async refreshStatus(): Promise<void> {
    if (!this.browser.supported()) {
      this.subscribed.set(false);
      return;
    }
    try {
      const registration = await this.browser.registerServiceWorker();
      const ready = (await this.browser.readyRegistration()) ?? registration;
      const subscription = await this.browser.getSubscription(ready);
      this.subscribed.set(subscription !== null);
    } catch {
      this.subscribed.set(false);
    }
  }

  async enable(): Promise<PushEnableOutcome> {
    this.failure.set(null);
    if (!this.browser.supported()) {
      return { kind: 'unsupported' };
    }
    const permission = await this.browser.requestPermission();
    if (permission !== 'granted') {
      return { kind: 'denied' };
    }
    try {
      const { publicKey } = await this.api.getVapidPublicKey();
      const registration = await this.browser.registerServiceWorker();
      const ready = (await this.browser.readyRegistration()) ?? registration;
      let subscription = await this.browser.getSubscription(ready);
      if (subscription === null) {
        subscription = await this.browser.subscribe(ready, vapidKeyToBytes(publicKey));
      }
      await this.api.registerPushSubscription(toPushSubscriptionRequest(subscription));
      this.subscribed.set(true);
      return { kind: 'enabled' };
    } catch (error: unknown) {
      const failure = toRequestFailure(error);
      this.failure.set(failure);
      if (failure.kind === 'api' && failure.status === 503) {
        return { kind: 'vapid_unavailable' };
      }
      return { kind: 'failed', failure };
    }
  }

  async disable(): Promise<PushEnableOutcome> {
    this.failure.set(null);
    if (!this.browser.supported()) {
      return { kind: 'unsupported' };
    }
    try {
      const registration = await this.browser.registerServiceWorker();
      const ready = (await this.browser.readyRegistration()) ?? registration;
      const subscription = await this.browser.getSubscription(ready);
      if (subscription !== null) {
        await this.api.removePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      this.subscribed.set(false);
      return { kind: 'disabled' };
    } catch (error: unknown) {
      const failure = toRequestFailure(error);
      this.failure.set(failure);
      return { kind: 'failed', failure };
    }
  }
}
