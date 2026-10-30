import { PUBLIC_EGRESS_POLICY, type EgressPolicy } from '@linkvault/shared/net';

// Políticas de test del filtro de salida (design D8). No hay variable de entorno que las active: cada test inyecta la
// suya por constructor y la nombra. Solo se importan desde ficheros `*.spec.ts`.

/** Admite hosts, direcciones y puertos de loopback: solo para los controles positivos. */
export const PERMISSIVE_TEST_POLICY: EgressPolicy = {
  allowsHost: (hostClass) =>
    hostClass.kind === 'name' ||
    (hostClass.kind === 'ip' &&
      (hostClass.addressClass === 'public' ||
        hostClass.addressClass === 'loopback')),
  allowsAddress: (addressClass) =>
    addressClass === 'public' || addressClass === 'loopback',
  allowsPort: () => true,
};

/** La pública salvo `allowsPort`, que admite el puerto efímero: para los negativos de host y de dirección. */
export const PUBLIC_WITH_ANY_PORT_TEST_POLICY: EgressPolicy = {
  ...PUBLIC_EGRESS_POLICY,
  allowsPort: () => true,
};

/**
 * Aprueba el `loopback` resuelto desde un nombre y rechaza el literal `loopback` (y toda otra clase no pública), con
 * cualquier puerto: para las redirecciones y el cambio de DNS.
 */
export const LOOPBACK_BY_NAME_TEST_POLICY: EgressPolicy = {
  allowsHost: (hostClass) => PUBLIC_EGRESS_POLICY.allowsHost(hostClass),
  allowsAddress: (addressClass) =>
    addressClass === 'public' || addressClass === 'loopback',
  allowsPort: () => true,
};
