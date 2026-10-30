import ipaddr from 'ipaddr.js';

/**
 * Clasificador puro de direcciones y hosts para el filtro de salida (change `enrichment-egress-guard`, design D1/D2).
 * Sin dependencias de Node: solo `ipaddr.js` para analizar el texto. Lo usan la API (rechazo temprano) y el worker.
 */

/** Clase de una dirección IP. Solo `public` es un destino de Internet pública. */
export type AddressClass =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link_local'
  | 'shared_cgnat'
  | 'unspecified'
  | 'multicast'
  | 'broadcast'
  | 'reserved'
  | 'documentation'
  | 'ipv4_mapped'
  | 'ula';

/** Clase de un host: literal IP con la clase de su dirección, nombre sin punto, `localhost` o nombre normal. */
export type HostClass =
  | { readonly kind: 'ip'; readonly addressClass: AddressClass }
  | { readonly kind: 'dotless' }
  | { readonly kind: 'localhost' }
  | { readonly kind: 'name' };

/** Categoría de un rechazo: una clase de dirección o una de las tres que no lo son (design D1). */
export type EgressCategory = AddressClass | 'port' | 'dotless' | 'localhost';

interface Ipv4Range {
  readonly base: readonly number[];
  readonly prefix: number;
  readonly addressClass: AddressClass;
}

const IPV4_RANGES: readonly Ipv4Range[] = [
  { base: [0, 0, 0, 0], prefix: 8, addressClass: 'unspecified' },
  { base: [10, 0, 0, 0], prefix: 8, addressClass: 'private' },
  { base: [100, 64, 0, 0], prefix: 10, addressClass: 'shared_cgnat' },
  { base: [127, 0, 0, 0], prefix: 8, addressClass: 'loopback' },
  { base: [169, 254, 0, 0], prefix: 16, addressClass: 'link_local' },
  { base: [172, 16, 0, 0], prefix: 12, addressClass: 'private' },
  { base: [192, 0, 0, 0], prefix: 24, addressClass: 'reserved' },
  { base: [192, 0, 2, 0], prefix: 24, addressClass: 'documentation' },
  { base: [192, 168, 0, 0], prefix: 16, addressClass: 'private' },
  { base: [198, 18, 0, 0], prefix: 15, addressClass: 'reserved' },
  { base: [198, 51, 100, 0], prefix: 24, addressClass: 'documentation' },
  { base: [203, 0, 113, 0], prefix: 24, addressClass: 'documentation' },
  { base: [224, 0, 0, 0], prefix: 4, addressClass: 'multicast' },
  { base: [240, 0, 0, 0], prefix: 4, addressClass: 'reserved' },
];

function bytesInPrefix(
  bytes: readonly number[],
  base: readonly number[],
  prefix: number,
): boolean {
  let remaining = prefix;
  for (let i = 0; i < base.length && remaining > 0; i += 1) {
    const bits = Math.min(8, remaining);
    const mask = (0xff << (8 - bits)) & 0xff;
    if (((bytes[i] ?? 0) & mask) !== ((base[i] ?? 0) & mask)) return false;
    remaining -= bits;
  }
  return true;
}

function classifyIpv4Bytes(bytes: readonly number[]): AddressClass {
  if (bytes.every((byte) => byte === 255)) return 'broadcast';
  for (const range of IPV4_RANGES) {
    if (bytesInPrefix(bytes, range.base, range.prefix)) {
      return range.addressClass;
    }
  }
  return 'public';
}

interface Ipv6Range {
  readonly base: readonly number[];
  readonly prefix: number;
  readonly addressClass: AddressClass;
}

/** Los 16 bytes de una dirección IPv6 a partir de sus primeros grupos de 16 bits (el resto, cero). */
function v6(...groups: number[]): readonly number[] {
  const bytes: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    const group = groups[i] ?? 0;
    bytes.push((group >> 8) & 0xff, group & 0xff);
  }
  return bytes;
}

