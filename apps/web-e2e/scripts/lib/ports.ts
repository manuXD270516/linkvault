import { createConnection, createServer } from 'node:net';

/** Resultado de probar un puerto del bloque: libre o, si no, por qué vía se vio ocupado (design D3, fase 1). */
export interface PortProbe {
  readonly port: number;
  readonly busy: boolean;
  readonly reasons: readonly string[];
}

const CONNECT_TIMEOUT_MS = 1_000;

/** `true` si alguien acepta una conexión en `host:port`. */
function acceptsConnection(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (accepted: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(accepted);
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Error de `bind` en todas las interfaces, o `null` si el runner puede ocupar el puerto. */
function bindError(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
    server.listen({ port, exclusive: true }, () => {
      server.close(() => resolve(null));
    });
  });
}

/**
 * Un puerto está libre si nadie acepta conexiones en `127.0.0.1` ni en `::1` **y** el runner puede hacer `bind`: en
 * Windows un `bind` a todas las interfaces puede prosperar con otro proceso escuchando solo en `127.0.0.1`, y las
 * conexiones a `localhost` irían a ese otro.
 */
export async function probePort(port: number): Promise<PortProbe> {
  const reasons: string[] = [];
  if (await acceptsConnection('127.0.0.1', port)) {
    reasons.push('accepts connections on 127.0.0.1');
  }
  if (await acceptsConnection('::1', port)) {
    reasons.push('accepts connections on ::1');
  }
  const error = await bindError(port);
  if (error !== null) {
    reasons.push(`bind fails with ${error}`);
  }
  return { port, busy: reasons.length > 0, reasons };
}

export async function probePorts(ports: readonly number[]): Promise<PortProbe[]> {
  const result: PortProbe[] = [];
  for (const port of ports) {
    result.push(await probePort(port));
  }
  return result;
}

export function describeBusy(probes: readonly PortProbe[]): string {
  return probes
    .filter((probe) => probe.busy)
    .map((probe) => `port ${probe.port} is in use (${probe.reasons.join('; ')})`)
    .join('\n  ');
}
