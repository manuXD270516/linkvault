import * as argon2 from '@node-rs/argon2';
import { describe, expect, it, vi } from 'vitest';
import {
  ARGON2_OPTIONS,
  Argon2PasswordHasher,
  type Argon2Functions,
} from './argon2-password-hasher';

// Adaptador PASSWORD_HASHER (tarea 4.4 de auth-users, D6) con el binario real de @node-rs/argon2.

const PASSWORD = 'correct-horse-battery';

/** Envuelve las funciones reales para contar llamadas sin cambiar su comportamiento. */
function spiedArgon2() {
  const functions = {
    hash: vi.fn<Argon2Functions['hash']>((password, options) =>
      argon2.hash(password, options),
    ),
    verify: vi.fn<Argon2Functions['verify']>((hashed, password) =>
      argon2.verify(hashed, password),
    ),
  };
  return functions;
}

describe('Argon2PasswordHasher', () => {
  it('produces an Argon2id PHC hash with the OWASP minimum parameters of D6', async () => {
    const hash = await new Argon2PasswordHasher().hash(PASSWORD);

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain(PASSWORD);
    expect(argon2.parseOptions(hash)).toMatchObject({
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    expect(ARGON2_OPTIONS).toMatchObject({
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  });

  it('uses a different salt on every hash', async () => {
    const hasher = new Argon2PasswordHasher();

    expect(await hasher.hash(PASSWORD)).not.toBe(await hasher.hash(PASSWORD));
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hasher = new Argon2PasswordHasher();
    const hash = await hasher.hash(PASSWORD);

    expect(await hasher.verify(hash, PASSWORD)).toBe(true);
    expect(await hasher.verify(hash, 'wrong-horse-battery')).toBe(false);
  });

  it('precomputes the dummy hash once, at construction', async () => {
    const functions = spiedArgon2();
    const hasher = new Argon2PasswordHasher(functions);

    expect(functions.hash).toHaveBeenCalledTimes(1);
    await hasher.verifyDummy(PASSWORD);
    await hasher.verifyDummy('another-password');

    expect(functions.hash).toHaveBeenCalledTimes(1);
  });

  it('verifyDummy runs a real Argon2id verification that never matches', async () => {
    const functions = spiedArgon2();
    const hasher = new Argon2PasswordHasher(functions);

    await hasher.verifyDummy(PASSWORD);

    expect(functions.verify).toHaveBeenCalledTimes(1);
    const [dummyHash, password] = functions.verify.mock.calls[0] ?? [];
    expect(password).toBe(PASSWORD);
    expect(String(dummyHash).startsWith('$argon2id$')).toBe(true);
    expect(argon2.parseOptions(String(dummyHash))).toMatchObject({
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    expect(await functions.verify.mock.results[0]?.value).toBe(false);
  });
});
