import type { EgressPolicy } from '@linkvault/shared/net';
import { Agent, fetch as undiciFetch } from 'undici';
import {
  createEgressLookup,
  systemResolver,
  type EgressResolver,
} from './egress-lookup';
import { createGuardedConnector } from './guarded-connector';

/** Lo que el guardia pide a quien llama; compatible con `HttpFetch` del módulo de enriquecimiento. */
export interface GuardedFetchInit {
  readonly method?: string;
  readonly redirect?: 'follow' | 'manual' | 'error';
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export type GuardedFetch = ((
  url: string,
  init: GuardedFetchInit,
) => Promise<Response>) & { close(): Promise<void> };

export interface GuardedFetchOptions {
  readonly policy: EgressPolicy;
  readonly resolve?: EgressResolver;
  /** Solo tests: autoridad que se suma a las raíces del sistema. Ninguna opción desactiva la verificación. */
  readonly tls?: { readonly ca: string | Buffer };
}

/**
 * `fetch` con el filtro de salida (design D3): `fetch` y `Agent` del paquete `undici`, conector propio, sin HTTP/2
 * compartido, `redirect: 'manual'` forzado y dispatcher explícito (nunca el proxy del entorno).
 */
export function createGuardedFetch(options: GuardedFetchOptions): GuardedFetch {
  const lookup = createEgressLookup(
    options.resolve ?? systemResolver,
    options.policy,
  );
  const agent = new Agent({
    allowH2: false,
    connect: createGuardedConnector({
      policy: options.policy,
      lookup,
      ca: options.tls?.ca,
    }),
  });
  const guarded = async (
    url: string,
    init: GuardedFetchInit,
  ): Promise<Response> => {
    const response = await undiciFetch(url, {
      method: init.method,
      headers: init.headers === undefined ? undefined : { ...init.headers },
      signal: init.signal,
      redirect: 'manual',
      dispatcher: agent,
    });
    return response as unknown as Response;
  };
  return Object.assign(guarded, { close: () => agent.close() });
}
