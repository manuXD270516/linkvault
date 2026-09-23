import type { FixedWindowCounter } from '../../../infrastructure/limits/fixed-window-counter';
import {
  REMOTEOK_EGRESS_KEY,
  REMOTEOK_EGRESS_LIMIT,
  REMOTEOK_EGRESS_WINDOW_MS,
  type RemoteokEgressLimiter,
} from './adapters/remoteok-discovery.adapter';

/**
 * Egress global Remote OK: 1 fetch dump / 60s. Fail-closed (proteger tercero).
 */
export class CounterRemoteokEgressLimiter implements RemoteokEgressLimiter {
  constructor(private readonly counter: FixedWindowCounter) {}

  async tryAcquire(): Promise<boolean> {
    const outcome = await this.counter.consume(REMOTEOK_EGRESS_KEY, {
      limit: REMOTEOK_EGRESS_LIMIT,
      windowMs: REMOTEOK_EGRESS_WINDOW_MS,
    });
    if (outcome === null) {
      return false;
    }
    return outcome.allowed;
  }
}
