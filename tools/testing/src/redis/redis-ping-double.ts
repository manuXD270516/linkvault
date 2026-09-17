import { createServer, type Server, type Socket } from 'node:net';

/**
 * Estados del doble de Redis (D7 de bootstrap-monorepo):
 * - `up`: acepta conexiones y responde a PING.
 * - `stop`: no escucha; las conexiones se rechazan y las abiertas se destruyen.
 * - `hang`: acepta conexiones y nunca responde.
 */
export type RedisDoubleMode = 'up' | 'stop' | 'hang';

interface ParsedCommand {
  readonly args: readonly string[];
  readonly consumed: number;
}

const CRLF = '\r\n';
const ASTERISK = 0x2a;
const DOLLAR = 0x24;

/**
 * Servidor TCP mínimo que habla RESP solo para PING. Escucha en 127.0.0.1 en un puerto efímero que conserva
 * al pasar de `stop` a `up` o `hang`, para que un cliente ya configurado pueda reconectar sin reiniciar.
 */
export class RedisPingDouble {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private currentMode: RedisDoubleMode = 'stop';
  private assignedPort = 0;

  private constructor() {
    // Solo se crea con RedisPingDouble.start(), que deja el servidor escuchando.
  }

  static async start(
    mode: Exclude<RedisDoubleMode, 'stop'> = 'up',
  ): Promise<RedisPingDouble> {
    const double = new RedisPingDouble();
    await double.listen();
    double.currentMode = mode;
    return double;
  }

  get host(): string {
    return '127.0.0.1';
  }

  get port(): number {
    return this.assignedPort;
  }

  get url(): string {
    return `redis://${this.host}:${this.assignedPort}`;
  }

  get mode(): RedisDoubleMode {
    return this.currentMode;
  }

  async setMode(mode: RedisDoubleMode): Promise<void> {
    if (mode === 'stop') {
      await this.shutdown();
    } else if (this.server === null) {
      await this.listen();
    }
    this.currentMode = mode;
  }

  async close(): Promise<void> {
    await this.shutdown();
    this.currentMode = 'stop';
  }

  private listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => this.accept(socket));
      server.once('error', reject);
      server.listen(this.assignedPort, this.host, () => {
        server.off('error', reject);
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('RedisPingDouble: unexpected server address'));
          return;
        }
        this.assignedPort = address.port;
        this.server = server;
        resolve();
      });
    });
  }

  private shutdown(): Promise<void> {
    const server = this.server;
    if (server === null) {
      return Promise.resolve();
    }
    this.server = null;
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    // Un cliente que corta la conexión no debe tumbar el proceso de test.
    socket.on('error', () => socket.destroy());

    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      if (this.currentMode !== 'up') {
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      let command = parseCommand(buffer);
      while (command !== null) {
        buffer = buffer.subarray(command.consumed);
        const response = reply(command.args);
        if (response.length > 0) {
          socket.write(response);
        }
        command = parseCommand(buffer);
      }
    });
  }
}

/** Parsea un comando RESP (array de bulk strings) o inline. Devuelve null si el buffer está incompleto. */
function parseCommand(buffer: Buffer): ParsedCommand | null {
  if (buffer.length === 0) {
    return null;
  }
  return buffer[0] === ASTERISK ? parseArray(buffer) : parseInline(buffer);
}

function parseArray(buffer: Buffer): ParsedCommand | null {
  const headerEnd = buffer.indexOf(CRLF);
  if (headerEnd === -1) {
    return null;
  }
  const count = Number.parseInt(buffer.toString('latin1', 1, headerEnd), 10);
  if (Number.isNaN(count) || count < 0) {
    return { args: ['<invalid>'], consumed: buffer.length };
  }

  const args: string[] = [];
  let offset = headerEnd + CRLF.length;
  for (let index = 0; index < count; index += 1) {
    if (offset >= buffer.length) {
      return null;
    }
    if (buffer[offset] !== DOLLAR) {
      return { args: ['<invalid>'], consumed: buffer.length };
    }
    const lengthEnd = buffer.indexOf(CRLF, offset);
    if (lengthEnd === -1) {
      return null;
    }
    const length = Number.parseInt(
      buffer.toString('latin1', offset + 1, lengthEnd),
      10,
    );
    if (Number.isNaN(length) || length < 0) {
      return { args: ['<invalid>'], consumed: buffer.length };
    }
    const start = lengthEnd + CRLF.length;
    const end = start + length;
    if (buffer.length < end + CRLF.length) {
      return null;
    }
    args.push(buffer.toString('utf8', start, end));
    offset = end + CRLF.length;
  }
  return { args, consumed: offset };
}

function parseInline(buffer: Buffer): ParsedCommand | null {
  const lineEnd = buffer.indexOf('\n');
  if (lineEnd === -1) {
    return null;
  }
  const line = buffer.toString('utf8', 0, lineEnd).replace(/\r$/, '');
  const args = line.split(/\s+/).filter((part) => part.length > 0);
  return { args, consumed: lineEnd + 1 };
}

function reply(args: readonly string[]): string {
  const [name, ...rest] = args;
  if (name === undefined) {
    return '';
  }
  if (name.toUpperCase() === 'PING') {
    const [message] = rest;
    return message === undefined
      ? `+PONG${CRLF}`
      : `$${Buffer.byteLength(message)}${CRLF}${message}${CRLF}`;
  }
  const safeName = name.replace(/[\r\n]/g, ' ');
  return `-ERR unknown command '${safeName}'${CRLF}`;
}
