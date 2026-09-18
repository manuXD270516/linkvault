import { createServer, type Server, type Socket } from 'node:net';
import { ENRICH_LINK_QUEUE } from '@linkvault/shared';
import { getQueueToken } from '@nestjs/bullmq';
import { UnknownElementException } from '@nestjs/core/errors/exceptions/unknown-element.exception';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../app/app.module';
import { createApp } from '../../app/create-app';
import { apiTestAiConfig, apiTestConfig } from '../../test-support/test-config';
import { AppConfigModule } from '../config/app-config.module';
import { MongoPersistenceModule } from '../persistence/mongo-persistence.module';
import {
  ENRICH_LINK_JOB_OPTIONS,
  EnrichLinkQueueErrorLog,
} from './enrich-link-queue';
import { OutboxRelay } from './outbox-relay';
import { OutboxRelayModule } from './outbox-relay.module';

// Relay del outbox como módulo apagable (tarea 1.4, D6 de job-links). Se comprueba que con `OUTBOX_RELAY_ENABLED=false`
// la cola no existe y nadie habla Redis por la vía de BullMQ, y que encendido la cola lleva su listener de `error`: sin
// él, un Redis inalcanzable haría que BullMQ emitiera `error` sin oyentes y Node tumbaría el proceso.

let app: NestFastifyApplication | undefined;
let moduleRef: TestingModule | undefined;
let server: RedisPortSpy | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  await moduleRef?.close();
  moduleRef = undefined;
  await server?.close();
  server = undefined;
});

/**
 * Servidor TCP en el puerto que la configuración anuncia como Redis: acepta conexiones, no responde nada y apunta lo
 * que le escriben. Un cliente ioredis en reposo no manda nada; BullMQ, en cambio, saluda con `info` nada más crearse
 * la `Queue`, así que el tráfico delata si se registró la cola.
 */
class RedisPortSpy {
  private readonly sockets = new Set<Socket>();
  readonly received: string[] = [];
  connections = 0;

  private constructor(
    private readonly server: Server,
    readonly port: number,
  ) {}

  static start(): Promise<RedisPortSpy> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('RedisPortSpy: unexpected server address'));
          return;
        }
        const spy = new RedisPortSpy(server, address.port);
        server.on('connection', (socket) => spy.accept(socket));
        resolve(spy);
      });
    });
  }

  get url(): string {
    return `redis://127.0.0.1:${this.port}`;
  }

  close(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private accept(socket: Socket): void {
    this.connections += 1;
    this.sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('data', (chunk: Buffer) => {
      this.received.push(chunk.toString('utf8'));
    });
  }
}

/** Cola falsa: lo único que este módulo hace con ella es escuchar sus errores. */
class FakeQueue {
  readonly errorListeners: ((error: Error) => void)[] = [];

  on(event: 'error', listener: (error: Error) => void): this {
    if (event === 'error') {
      this.errorListeners.push(listener);
    }
    return this;
  }
}

/**
 * `moduleRef.get` de Nest 11 no admite `{ optional: true }`: un token que no está registrado lanza
 * `UnknownElementException`. Este envoltorio le da la forma que pide la verificación de la tarea.
 */
function optionalGet(reference: TestingModule, token: unknown): unknown {
  try {
    return reference.get(token as never, { strict: false });
  } catch (error) {
    if (error instanceof UnknownElementException) {
      return undefined;
    }
    throw error;
  }
}

describe('outbox relay module', () => {
  it('creates no queue when the relay is disabled', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(await apiTestConfig(), apiTestAiConfig())],
    }).compile();

    expect(optionalGet(moduleRef, Queue)).toBeUndefined();
    expect(
      optionalGet(moduleRef, getQueueToken(ENRICH_LINK_QUEUE)),
    ).toBeUndefined();
    expect(optionalGet(moduleRef, EnrichLinkQueueErrorLog)).toBeUndefined();
    expect(optionalGet(moduleRef, SchedulerRegistry)).toBeUndefined();
    expect(optionalGet(moduleRef, OutboxRelay)).toBeUndefined();
  });

  it('opens no BullMQ connection to Redis when the relay is disabled', async () => {
    server = await RedisPortSpy.start();

    app = await createApp(
      await apiTestConfig({ REDIS_URL: server.url }),
      apiTestAiConfig(),
    );
    await app.init();
    await new Promise((resolve) => setTimeout(resolve, 250));

    // El cliente de aplicación de `auth` sí conecta al arrancar (D7 de auth-users) y saluda con `HELLO`: eso demuestra
    // que el espía ve el tráfico. BullMQ, en cambio, comprueba la versión del servidor con `INFO` nada más crear la
    // cola, y ese comando no aparece porque sin relay no hay cola que crear.
    const traffic = server.received.join('').toLowerCase();
    expect(traffic).toContain('hello');
    expect(traffic).not.toMatch(/\$4\r\ninfo\r\n/);
  });

  it('attaches an error listener to the queue and brings its own scheduler', async () => {
    const queue = new FakeQueue();
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule.forRoot(
          await apiTestConfig({ OUTBOX_RELAY_ENABLED: true }),
        ),
        // La conexión de Mongoose es perezosa: el módulo del outbox la necesita para su modelo, no para conectar.
        MongoPersistenceModule,
        OutboxRelayModule,
      ],
    })
      .overrideProvider(getQueueToken(ENRICH_LINK_QUEUE))
      .useValue(queue)
      .compile();

    expect(moduleRef.get(EnrichLinkQueueErrorLog)).toBeDefined();
    expect(queue.errorListeners).toHaveLength(1);
    expect(moduleRef.get(SchedulerRegistry, { strict: false })).toBeDefined();
    expect(moduleRef.get(OutboxRelay)).toBeInstanceOf(OutboxRelay);
  });

  it('keeps the queue retention of D6 and retries what throws', () => {
    // Los reintentos solo cubren lo que revienta: una bolsa que bloquea o una página que no es oferta son resultados
    // que el consumidor guarda con su motivo y no gastan intentos. Sin `attempts`, BullMQ haría uno solo y un corte de
    // Mongo de un segundo dejaría el link en `failed` con "reintentos agotados" sin haber reintentado nada.
    expect(ENRICH_LINK_JOB_OPTIONS).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 604_800 },
    });
  });

  it('logs queue errors instead of letting them reach the process', () => {
    const queue = new FakeQueue();
    const messages: string[] = [];

    new EnrichLinkQueueErrorLog(queue, {
      debug: (message) => messages.push(message),
    });
    for (const listener of queue.errorListeners) {
      listener(new Error('connect ECONNREFUSED'));
    }

    expect(messages).toEqual(['enrich-link queue error: connect ECONNREFUSED']);
  });
});
