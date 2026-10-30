import { rootCertificates } from 'node:tls';
import {
  classifyHost,
  hostRejectionCategory,
  type EgressPolicy,
} from '@linkvault/shared/net';
import {
  buildConnector as undiciBuildConnector,
  type buildConnector,
} from 'undici';
import { EgressBlockedError } from './egress-blocked-error';
import type { EgressLookup } from './egress-lookup';

export interface GuardedConnectorOptions {
  readonly policy: EgressPolicy;
  readonly lookup: EgressLookup;
  /** Autoridad extra de confianza (solo tests). Se suma a las raíces de Node, no las sustituye. */
  readonly ca?: string | Buffer;
  /** Inyectable para que un test capture las opciones con las que se construye el conector base. */
  readonly buildConnector?: typeof undiciBuildConnector;
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * Conector del `Agent` de `undici` (design D3): para cada conexión clasifica el host y el puerto **antes** de abrir
 * ningún socket y delega en un conector base cuyo `lookup` clasifica las direcciones resueltas.
 */
export function createGuardedConnector(
  options: GuardedConnectorOptions,
): buildConnector.connector {
  const build = options.buildConnector ?? undiciBuildConnector;
  const base = build({
    lookup: options.lookup,
    ...(options.ca === undefined
      ? {}
      : { ca: [...rootCertificates, options.ca] }),
  });
  return (target, callback) => {
    const hostClass = classifyHost(stripBrackets(target.hostname));
    if (!options.policy.allowsHost(hostClass)) {
      callback(new EgressBlockedError(hostRejectionCategory(hostClass)), null);
      return;
    }
    if (!options.policy.allowsPort(target.protocol, target.port, hostClass)) {
      callback(new EgressBlockedError('port'), null);
      return;
    }
    base(target, callback);
  };
}
