import { describe, expect, it } from 'vitest';
import { apiTestConfig } from '../../test-support/test-config';
import { deriveCapabilities } from './capabilities';

describe('deriveCapabilities', () => {
  it('all off with the default test config', async () => {
    expect(deriveCapabilities(await apiTestConfig())).toEqual({
      search: false,
      discovery: false,
    });
  });

  it('search needs both the flag and a Meili host', async () => {
    const config = await apiTestConfig({
      FEATURE_SEARCH: true,
      MEILI_HOST: 'http://meili:7700',
    });
    expect(deriveCapabilities(config).search).toBe(true);
    const hostOnly = await apiTestConfig({ MEILI_HOST: 'http://meili:7700' });
    expect(deriveCapabilities(hostOnly).search).toBe(false);
  });

  it('search is off with the flag and an empty host', async () => {
    const config = await apiTestConfig({
      FEATURE_SEARCH: true,
      MEILI_HOST: '',
    });
    expect(deriveCapabilities(config).search).toBe(false);
  });

  it('discovery follows its flag', async () => {
    expect(
      deriveCapabilities(await apiTestConfig({ FEATURE_DISCOVERY: true }))
        .discovery,
    ).toBe(true);
    expect(
      deriveCapabilities(await apiTestConfig({ FEATURE_DISCOVERY: false }))
        .discovery,
    ).toBe(false);
  });
});
