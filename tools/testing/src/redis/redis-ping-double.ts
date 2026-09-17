import { createServer, type Server, type Socket } from 'node:net';

/**
 * Estados del doble de Redis (D7 de bootstrap-monorepo):
 * - `up`: acepta conexiones y responde a los comandos soportados.
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

/** Estado de transacción de una conexión: `queue` es null fuera de `MULTI`. */
interface ClientSession {
  queue: (readonly string[])[] | null;
  /** Un comando rechazado al encolar hace que `EXEC` responda `EXECABORT`. */
  aborted: boolean;
}

const CRLF = '\r\n';
const NIL = `$-1${CRLF}`;
const OK = `+OK${CRLF}`;
const QUEUED = `+QUEUED${CRLF}`;
const ASTERISK = 0x2a;
const DOLLAR = 0x24;
const INTEGER = /^-?\d+$/;
/** Enteros tal como los acepta Redis en INCR/DECR: sin signo `+`, sin ceros a la izquierda ni `-0`. */
const STRICT_INT64 = /^(0|-?[1-9]\d{0,18})$/;
const INT64_MAX = 9_223_372_036_854_775_807n;
const INT64_MIN = -9_223_372_036_854_775_808n;

/** Aridad al estilo de Redis (incluye el nombre): positiva exacta, negativa mínima. */
const ARITY: ReadonlyMap<string, number> = new Map([
  ['PING', -1],
  ['GET', 2],
  ['SET', -3],
  ['DEL', -2],
  ['INCR', 2],
  ['DECR', 2],
  ['PTTL', 2],
]);

