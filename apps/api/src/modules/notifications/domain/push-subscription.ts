/** Suscripción Web Push de un usuario (VAPID). */
export interface PushSubscription {
  readonly userId: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly createdAt: Date;
}

export interface NewPushSubscription {
  readonly userId: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly createdAt: Date;
}
