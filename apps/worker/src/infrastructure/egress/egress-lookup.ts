import {
  lookup as dnsLookup,
  type LookupAddress,
  type LookupOptions,
} from 'node:dns';
import { classifyAddress, type EgressPolicy } from '@linkvault/shared/net';
import { EgressBlockedError } from './egress-blocked-error';

/** Resolvedor inyectable: devuelve todas las direcciones del nombre o rechaza con el error de DNS (`ENOTFOUND`...). */
export type EgressResolver = (hostname: string) => Promise<LookupAddress[]>;

/** Firma de `lookup` de `net`/`tls` (la que usa `net.connect` con `autoSelectFamily`). */
export type EgressLookup = (
  hostname: string,
  options: LookupOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) => void;

/** Resolvedor por defecto: el del sistema, todas las direcciones y en el orden que dé. */
export const systemResolver: EgressResolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error !== null) reject(error);
      else resolve(addresses);
    });
  });

/**
 * `lookup` que resuelve **una vez**, clasifica **todas** las direcciones con `allowsAddress` y devuelve o todas las
 * aprobadas o `EgressBlockedError`; el socket se abre con lo que devuelve, así que no hay segunda resolución. Un fallo
 * del resolvedor se propaga tal cual.
 */
export function createEgressLookup(
  resolve: EgressResolver,
  policy: EgressPolicy,
): EgressLookup {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        for (const entry of addresses) {
          const addressClass = classifyAddress(entry.address);
          if (!policy.allowsAddress(addressClass)) {
            callback(new EgressBlockedError(addressClass), []);
            return;
          }
        }
        const wanted = options.family === 4 || options.family === 6;
        const approved = wanted
          ? addresses.filter((entry) => entry.family === options.family)
          : addresses;
        if (options.all === true) {
          callback(null, approved);
          return;
        }
        const first = approved[0];
        if (first === undefined) {
          const notFound: NodeJS.ErrnoException = new Error(
            'no address of the requested family',
          );
          notFound.code = 'ENOTFOUND';
          callback(notFound, '');
          return;
        }
        callback(null, first.address, first.family);
      },
      (error: unknown) => {
        callback(
          error instanceof Error ? error : new Error('resolution failed'),
          [],
        );
      },
    );
  };
}
