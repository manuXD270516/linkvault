// Agrupación de la IP del cliente para los límites de intentos (spec auth/credentials, ADR-020 §5): una IPv4 cuenta por
// sí misma y una IPv6 por su prefijo /64, porque un cliente IPv6 suele disponer de todo un /64. Las IPv6 que representan
// una IPv4 (`::ffff:a.b.c.d`) cuentan como esa IPv4. Pura: sin `node:net`.
//
// Es plataforma, como el contador (ADR-025 §8): la usan `auth` (login y registro) y `groups` (unirse por código), y
// `groups` no puede importar `auth` (ADR-020 §6).

const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HEXTET = /^[0-9a-f]{1,4}$/;

/** Clave de agrupación de `ip`. Un valor que no es IPv4 ni IPv6 se devuelve tal cual (cuenta como grupo propio). */
export function ipLimitGroup(ip: string): string {
  if (IPV4.test(ip)) {
    return ip;
  }
  const groups = parseIpv6(ip);
  if (!groups) {
    return ip;
  }
  if (isIpv4Mapped(groups)) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`;
}

function isIpv4Mapped(groups: readonly number[]): boolean {
  return (
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff
  );
}

/** Los 8 grupos de 16 bits de una IPv6, o `null` si no lo es. Admite `::`, identificador de zona y cola IPv4. */
function parseIpv6(raw: string): number[] | null {
  let address = raw.toLowerCase();
  const zone = address.indexOf('%');
  if (zone !== -1) {
    address = address.slice(0, zone);
  }

  const lastColon = address.lastIndexOf(':');
  if (lastColon === -1) {
    return null;
  }
  const tail = address.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!IPV4.test(tail)) {
      return null;
    }
    const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map(Number);
    address = `${address.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = address.split('::');
  if (halves.length > 2) {
    return null;
  }
  const [head = '', rest] = halves;
  const headParts = head === '' ? [] : head.split(':');
  const restParts = rest === undefined || rest === '' ? [] : rest.split(':');
  // Con `::` debe quedar al menos un grupo comprimido: 8 o más grupos explícitos no son una IPv6 (y darían un tamaño
  // negativo al rellenar).
  if (rest !== undefined && headParts.length + restParts.length > 7) {
    return null;
  }
  const parts =
    rest === undefined
      ? headParts
      : [
          ...headParts,
          ...Array<string>(8 - headParts.length - restParts.length).fill('0'),
          ...restParts,
        ];
  if (parts.length !== 8 || !parts.every((part) => HEXTET.test(part))) {
    return null;
  }
  return parts.map((part) => Number.parseInt(part, 16));
}
