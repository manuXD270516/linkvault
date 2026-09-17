import { createServer, type Server, type Socket } from 'node:net';

/**
 * Estados del doble de Redis (D7 de bootstrap-monorepo):
 * - `up`: acepta conexiones y responde a PING, GET, SET y DEL.
 * - `stop`: no escucha; las conexiones se rechazan y las abiertas se destruyen.
 * - `hang`: acepta conexiones y nunca responde.
 */
export type RedisDoubleMode = 'up' | 'stop' | 'hang';

interface ParsedCommand {
  readonly args: readonly string[];
  readonly consumed: number;
}

interface StoredValue {
  readonly value: string;
  /** Instante (ms desde epoch) a partir del cual la clave deja de existir; null si no expira. */
  readonly expiresAt: number | null;
}

const CRLF = '\r\n';
const NIL = `$-1${CRLF}`;
const OK = `+OK${CRLF}`;
const ASTERISK = 0x2a;
const DOLLAR = 0x24;
const INTEGER = /^-?\d+$/;

/**
 * Servidor TCP mínimo que habla RESP2 para PING, GET, SET (`EX`/`PX`) y DEL (D8 de ai-gateway-core) sobre un mapa en
 * memoria con expiración perezosa; el resto de comandos responde `-ERR unknown command`. Escucha en 127.0.0.1 en un
 * puerto efímero que conserva al pasar de `stop` a `up` o `hang`, para que un cliente ya configurado pueda reconectar
 * sin reiniciar.
 */
export class RedisPingDouble {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private readonly store = new Map<string, StoredValue>();
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

  /** Pasar a `stop` equivale a reiniciar un Redis sin persistencia: los datos guardados se pierden. */
  async setMode(mode: RedisDoubleMode): Promise<void> {
    if (mode === 'stop') {
      await this.shutdown();
      this.store.clear();
    } else if (this.server === null) {
      await this.listen();
    }
    this.currentMode = mode;
  }

  async close(): Promise<void> {
    await this.shutdown();
    this.store.clear();
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
        const response = this.reply(command.args);
        if (response.length > 0) {
          socket.write(response);
        }
        command = parseCommand(buffer);
      }
    });
  }

  private reply(args: readonly string[]): string {
    const [name, ...rest] = args;
    if (name === undefined) {
      return '';
    }
    switch (name.toUpperCase()) {
      case 'PING':
        return rest[0] === undefined ? `+PONG${CRLF}` : bulk(rest[0]);
      case 'GET':
        return this.get(rest);
      case 'SET':
        return this.set(rest);
      case 'DEL':
        return this.del(rest);
      default:
        return error(`unknown command '${name.replace(/[\r\n]/g, ' ')}'`);
    }
  }

  private get(args: readonly string[]): string {
    const [key] = args;
    if (key === undefined || args.length !== 1) {
      return wrongArity('get');
    }
    const stored = this.read(key);
    return stored === undefined ? NIL : bulk(stored.value);
  }

  /** `SET key value [EX seconds | PX milliseconds]`, con los mismos errores que Redis ante opciones inválidas. */
  private set(args: readonly string[]): string {
    const [key, value, ...options] = args;
    if (key === undefined || value === undefined) {
      return wrongArity('set');
    }
    let ttlMs: number | null = null;
    for (let index = 0; index < options.length; index += 2) {
      const option = options[index]?.toUpperCase();
      const amount = options[index + 1];
      if (
        (option !== 'EX' && option !== 'PX') ||
        amount === undefined ||
        ttlMs !== null
      ) {
        return error('syntax error');
      }
      const parsed = INTEGER.test(amount) ? Number(amount) : Number.NaN;
      if (!Number.isSafeInteger(parsed)) {
        return error('value is not an integer or out of range');
      }
      if (parsed <= 0) {
        return error("invalid expire time in 'set' command");
      }
      ttlMs = option === 'EX' ? parsed * 1_000 : parsed;
    }
    this.store.set(key, {
      value,
      expiresAt: ttlMs === null ? null : Date.now() + ttlMs,
    });
    return OK;
  }

  private del(keys: readonly string[]): string {
    if (keys.length === 0) {
      return wrongArity('del');
    }
    let removed = 0;
    for (const key of new Set(keys)) {
      if (this.read(key) !== undefined) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return `:${removed}${CRLF}`;
  }

  /** Devuelve el valor vigente; si la clave ya expiró la elimina (expiración perezosa). */
  private read(key: string): StoredValue | undefined {
    const stored = this.store.get(key);
    if (
      stored !== undefined &&
      stored.expiresAt !== null &&
      stored.expiresAt <= Date.now()
    ) {
      this.store.delete(key);
      return undefined;
    }
    return stored;
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

function bulk(value: string): string {
  return `$${Buffer.byteLength(value)}${CRLF}${value}${CRLF}`;
}

function error(message: string): string {
  return `-ERR ${message}${CRLF}`;
}

function wrongArity(command: string): string {
  return error(`wrong number of arguments for '${command}' command`);
}