/** Rangos enumerados, dentro o fuera de `2000::/3`; el primero que coincide gana. */
const IPV6_RANGES: readonly Ipv6Range[] = [
  { base: v6(0, 0, 0, 0, 0, 0xffff), prefix: 96, addressClass: 'ipv4_mapped' },
  { base: v6(0), prefix: 96, addressClass: 'ipv4_mapped' },
  { base: v6(0x100), prefix: 64, addressClass: 'reserved' },
  { base: v6(0x2001, 0xdb8), prefix: 32, addressClass: 'documentation' },
  { base: v6(0x2001), prefix: 23, addressClass: 'reserved' },
  { base: v6(0x3fff), prefix: 20, addressClass: 'documentation' },
  { base: v6(0xfc00), prefix: 7, addressClass: 'ula' },
  { base: v6(0xfe80), prefix: 10, addressClass: 'link_local' },
  { base: v6(0xfec0), prefix: 10, addressClass: 'reserved' },
  { base: v6(0xff00), prefix: 8, addressClass: 'multicast' },
];

const NAT64_PREFIX = v6(0x64, 0xff9b);
const SIX_TO_FOUR_PREFIX = v6(0x2002);
const GLOBAL_UNICAST = v6(0x2000);

function classifyIpv6Bytes(bytes: readonly number[]): AddressClass {
  if (bytes.every((byte) => byte === 0)) return 'unspecified';
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) {
    return 'loopback';
  }
  // Traducción: se juzga la IPv4 de dentro (NAT64 en los 32 bits finales, 6to4 en los bytes 2 a 5).
  if (bytesInPrefix(bytes, NAT64_PREFIX, 96)) {
    return classifyIpv4Bytes(bytes.slice(12, 16));
  }
  if (bytesInPrefix(bytes, SIX_TO_FOUR_PREFIX, 16)) {
    return classifyIpv4Bytes(bytes.slice(2, 6));
  }
  for (const range of IPV6_RANGES) {
    if (bytesInPrefix(bytes, range.base, range.prefix)) {
      return range.addressClass;
    }
  }
  // Lista de permitidos: solo el unicast global (`2000::/3`) es público; el resto es reservado.
  return bytesInPrefix(bytes, GLOBAL_UNICAST, 3) ? 'public' : 'reserved';
}

/** Analiza una IP en cualquier notación que `ipaddr.js` entienda; `null` si no es una dirección. */
function parseAddress(text: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  if (!ipaddr.isValid(text)) return null;
  return ipaddr.parse(text);
}

/**
 * Clase de una dirección IP (texto sin corchetes). Lo que no se puede analizar se trata como `reserved`: ante la duda,
 * no se conecta.
 */
export function classifyAddress(ip: string): AddressClass {
  const parsed = parseAddress(ip);
  if (parsed === null) return 'reserved';
  const bytes = parsed.toByteArray();
  return bytes.length === 4
    ? classifyIpv4Bytes(bytes)
    : classifyIpv6Bytes(bytes);
}

/**
 * Clase de un `hostname` **sin corchetes** (el de `new URL(...).hostname` o el que recibe el conector, con los
 * corchetes de un literal IPv6 ya quitados por quien llama).
 */
export function classifyHost(hostname: string): HostClass {
  const host = (
    hostname.endsWith('.') ? hostname.slice(0, -1) : hostname
  ).toLowerCase();
  if (parseAddress(host) !== null) {
    return { kind: 'ip', addressClass: classifyAddress(host) };
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return { kind: 'localhost' };
  }
  if (!host.includes('.')) return { kind: 'dotless' };
  return { kind: 'name' };
}

/** Categoría de rechazo de un host que `allowsHost` no admitió (design D1). */
export function hostRejectionCategory(hostClass: HostClass): EgressCategory {
  switch (hostClass.kind) {
    case 'ip':
      return hostClass.addressClass;
    case 'dotless':
      return 'dotless';
    case 'localhost':
      return 'localhost';
    case 'name':
      return 'reserved';
  }
}
