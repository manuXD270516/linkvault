import { describe, expect, it, vi } from 'vitest';
import type { LinksFacade } from '../../links/application/links.facade';
import type { LinkPlanSignals } from '../application/ports/application-links.port';
import { LinksFacadeApplicationLinks } from './links-facade-application-links';

// Adaptador APPLICATION_LINKS sobre la fachada de `links` (tarea 4.2 de weekly-plan).

function adapterOver(planSignalsOf: LinksFacade['planSignalsOf']) {
  const facade = { planSignalsOf } as unknown as LinksFacade;
  return new LinksFacadeApplicationLinks(facade);
}

describe('LinksFacadeApplicationLinks.planSignalsOf', () => {
  const signals = new Map<string, LinkPlanSignals>([
    [
      'l1',
      {
        id: 'l1',
        displayUrl: 'https://example.com/1',
        closed: false,
        knowSomeoneCount: 2,
        knowSomeoneGroupId: 'g2',
      },
    ],
  ]);

  it('delegates planSignalsOf to the facade with the same arguments', async () => {
    const planSignalsOf = vi.fn().mockResolvedValue(signals);

    await adapterOver(planSignalsOf).planSignalsOf('u1', ['l1', 'l2']);

    expect(planSignalsOf).toHaveBeenCalledTimes(1);
    expect(planSignalsOf).toHaveBeenCalledWith('u1', ['l1', 'l2']);
  });

  it('returns the facade map untouched', async () => {
    const planSignalsOf = vi.fn().mockResolvedValue(signals);

    const result = await adapterOver(planSignalsOf).planSignalsOf('u1', ['l1']);

    expect(result).toBe(signals);
  });
});
