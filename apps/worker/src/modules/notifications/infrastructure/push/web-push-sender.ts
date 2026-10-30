import { parse as parseLegacyUrl } from 'node:url';
import { isKnownPushEndpoint } from '@linkvault/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import webpush from 'web-push';
import type {
  NotifyPushSubscription,
  WebPushPayload,
  WebPushSender,
} from '../../application/ports/notify.ports';
import {
  NOTIFY_PUSH_SUBSCRIPTIONS,
  type NotifyPushSubscriptions,
} from '../../application/ports/notify.ports';

export interface VapidKeys {
  readonly publicKey: string | null;
  readonly privateKey: string | null;
  readonly subject: string | null;
}

export const WORKER_VAPID_KEYS = Symbol('WORKER_VAPID_KEYS');

/** Si un endpoint guardado puede recibir un envío. Se inyecta para que los tests con servidores locales usen otra. */
export type PushEndpointPolicy = (endpoint: string) => boolean;

export const PUSH_ENDPOINT_POLICY = Symbol('PUSH_ENDPOINT_POLICY');

/**
 * Política por defecto (D7 de enrichment-egress-guard): el endpoint es de un servicio push conocido **y** el analizador
 * heredado de Node, que es el que usa la librería de envío, lee el mismo host que WHATWG. Si difieren, el host aprobado
 * no sería el host al que se envía y la suscripción se trata como fuera de la lista.
 */
export function createPushEndpointPolicy(
  isKnown: (endpoint: string) => boolean = isKnownPushEndpoint,
): PushEndpointPolicy {
  return (endpoint) => {
    if (!isKnown(endpoint)) return false;
    const whatwg = whatwgHost(endpoint);
    return whatwg !== null && whatwg === legacyHost(endpoint);
  };
}

function whatwgHost(endpoint: string): string | null {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return null;
  }
}

function legacyHost(endpoint: string): string | null {
  try {
    return parseLegacyUrl(endpoint).hostname;
  } catch {
    return null;
  }
}

@Injectable()
export class WebPushVapidSender implements WebPushSender {
  private readonly logger = new Logger(WebPushVapidSender.name);
  private readonly configured: boolean;

  constructor(
    @Inject(WORKER_VAPID_KEYS) private readonly vapid: VapidKeys,
    @Inject(NOTIFY_PUSH_SUBSCRIPTIONS)
    private readonly subscriptions: NotifyPushSubscriptions,
    @Optional()
    @Inject(PUSH_ENDPOINT_POLICY)
    private readonly endpointPolicy: PushEndpointPolicy = createPushEndpointPolicy(),
  ) {
    const pub = vapid.publicKey?.trim() ?? '';
    const priv = vapid.privateKey?.trim() ?? '';
    const subject = vapid.subject?.trim() ?? '';
    this.configured = pub !== '' && priv !== '' && subject !== '';
    if (this.configured) {
      webpush.setVapidDetails(subject, pub, priv);
    } else {
      this.logger.warn(
        'VAPID keys missing; web push disabled (email still works)',
      );
    }
  }

  async send(
    subscription: NotifyPushSubscription,
    payload: WebPushPayload,
  ): Promise<void> {
    if (!this.configured) {
      return;
    }
    // Suscripciones guardadas antes de la regla (o con un endpoint que los dos analizadores leen distinto): se borran sin
    // conectar. El registro lleva el host, o `unparseable`, nunca el endpoint completo, cuya ruta identifica la
    // suscripción.
    if (!this.endpointPolicy(subscription.endpoint)) {
      this.logger.warn({
        event: 'push_endpoint_rejected',
        host: whatwgHost(subscription.endpoint) ?? 'unparseable',
      });
      await this.subscriptions.deleteEndpoint(subscription.endpoint);
      return;
    }
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
      );
    } catch (error: unknown) {
      const status =
        typeof error === 'object' &&
        error !== null &&
        'statusCode' in error &&
        typeof (error as { statusCode: unknown }).statusCode === 'number'
          ? (error as { statusCode: number }).statusCode
          : undefined;
      if (status === 410 || status === 404) {
        await this.subscriptions.deleteEndpoint(subscription.endpoint);
        return;
      }
      throw error;
    }
  }
}

/** Doble de tests: registra envíos y puede simular 410. */
export class RecordingWebPushSender implements WebPushSender {
  readonly sent: { endpoint: string; payload: WebPushPayload }[] = [];
  goneEndpoints = new Set<string>();

  constructor(private readonly onGone?: (endpoint: string) => Promise<void>) {}

  async send(
    subscription: NotifyPushSubscription,
    payload: WebPushPayload,
  ): Promise<void> {
    if (this.goneEndpoints.has(subscription.endpoint)) {
      await this.onGone?.(subscription.endpoint);
      return;
    }
    this.sent.push({ endpoint: subscription.endpoint, payload });
  }
}
