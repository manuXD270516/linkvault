import { describe, expect, it } from 'vitest';
import { NestAuthSecurityLog } from './nest-auth-security-log';

describe('NestAuthSecurityLog', () => {
  it('warns about a reused refresh token with userId and sessionId only', () => {
    const warnings: string[] = [];
    const log = new NestAuthSecurityLog({
      warn: (message) => warnings.push(message),
    });

    log.refreshTokenReused({ userId: 'user-1', sessionId: 'session-1' });

    expect(warnings).toEqual([
      'Refresh token reuse detected, session revoked (userId=user-1, sessionId=session-1)',
    ]);
  });
});
