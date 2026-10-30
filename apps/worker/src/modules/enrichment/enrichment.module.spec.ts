import type { DynamicModule, FactoryProvider, Provider } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { findEgressBlocked } from '../../infrastructure/egress/egress-blocked-error';
import { workerTestConfig } from '../../test-support/test-config';
import { PAGE_FETCHER } from './application/ports/page-fetcher.port';
import { ROBOTS } from './application/ports/robots.port';
import { ENRICHMENT_FETCH, EnrichmentModule } from './enrichment.module';
import type { HttpFetch } from './infrastructure/http/http-page-fetcher';

function factoryOf(dynamic: DynamicModule, token: unknown): FactoryProvider {
  const found = (dynamic.providers ?? []).find(
    (provider: Provider): provider is FactoryProvider =>
      typeof provider === 'object' &&
      'provide' in provider &&
      provider.provide === token &&
      'useFactory' in provider,
  );
  if (found === undefined) throw new Error('provider not found');
  return found;
}

describe('Transporte del enriquecimiento', () => {
  it('page and robots fetchers share the guarded transport', async () => {
    const dynamic = EnrichmentModule.register(await workerTestConfig(), {
      module: class NoAiModule {},
    });
    const transport = factoryOf(dynamic, ENRICHMENT_FETCH);
    expect(factoryOf(dynamic, PAGE_FETCHER).inject).toContain(ENRICHMENT_FETCH);
    expect(factoryOf(dynamic, ROBOTS).inject).toContain(ENRICHMENT_FETCH);

    // El transporte compartido es el guardia con la política pública: una dirección de loopback no abre conexión.
    const httpFetch = (transport.useFactory as () => HttpFetch)();
    const error = await httpFetch('http://127.0.0.1/', {
      method: 'GET',
      redirect: 'manual',
      headers: {},
      signal: AbortSignal.timeout(2_000),
    }).then(
      () => null,
      (rejection: unknown) => rejection,
    );
    expect(findEgressBlocked(error)?.category).toBe('loopback');
  });
});
