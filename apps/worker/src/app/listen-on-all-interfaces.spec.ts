import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  workerTestAiConfig,
  workerTestConfig,
} from '../test-support/test-config';
import {
  createWorkerApp,
  LISTEN_HOST,
  listenOnAllInterfaces,
} from './create-worker-app';

/**
 * Una IPv4 de esta máquina que no es loopback ni de enlace local: lo más parecido, sin Docker, a «otro contenedor de la
 * misma red». Sin host, Fastify escucha en `localhost` y esta dirección da `ECONNREFUSED`.
 */
function nonLoopbackIpv4(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const info of addresses ?? []) {
      if (
        info.family === 'IPv4' &&
        !info.internal &&
        !info.address.startsWith('169.254.')
      ) {
        return info.address;
      }
    }
  }
  return undefined;
}

const externalIpv4 = nonLoopbackIpv4();

// Tarea 7.9 de `object-store`: dentro de un contenedor, escuchar solo en loopback deja la salud del worker inalcanzable desde otro contenedor.
describe('worker health listens on every interface', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function listening(): Promise<{
    app: NestFastifyApplication;
    port: number;
  }> {
    const started = await createWorkerApp(
      await workerTestConfig(),
      workerTestAiConfig(),
    );
    app = started;
    await listenOnAllInterfaces(started, 0);
    const address = started.getHttpServer().address() as AddressInfo;
    return { app: started, port: address.port };
  }

  it('binds the wildcard IPv4 address, not loopback', async () => {
    const { app: started } = await listening();

    expect(LISTEN_HOST).toBe('0.0.0.0');
    expect(started.getHttpServer().address()).toMatchObject({
      address: '0.0.0.0',
      family: 'IPv4',
    });
  });

  it.skipIf(externalIpv4 === undefined)(
    'answers GET /health/live through a non-loopback IPv4 of the machine',
    async () => {
      const { port } = await listening();

      const response = await fetch(
        `http://${externalIpv4 ?? ''}:${port}/health/live`,
      );

      expect(response.status).toBe(200);
    },
  );
});
