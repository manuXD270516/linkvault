import { describe, expect, it } from 'vitest';
import { type SeedFetch, type SeedRequest, seedRehearsalAccount } from './seed';

const ACCOUNT = { email: 'rehearsal+e2e@example.com', password: 'not-a-secret-1234', displayName: 'Ensayo e2e' };
const API = 'http://localhost:4300/api';

/** `fetch` falso: responde por ruta y apunta las llamadas. */
function fakeFetch(statusByPath: Readonly<Record<string, number>>): {
  fetchFn: SeedFetch;
  calls: { url: string; init: SeedRequest }[];
} {
  const calls: { url: string; init: SeedRequest }[] = [];
  const fetchFn: SeedFetch = (url, init) => {
    calls.push({ url, init });
    const status = statusByPath[new URL(url).pathname];
    return Promise.resolve({ status: status ?? 599 });
  };
  return { fetchFn, calls };
}

describe('seedRehearsalAccount', () => {
  it('registers the account (201) with one registration call and the CSRF header', async () => {
    const { fetchFn, calls } = fakeFetch({ '/api/auth/register': 201 });
    await expect(seedRehearsalAccount(fetchFn, API, ACCOUNT)).resolves.toBe('registered');
    expect(calls.map((call) => call.url)).toEqual(['http://localhost:4300/api/auth/register']);
    expect(calls[0]?.init.headers['x-requested-with']).toBe('linkvault');
    expect(JSON.parse(calls[0]?.init.body ?? '{}')).toEqual(ACCOUNT);
  });

  it('logs in when the account exists (409 then 200)', async () => {
    const { fetchFn, calls } = fakeFetch({ '/api/auth/register': 409, '/api/auth/login': 200 });
    await expect(seedRehearsalAccount(fetchFn, `${API}/`, ACCOUNT)).resolves.toBe('existing');
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(['/api/auth/register', '/api/auth/login']);
    expect(JSON.parse(calls[1]?.init.body ?? '{}')).toEqual({ email: ACCOUNT.email, password: ACCOUNT.password });
  });

  it('fails naming the login status when the account exists and the password does not log in', async () => {
    const { fetchFn } = fakeFetch({ '/api/auth/register': 409, '/api/auth/login': 401 });
    const failure = seedRehearsalAccount(fetchFn, API, ACCOUNT);
    await expect(failure).rejects.toThrow(/already exists \(register 409\) and POST \/api\/auth\/login answered 401/);
    await expect(failure).rejects.not.toThrow(ACCOUNT.password);
  });

  it('fails naming the registration limit on 429', async () => {
    const { fetchFn, calls } = fakeFetch({ '/api/auth/register': 429 });
    await expect(seedRehearsalAccount(fetchFn, API, ACCOUNT)).rejects.toThrow(/429 \(too_many_attempts\).*design D5/);
    expect(calls).toHaveLength(1);
  });

  it('fails naming any other registration status', async () => {
    const { fetchFn } = fakeFetch({ '/api/auth/register': 400 });
    await expect(seedRehearsalAccount(fetchFn, API, ACCOUNT)).rejects.toThrow(/answered 400 for the rehearsal account/);
  });
});
