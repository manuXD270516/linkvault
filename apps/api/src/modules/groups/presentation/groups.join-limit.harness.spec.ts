import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createGroupsJoinTestApp,
  type GroupsJoinTestApp,
} from '../../../test-support/groups-join-test-app';

// Arnés de las pruebas HTTP del límite del join (tarea 4.5a de groups-ownership-join-limit): cada test tiene su IP por
// defecto, y una petición puede indicar otra. El controlador cuenta por `request.ip`, que sin `trustProxy` es la
// `remoteAddress` de la petición.

const WRONG_CODE = 'A2B3C4D5';

describe('groups join test harness', () => {
  let harness: GroupsJoinTestApp;
  let firstTestAddress = '';

  beforeAll(async () => {
    harness = await createGroupsJoinTestApp(getMongoTestUri());
  });

  beforeEach(() => {
    harness.nextTest();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('counts a wrong code on the IP of the test', async () => {
    const ana = await harness.authenticated('Ana');
    firstTestAddress = harness.defaultAddress;

    const response = await harness.join(ana, WRONG_CODE);

    expect(response.statusCode).toBe(404);
    expect(harness.counter.countOf(`groups:join:ip:${firstTestAddress}`)).toBe(
      1,
    );
    expect(harness.counter.countOf(`groups:join:user:${ana.userId}`)).toBe(1);
  });

  it('gives the next test another IP, so the IP counters are not shared', async () => {
    const beto = await harness.authenticated('Beto');

    expect(harness.defaultAddress).not.toBe(firstTestAddress);
    expect(
      harness.counter.countOf(`groups:join:ip:${harness.defaultAddress}`),
    ).toBe(0);

    await harness.join(beto, WRONG_CODE);

    expect(
      harness.counter.countOf(`groups:join:ip:${harness.defaultAddress}`),
    ).toBe(1);
    // El del test anterior sigue donde estaba: no se sumó nada ahí.
    expect(harness.counter.countOf(`groups:join:ip:${firstTestAddress}`)).toBe(
      1,
    );
  });

  it('counts two requests with a different remoteAddress on different IPs', async () => {
    const carla = await harness.authenticated('Carla');

    await harness.join(carla, WRONG_CODE, { remoteAddress: '192.0.2.10' });
    await harness.join(carla, WRONG_CODE, { remoteAddress: '192.0.2.20' });

    expect(harness.counter.countOf('groups:join:ip:192.0.2.10')).toBe(1);
    expect(harness.counter.countOf('groups:join:ip:192.0.2.20')).toBe(1);
    expect(harness.counter.countOf(`groups:join:user:${carla.userId}`)).toBe(2);
  });
});
