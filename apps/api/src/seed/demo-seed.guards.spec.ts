import { describe, expect, it } from 'vitest';
import {
  assertDemoSeedAllowed,
  DemoSeedGuardError,
  DEMO_SEED_MONGO_HOST_ALLOWLIST,
  mongoHostsFromUri,
  resolveDemoSeedMongoUri,
} from './demo-seed.guards';

const LOCAL_URI = 'mongodb://localhost:27017/linkvault?directConnection=true';

function env(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    NODE_ENV: 'development',
    ALLOW_DEMO_SEED: 'true',
    MONGO_URI: LOCAL_URI,
    ...overrides,
  };
}

describe('resolveDemoSeedMongoUri', () => {
  it('prefers MONGO_URI over MONGODB_URI', () => {
    expect(
      resolveDemoSeedMongoUri({
        MONGO_URI: 'mongodb://localhost/a',
        MONGODB_URI: 'mongodb://mongo/b',
      }),
    ).toBe('mongodb://localhost/a');
  });

  it('falls back to MONGODB_URI', () => {
    expect(
      resolveDemoSeedMongoUri({ MONGODB_URI: 'mongodb://127.0.0.1/lv' }),
    ).toBe('mongodb://127.0.0.1/lv');
  });
});

describe('mongoHostsFromUri', () => {
  it('reads a single host with port', () => {
    expect(mongoHostsFromUri(LOCAL_URI)).toEqual(['localhost']);
  });

  it('reads replica set hosts and strips credentials', () => {
    expect(
      mongoHostsFromUri(
        'mongodb://user:p%40ss@mongo:27017,127.0.0.1:27017/linkvault?replicaSet=rs0',
      ),
    ).toEqual(['mongo', '127.0.0.1']);
  });

  it('reads IPv6 and host.docker.internal', () => {
    expect(mongoHostsFromUri('mongodb://[::1]:27017/db')).toEqual(['::1']);
    expect(
      mongoHostsFromUri('mongodb://host.docker.internal:27017/db'),
    ).toEqual(['host.docker.internal']);
  });

  it('rejects a non-mongodb URI', () => {
    expect(() => mongoHostsFromUri('postgres://localhost/db')).toThrow(
      DemoSeedGuardError,
    );
  });
});

describe('assertDemoSeedAllowed', () => {
  it('allows a local development env', () => {
    expect(() => assertDemoSeedAllowed(env())).not.toThrow();
    for (const host of DEMO_SEED_MONGO_HOST_ALLOWLIST) {
      const uri =
        host === '::1'
          ? 'mongodb://[::1]:27017/linkvault'
          : `mongodb://${host}:27017/linkvault`;
      expect(() =>
        assertDemoSeedAllowed(env({ MONGO_URI: uri })),
      ).not.toThrow();
    }
  });

  it('refuses production', () => {
    expect(() =>
      assertDemoSeedAllowed(env({ NODE_ENV: 'production' })),
    ).toThrow(/NODE_ENV=production/);
  });

  it('refuses when ALLOW_DEMO_SEED is not true', () => {
    expect(() =>
      assertDemoSeedAllowed(env({ ALLOW_DEMO_SEED: 'false' })),
    ).toThrow(/ALLOW_DEMO_SEED/);
    expect(() =>
      assertDemoSeedAllowed(env({ ALLOW_DEMO_SEED: undefined })),
    ).toThrow(/ALLOW_DEMO_SEED/);
  });

  it('refuses a remote Mongo host without mutating intent', () => {
    expect(() =>
      assertDemoSeedAllowed(
        env({
          MONGO_URI: 'mongodb://cluster0.example.com:27017/linkvault',
        }),
      ),
    ).toThrow(/not in allowlist/);
  });

  it('refuses if any replica host is outside the allowlist', () => {
    expect(() =>
      assertDemoSeedAllowed(
        env({
          MONGO_URI:
            'mongodb://localhost:27017,db.prod.example:27017/linkvault?replicaSet=rs0',
        }),
      ),
    ).toThrow(/db\.prod\.example/);
  });
});
