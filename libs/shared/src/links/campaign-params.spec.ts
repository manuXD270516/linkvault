import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_PARAM_PREFIX,
  CAMPAIGN_PARAMS,
  isCampaignParam,
} from './campaign-params';

describe('isCampaignParam', () => {
  it.each([
    ['utm_source', true],
    ['UTM_SOURCE', true],
    ['utm_medium', true],
    ['gclid', true],
    ['mc_eid', true],
    ['TRK', true],
    ['jk', false],
    ['currentJobId', false],
    ['id', false],
    ['utm', false],
  ])('juzga %s', (name, expected) => {
    expect(isCampaignParam(name)).toBe(expected);
  });

  it('mantiene la lista cerrada y en minúsculas', () => {
    expect(CAMPAIGN_PARAM_PREFIX).toBe('utm_');
    for (const name of CAMPAIGN_PARAMS) {
      expect(name).toBe(name.toLowerCase());
    }
  });
});
