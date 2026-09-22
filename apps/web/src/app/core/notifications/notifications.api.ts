import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  NotificationPreferences,
  PatchNotificationPreferencesRequest,
  PushSubscriptionRequest,
  VapidPublicKeyResponse,
} from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';

const PREFERENCES_URL = '/api/notifications/preferences';
const PUSH_SUBSCRIPTIONS_URL = '/api/notifications/push-subscriptions';
const VAPID_URL = '/api/notifications/push-vapid-public-key';

/**
 * Preferencias y suscripciones Web Push (change notifications, ADR-035). El Bearer lo pone `authInterceptor`.
 * Solo importa tipos de `@linkvault/shared`.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsApi {
  private readonly http = inject(HttpClient);

  getPreferences(): Promise<NotificationPreferences> {
    return firstValueFrom(this.http.get<NotificationPreferences>(PREFERENCES_URL));
  }

  patchPreferences(body: PatchNotificationPreferencesRequest): Promise<NotificationPreferences> {
    return firstValueFrom(this.http.patch<NotificationPreferences>(PREFERENCES_URL, body));
  }

  getVapidPublicKey(): Promise<VapidPublicKeyResponse> {
    return firstValueFrom(this.http.get<VapidPublicKeyResponse>(VAPID_URL));
  }

  /** Alta o idempotente si el endpoint ya existía (`201` / `200`). */
  registerPushSubscription(body: PushSubscriptionRequest): Promise<void> {
    return firstValueFrom(this.http.post<null>(PUSH_SUBSCRIPTIONS_URL, body)).then(() => undefined);
  }

  /** Baja por endpoint (query); `204` aunque no existiera. */
  async removePushSubscription(endpoint: string): Promise<void> {
    const params = new HttpParams().set('endpoint', endpoint);
    await firstValueFrom(this.http.delete<null>(PUSH_SUBSCRIPTIONS_URL, { params }));
  }
}
