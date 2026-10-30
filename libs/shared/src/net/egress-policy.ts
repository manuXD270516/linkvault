import type { AddressClass, HostClass } from './egress-address';

/**
 * Política del filtro de salida (design D1): tres decisiones. El puerto se decide solo con la clase del host,
 * antes de resolver. La única implementación de producción es `PUBLIC_EGRESS_POLICY`; las de tests viven en el
 * código de tests del worker (D8).
 */
export interface EgressPolicy {
  allowsHost(hostClass: HostClass): boolean;
  allowsAddress(addressClass: AddressClass): boolean;
  /** `port` llega como cadena (`URL.port`, vacía si es el de por defecto), como número o ausente. */
  allowsPort(
    protocol: string,
    port: string | number | undefined,
    hostClass: HostClass,
  ): boolean;
}

function isWebPort(port: string | number | undefined): boolean {
  if (port === undefined || port === '') return true;
  return port === 80 || port === 443 || port === '80' || port === '443';
}

/** Solo nombres y literales públicos, direcciones públicas y el puerto por defecto u `80`/`443`. */
export const PUBLIC_EGRESS_POLICY: EgressPolicy = {
  allowsHost: (hostClass) =>
    hostClass.kind === 'name' ||
    (hostClass.kind === 'ip' && hostClass.addressClass === 'public'),
  allowsAddress: (addressClass) => addressClass === 'public',
  allowsPort: (_protocol, port, _hostClass) => isWebPort(port),
};