/**
 * Servidor TCP mínimo que habla RESP2 para PING, GET, SET (`EX`/`PX`/`NX`) y DEL (D8 de ai-gateway-core), INCR, DECR,
 * PTTL y MULTI/EXEC/DISCARD (D7 de auth-users) sobre un mapa en memoria con expiración perezosa; el resto de comandos
 * responde `-ERR unknown command`. Escucha en 127.0.0.1 en un
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
    // Como Redis (`tcp-nodelay yes`): sin esto, Nagle retiene los envíos pequeños que siguen al primero hasta recibir el
    // ACK del cliente (hasta ~40 ms en Linux), y cada MULTI/EXEC del limitador de intentos costaría esa espera.
    socket.setNoDelay(true);
    socket.on('close', () => this.sockets.delete(socket));
    // Un cliente que corta la conexión no debe tumbar el proceso de test.
    socket.on('error', () => socket.destroy());

    const session: ClientSession = { queue: null, aborted: false };
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      if (this.currentMode !== 'up') {
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      // Las respuestas de los comandos que llegan juntos (un MULTI encolado, por ejemplo) se envían en un solo write,
      // igual que el búfer de salida de Redis: un paquete por tanda en lugar de uno por comando.
      const responses: string[] = [];
      let command = parseCommand(buffer);
      while (command !== null) {
        buffer = buffer.subarray(command.consumed);
        responses.push(this.reply(command.args, session));
        command = parseCommand(buffer);
      }
      const response = responses.join('');
      if (response.length > 0) {
        socket.write(response);
      }
    });
  }

  /**
   * Atiende un comando de una conexión. Como Redis, entre `MULTI` y `EXEC` los comandos válidos se encolan (`+QUEUED`);
   * un comando desconocido o con aridad incorrecta se rechaza al momento y hace que `EXEC` aborte la transacción.
   */
  private reply(args: readonly string[], session: ClientSession): string {
    const [rawName, ...rest] = args;
    if (rawName === undefined) {
      return '';
    }
    const name = rawName.toUpperCase();
    switch (name) {
      case 'MULTI':
        return this.multi(rest, session);
      case 'EXEC':
        return this.exec(rest, session);
      case 'DISCARD':
        return this.discard(rest, session);
    }
    const rejection = this.validate(rawName, rest.length);
    if (session.queue === null) {
      return rejection ?? this.execute(args);
    }
    if (rejection !== null) {
      session.aborted = true;
      return rejection;
    }
    session.queue.push(args);
    return QUEUED;
  }

  /** Comprueba existencia y aridad del comando, lo mismo que Redis valida antes de encolar en una transacción. */
  private validate(rawName: string, argumentCount: number): string | null {
    const arity = ARITY.get(rawName.toUpperCase());
    if (arity === undefined) {
      return error(`unknown command '${rawName.replace(/[\r\n]/g, ' ')}'`);
    }
    const total = argumentCount + 1;
    const valid = arity >= 0 ? total === arity : total >= -arity;
    return valid ? null : wrongArity(rawName.toLowerCase());
  }

  /** Ejecuta un comando ya validado. */
  private execute(args: readonly string[]): string {
    const [name = '', ...rest] = args;
    switch (name.toUpperCase()) {
      case 'PING':
        if (rest.length > 1) {
          return wrongArity('ping');
        }
        return rest[0] === undefined ? `+PONG${CRLF}` : bulk(rest[0]);
      case 'GET':
        return this.get(rest);
      case 'SET':
        return this.set(rest);
      case 'DEL':
        return this.del(rest);
      case 'INCR':
        return this.incrementBy(rest, 1n);
      case 'DECR':
        return this.incrementBy(rest, -1n);
      case 'PTTL':
        return this.pttl(rest);
      default:
        return error(`unknown command '${name.replace(/[\r\n]/g, ' ')}'`);
    }
  }

  private multi(args: readonly string[], session: ClientSession): string {
    if (args.length > 0) {
      return wrongArity('multi');
    }
    if (session.queue !== null) {
      return error('MULTI calls can not be nested');
    }
    session.queue = [];
    session.aborted = false;
    return OK;
  }

  /** Ejecuta la cola en orden y responde un array RESP con el resultado de cada comando (errores incluidos). */
  private exec(args: readonly string[], session: ClientSession): string {
    if (args.length > 0) {
      return wrongArity('exec');
    }
    const queue = session.queue;
    if (queue === null) {
      return error('EXEC without MULTI');
    }
    const aborted = session.aborted;
    session.queue = null;
    session.aborted = false;
    if (aborted) {
      return `-EXECABORT Transaction discarded because of previous errors.${CRLF}`;
    }
    const replies = queue.map((queued) => this.execute(queued));
    return `*${replies.length}${CRLF}${replies.join('')}`;
  }

  private discard(args: readonly string[], session: ClientSession): string {
    if (args.length > 0) {
      return wrongArity('discard');
    }
    if (session.queue === null) {
      return error('DISCARD without MULTI');
    }
    session.queue = null;
    session.aborted = false;
    return OK;
  }

  private get(args: readonly string[]): string {
    const [key = ''] = args;
    const stored = this.read(key);
    return stored === undefined ? NIL : bulk(stored.value);
  }

  /**
   * `SET key value [NX] [EX seconds | PX milliseconds]`, con los mismos errores que Redis ante opciones inválidas. Con
   * `NX` no escribe si la clave vigente ya existe y responde nil (D7 de auth-users).
   */
  private set(args: readonly string[]): string {
    const [key = '', value = '', ...options] = args;
    let ttlMs: number | null = null;
    let onlyIfAbsent = false;
    for (let index = 0; index < options.length; index += 1) {
      const option = options[index]?.toUpperCase();
      if (option === 'NX') {
        onlyIfAbsent = true;
        continue;
      }
      const amount = options[index + 1];
      if (
        (option !== 'EX' && option !== 'PX') ||
        amount === undefined ||
        ttlMs !== null
      ) {
        return error('syntax error');
      }
      index += 1;
      const parsed = INTEGER.test(amount) ? Number(amount) : Number.NaN;
      if (!Number.isSafeInteger(parsed)) {
        return error('value is not an integer or out of range');
      }
      if (parsed <= 0) {
        return error("invalid expire time in 'set' command");
      }
      ttlMs = option === 'EX' ? parsed * 1_000 : parsed;
    }
    if (onlyIfAbsent && this.read(key) !== undefined) {
      return NIL;
    }
    this.store.set(key, {
      value,
      expiresAt: ttlMs === null ? null : Date.now() + ttlMs,
    });
    return OK;
  }

  /** `INCR`/`DECR`: como en Redis, una clave ausente cuenta como 0 y la expiración existente se conserva. */
  private incrementBy(args: readonly string[], delta: bigint): string {
    const [key = ''] = args;
    const stored = this.read(key);
    const current = stored === undefined ? 0n : parseInt64(stored.value);
    if (current === null) {
      return error('value is not an integer or out of range');
    }
    const next = current + delta;
    if (next > INT64_MAX || next < INT64_MIN) {
      return error('increment or decrement would overflow');
    }
    this.store.set(key, {
      value: next.toString(),
      expiresAt: stored?.expiresAt ?? null,
    });
    return `:${next}${CRLF}`;
  }

  /** `PTTL`: milisegundos restantes, -1 si la clave no expira y -2 si no existe. */
  private pttl(args: readonly string[]): string {
    const [key = ''] = args;
    const stored = this.read(key);
    if (stored === undefined) {
      return `:-2${CRLF}`;
    }
    if (stored.expiresAt === null) {
      return `:-1${CRLF}`;
    }
    return `:${Math.max(0, stored.expiresAt - Date.now())}${CRLF}`;
  }

  private del(keys: readonly string[]): string {
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

/** Interpreta un valor guardado como entero de 64 bits con signo; null si Redis no lo aceptaría. */
function parseInt64(value: string): bigint | null {
  if (!STRICT_INT64.test(value)) {
    return null;
  }
  const parsed = BigInt(value);
  return parsed > INT64_MAX || parsed < INT64_MIN ? null : parsed;
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
