export const VAPID_CONFIG = Symbol('VAPID_CONFIG');

export interface VapidConfig {
  readonly publicKey: string | null;
  readonly privateKey: string | null;
  readonly subject: string | null;
}
