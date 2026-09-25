import {
  BYOK_VENDOR_AVAILABILITY,
  InMemoryUserAiKeysRepository,
  LibsodiumSecretVault,
  SECRET_VAULT,
  USER_AI_KEYS_REPOSITORY,
  type ByokVendorAvailability,
} from '@linkvault/ai';
import { AI_VENDORS } from '@linkvault/shared';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { DeleteAllMyAiKeys } from '../application/delete-all-my-ai-keys.usecase';
import { DeleteMyAiKey } from '../application/delete-my-ai-key.usecase';
import { ListMyAiKeys } from '../application/list-my-ai-keys.usecase';
import { USERS_CLOCK, type Clock } from '../application/ports/clock.port';
import { UpsertMyAiKey } from '../application/upsert-my-ai-key.usecase';
import { AiKeysController } from './ai-keys.controller';

// AMPLIACIÓN CONSCIENTE DE 10-bis.4. El enunciado pide unitarios de casos de uso; con solo eso el agujero seguiría
// abierto. Hasta este fichero **ningún** test de `apps/api` pasaba por `AiKeysController` ni por
// `listAiKeysResponseSchema.parse`, así que la validación de respuesta del controlador —lo único que en ejecución
// impide devolver un cuerpo fuera de contrato— no la ejercitaba nadie: lo único que detectó la rotura del contrato
// fue `tsc`. Un contrato que solo comprueba el compilador no cubre al productor que arma el cuerpo por un camino
// que el tipo no ve.
//
// El cableado va por Nest a propósito, no construyendo las clases a mano: así se comprueba de paso que los casos de
// uso siguen siendo construibles por DI con el token `BYOK_VENDOR_AVAILABILITY` que `AiModule` exporta y
// `AiKeysModule` hereda. Sin Mongo y sin HTTP.

const ANA = { userId: '66e9a0000000000000000a01', sessionId: 'sess-1' };
const VAULT_KEY = new Uint8Array(32).fill(9);
const API_KEY = 'sk-test-openai-key-16+';
const OPENROUTER_KEY = 'or-secret-key-xxxxxx';
const NOW = new Date('2026-09-22T12:00:00.000Z');

/** OpenRouter sin modelo utilizable: el único vendor que hoy puede salir indisponible (ADR-048 §6). */
const OPENROUTER_UNAVAILABLE: ByokVendorAvailability = (vendor) =>
  vendor !== 'openrouter';

class FixedClock implements Clock {
  now(): Date {
    return NOW;
  }
}

const open: TestingModule[] = [];

/**
 * Controlador cableado por Nest. `staleListing` sustituye el caso de uso por uno que devuelve un cuerpo fuera de
 * contrato, que es lo que el controlador tiene que rechazar.
 */
async function controllerWith(
  availability: ByokVendorAvailability,
  staleListing?: { execute: () => Promise<unknown> },
): Promise<AiKeysController> {
  const builder = Test.createTestingModule({
    controllers: [AiKeysController],
    providers: [
      {
        provide: SECRET_VAULT,
        useValue: new LibsodiumSecretVault({ vaultKey: VAULT_KEY }),
      },
      {
        provide: USER_AI_KEYS_REPOSITORY,
        useValue: new InMemoryUserAiKeysRepository(),
      },
      { provide: BYOK_VENDOR_AVAILABILITY, useValue: availability },
      { provide: USERS_CLOCK, useClass: FixedClock },
      ListMyAiKeys,
      UpsertMyAiKey,
      DeleteMyAiKey,
      DeleteAllMyAiKeys,
    ],
  });
  if (staleListing !== undefined) {
    builder.overrideProvider(ListMyAiKeys).useValue(staleListing);
  }
  const moduleRef = await builder.compile();
  open.push(moduleRef);
  return moduleRef.get(AiKeysController);
}

describe('AiKeysController', () => {
  afterEach(async () => {
    await Promise.all(open.splice(0).map((moduleRef) => moduleRef.close()));
  });

  it('GET devuelve el cuerpo del contrato: conjunto exacto de claves y los tres vendors', async () => {
    const controller = await controllerWith(OPENROUTER_UNAVAILABLE);
    await controller.upsert(ANA, 'openrouter', { apiKey: OPENROUTER_KEY });

    const body = await controller.list(ANA);

    // Conjunto EXACTO, no `toMatchObject`: un campo de más pasaría inadvertido, y el de las respuestas de gestión
    // de claves es cerrado (`ai/data-protection`, «Secretos BYOK fuera de logs y respuestas»).
    expect(Object.keys(body).sort()).toEqual(['keys', 'vendors']);
    expect(body.vendors).toEqual([
      { vendor: 'anthropic', available: true },
      { vendor: 'openai', available: true },
      { vendor: 'openrouter', available: false },
    ]);
    expect(body.keys).toHaveLength(1);
    expect(Object.keys(body.keys[0]).sort()).toEqual([
      'available',
      'keyHint',
      'updatedAt',
      'vendor',
    ]);
    expect(body.keys[0].available).toBe(false);
    // Un vendor indisponible no dice por qué: ni el modelo, ni la variable que falta (10-bis.2bis).
    expect(JSON.stringify(body)).not.toContain(OPENROUTER_KEY);
    expect(JSON.stringify(body)).not.toContain('model');
  });

  it('PUT devuelve la vista suelta con el estado del vendor y nada más', async () => {
    const controller = await controllerWith(OPENROUTER_UNAVAILABLE);

    const view = await controller.upsert(ANA, 'openai', { apiKey: API_KEY });

    expect(view).toEqual({
      vendor: 'openai',
      keyHint: API_KEY.slice(-4),
      updatedAt: NOW.toISOString(),
      available: true,
    });
    expect(JSON.stringify(view)).not.toContain(API_KEY);
  });

  // LA PRUEBA QUE CAE SI EL CUERPO SE SALE DEL CONTRATO. El caso de uso devuelve aquí lo que devolvía hace un
  // commit —sin `vendors`—: el controlador tiene que rechazar en vez de responder algo que el SPA tendría que
  // interpretar. Con el contrato a medias y sin este test, `api:test` pasaba en verde.
  it('GET rechaza un cuerpo sin vendors en vez de devolverlo', async () => {
    const controller = await controllerWith(OPENROUTER_UNAVAILABLE, {
      execute: () => Promise.resolve({ keys: [] }),
    });

    await expect(controller.list(ANA)).rejects.toBeInstanceOf(ZodError);
  });

  it('GET rechaza una cobertura de vendors a medias', async () => {
    const controller = await controllerWith(OPENROUTER_UNAVAILABLE, {
      execute: () =>
        Promise.resolve({
          keys: [],
          vendors: AI_VENDORS.slice(0, 2).map((vendor) => ({
            vendor,
            available: true,
          })),
        }),
    });

    await expect(controller.list(ANA)).rejects.toBeInstanceOf(ZodError);
  });
});
