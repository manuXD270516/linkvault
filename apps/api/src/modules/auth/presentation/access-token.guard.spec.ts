import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTHENTICATED_USER_PROPERTY,
  type AuthenticatableRequest,
} from '../../../presentation/http/auth-context/authenticated-user';
import { Public } from '../../../presentation/http/auth-context/public.decorator';
import type {
  AccountAuthState,
  UserAccounts,
} from '../application/ports/user-accounts.port';
import type { Clock } from '../domain/clock';
import { InvalidAccessToken } from '../domain/errors';
import { JoseAccessTokenSigner } from '../infrastructure/jose-access-token-signer';
import { AccessTokenGuard, bearerToken } from './access-token.guard';

// Guard global de access token (tarea 6.3 de auth-users, D3) con el firmador jose real, reloj movible y cuentas en memoria.

const SECRET = 'test-only-jwt-secret-at-least-32-chars';
const TTL = 900;
const REGISTERED_AT = new Date('2026-09-17T10:00:00.000Z');
const USER_ID = '66e9a0000000000000000001';

class MovableClock implements Clock {
  constructor(public current: Date) {}

  now(): Date {
    return new Date(this.current);
  }
}

/** Solo `getAuthState`: es lo único que usa el guard. */
class AuthStates implements Pick<UserAccounts, 'getAuthState'> {
  readonly states = new Map<string, AccountAuthState>();

  getAuthState(userId: string): Promise<AccountAuthState | null> {
    return Promise.resolve(this.states.get(userId) ?? null);
  }
}

@Controller()
class ProtectedController {
  @Get()
  handle(): void {
    return undefined;
  }

  @Public()
  @Get()
  publicHandle(): void {
    return undefined;
  }
}

@Public()
@Controller()
class PublicController {
  @Get()
  handle(): void {
    return undefined;
  }
}

describe('AccessTokenGuard', () => {
  let clock: MovableClock;
  let signer: JoseAccessTokenSigner;
  let accounts: AuthStates;
  let guard: AccessTokenGuard;

  beforeEach(() => {
    clock = new MovableClock(REGISTERED_AT);
    signer = new JoseAccessTokenSigner({ secret: SECRET, ttlSeconds: TTL }, clock);
    accounts = new AuthStates();
    accounts.states.set(USER_ID, {
      userId: USER_ID,
      passwordChangedAt: REGISTERED_AT,
    });
    guard = new AccessTokenGuard(
      new Reflector(),
      signer,
      accounts as unknown as UserAccounts,
    );
  });

  function contextFor(
    request: AuthenticatableRequest,
    target: {
      controller: new () => object;
      handler: (...args: never[]) => unknown;
    } = {
      controller: ProtectedController,
      handler: ProtectedController.prototype.handle,
    },
  ): ExecutionContextHost {
    const context = new ExecutionContextHost(
      [request, {}],
      target.controller,
      target.handler,
    );
    context.setType('http');
    return context;
  }

  function requestWith(authorization?: string): AuthenticatableRequest {
    return {
      headers: authorization === undefined ? {} : { authorization },
    };
  }

  async function tokenAt(at: Date, sessionId = 'session-a'): Promise<string> {
    const previous = clock.current;
    clock.current = at;
    const { accessToken } = await signer.sign({ userId: USER_ID, sessionId });
    clock.current = previous;
    return accessToken;
  }

  it('accepts a valid token and exposes userId and sessionId to the request', async () => {
    const token = await tokenAt(REGISTERED_AT);
    const request = requestWith(`Bearer ${token}`);

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request[AUTHENTICATED_USER_PROPERTY]).toEqual({
      userId: USER_ID,
      sessionId: 'session-a',
    });
  });

  it('rejects a request without Authorization', async () => {
    await expect(
      guard.canActivate(contextFor(requestWith())),
    ).rejects.toBeInstanceOf(InvalidAccessToken);
  });

  it('rejects a token signed with another secret', async () => {
    const other = new JoseAccessTokenSigner(
      { secret: 'another-test-jwt-secret-of-32-chars!!', ttlSeconds: TTL },
      clock,
    );
    const { accessToken } = await other.sign({
      userId: USER_ID,
      sessionId: 'session-a',
    });

    await expect(
      guard.canActivate(contextFor(requestWith(`Bearer ${accessToken}`))),
    ).rejects.toBeInstanceOf(InvalidAccessToken);
  });

  it('rejects an expired token', async () => {
    const token = await tokenAt(REGISTERED_AT);
    clock.current = new Date(REGISTERED_AT.getTime() + (TTL + 6) * 1000);

    await expect(
      guard.canActivate(contextFor(requestWith(`Bearer ${token}`))),
    ).rejects.toBeInstanceOf(InvalidAccessToken);
  });

  it('rejects a token of a user that does not exist', async () => {
    const token = await tokenAt(REGISTERED_AT);
    accounts.states.clear();

    await expect(
      guard.canActivate(contextFor(requestWith(`Bearer ${token}`))),
    ).rejects.toBeInstanceOf(InvalidAccessToken);
  });

  it('rejects a token issued in a second before the last password change', async () => {
    const issuedAt = new Date('2026-09-17T11:00:00.900Z');
    const token = await tokenAt(issuedAt, 'session-b');
    accounts.states.set(USER_ID, {
      userId: USER_ID,
      passwordChangedAt: new Date('2026-09-17T11:00:01.100Z'),
    });
    clock.current = new Date('2026-09-17T11:00:02.000Z');

    await expect(
      guard.canActivate(contextFor(requestWith(`Bearer ${token}`))),
    ).rejects.toBeInstanceOf(InvalidAccessToken);
  });

  it('accepts a token issued in the same second as the password change (iat has second precision)', async () => {
    const token = await tokenAt(new Date('2026-09-17T11:00:01.500Z'));
    accounts.states.set(USER_ID, {
      userId: USER_ID,
      passwordChangedAt: new Date('2026-09-17T11:00:01.100Z'),
    });

    await expect(
      guard.canActivate(contextFor(requestWith(`Bearer ${token}`))),
    ).resolves.toBe(true);
  });

  it.each([
    ['a public handler', ProtectedController, ProtectedController.prototype.publicHandle],
    ['a public controller', PublicController, PublicController.prototype.handle],
  ])('lets %s through without a token', async (_label, controller, handler) => {
    const request = requestWith();

    await expect(
      guard.canActivate(contextFor(request, { controller, handler })),
    ).resolves.toBe(true);
    expect(request[AUTHENTICATED_USER_PROPERTY]).toBeUndefined();
  });
});

describe('bearerToken', () => {
  it.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer abc', 'abc'],
    ['Bearer  abc ', 'abc'],
  ])('reads %j', (header, token) => {
    expect(bearerToken(header)).toBe(token);
  });

  it.each([
    [undefined],
    [''],
    ['Bearer'],
    ['Bearer '],
    ['Basic abc'],
    ['Bearer abc def'],
    ['abc'],
    [['Bearer a', 'Bearer b']],
  ])('rejects %j', (header) => {
    expect(bearerToken(header)).toBeUndefined();
  });
});
