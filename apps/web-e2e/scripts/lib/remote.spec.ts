import { describe, expect, it } from 'vitest';
import { dotEnvKeys, isLoadedDotEnvName, resolveRemoteOrigins } from './remote';

describe('resolveRemoteOrigins (design D9: el origen de la API se deriva del de la aplicación)', () => {
  it('deriva la API como new URL("/api", origen)', () => {
    expect(resolveRemoteOrigins('https://1-2-3-4.sslip.io', undefined).apiOrigin).toBe('https://1-2-3-4.sslip.io/api');
  });

  it('acepta un --api-origin igual al derivado, con o sin barra final', () => {
    expect(resolveRemoteOrigins('https://a.example', 'https://a.example/api/').apiOrigin).toBe('https://a.example/api');
  });

  it('rechaza un --api-origin distinto nombrando los dos orígenes', () => {
    expect(() => resolveRemoteOrigins('https://a.example', 'https://b.example/api')).toThrow(
      /https:\/\/b\.example\/api.*https:\/\/a\.example/,
    );
  });

  it('rechaza un origen que no es una URL http(s)', () => {
    expect(() => resolveRemoteOrigins('a.example', undefined)).toThrow(/not an absolute URL/);
    expect(() => resolveRemoteOrigins('ftp://a.example', undefined)).toThrow(/http\(s\)/);
  });
});

describe('isLoadedDotEnvName (design D3: los .env* que Nx cargaría, salvo .env.example)', () => {
  it.each(['.env', '.env.local', '.local.env', '.env.e2e-remote', '.env.e2e-remote.local', '.e2e-remote.env'])(
    'cuenta %s',
    (name) => {
      expect(isLoadedDotEnvName(name)).toBe(true);
    },
  );

  it.each(['.env.example', 'e2e.env', 'env', 'README.md'])('no cuenta %s', (name) => {
    expect(isLoadedDotEnvName(name)).toBe(false);
  });
});

describe('dotEnvKeys', () => {
  it('lee claves con y sin export, e ignora comentarios', () => {
    expect([...dotEnvKeys('# E2E_REMOTE_PASSWORD=x\nexport E2E_REMOTE_EMAIL=a+e2e@example.com\r\nOTHER = 1\n')]).toEqual([
      'E2E_REMOTE_EMAIL',
      'OTHER',
    ]);
  });
});
