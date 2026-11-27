import { beforeEach, describe, expect, it } from 'vitest';
import { InvalidRefresh, RefreshConflict } from '../domain/errors';
import type { IssuedSession } from './issued-session';
import { Login } from './login.usecase';
import { Logout } from './logout.usecase';
import { hashRefreshToken } from './refresh-token';
import { RefreshSession } from './refresh-session.usecase';
import {
  createAuthTestHarness,
  type AuthTestHarness,
} from './testing/auth-test-harness';

const SECOND = 1_000;
const DAY = 86_400_000;
const PASSWORD = 'correct-horse-battery';

describe('RefreshSession and Logout', () => {
  let harness: AuthTestHarness;
  let refresh: RefreshSession;
  let logout: Logout;
  let session: IssuedSession;

  beforeEach(async () => {
    harness = createAuthTestHarness();
    refresh = new RefreshSession(
      harness.sessions,
      harness.signer,
      harness.accounts,
      harness.securityLog,
    );
    logout = new Logout(harness.sessions);
    await harness.accounts.createWithPassword({
      email: 'ana@example.com',
      passwordHash: await harness.hasher.hash(PASSWORD),
      displayName: 'Ana',
    });
    session = await new Login(
      harness.accounts,
      harness.hasher,
      harness.limiter,
      harness.sessionOpener,
    ).execute({
      email: 'ana@example.com',
      password: PASSWORD,
      ip: '203.0.113.7',
    });
  });

  async function sessionIdOf(refreshToken: string): Promise<string> {
    const stored = await harness.sessions.findRefreshToken(
      hashRefreshToken(refreshToken),
    );
    return stored?.sessionId ?? '';
  }

  describe('RefreshSession', () => {
    it('Rotación correcta', async () => {
      harness.clock.advance(60 * SECOND);

      const renewed = await refresh.execute({
        refreshToken: session.refreshToken,
      });

      expect(renewed.refreshToken).not.toBe(session.refreshToken);
      expect(renewed.user).toEqual(session.user);
      expect(renewed.expiresIn).toBe(900);
      expect(renewed.refreshExpiresAt).toEqual(
        new Date(harness.clock.now().getTime() + 30 * DAY),
      );
      const verified = await harness.signer.verify(renewed.accessToken);
      expect(verified).toMatchObject({
        userId: session.user.id,
        sessionId: await sessionIdOf(session.refreshToken),
      });
      expect(await sessionIdOf(renewed.refreshToken)).toBe(
        await sessionIdOf(session.refreshToken),
      );
    });

    it('rejects a missing cookie as invalid_refresh', async () => {
      await expect(refresh.execute({})).rejects.toMatchObject({
        name: InvalidRefresh.name,
        reason: 'missing_token',
      });
      await expect(
        refresh.execute({ refreshToken: '' }),
      ).rejects.toBeInstanceOf(InvalidRefresh);
    });

    it('rejects an unknown token', async () => {
      await expect(
        refresh.execute({ refreshToken: 'not-a-known-token' }),
      ).rejects.toMatchObject({ reason: 'unknown_token' });
    });

    it('rejects a web refresh when expectedClient is extension', async () => {
      await expect(
        refresh.execute({
          refreshToken: session.refreshToken,
          expectedClient: 'extension',
        }),
      ).rejects.toMatchObject({ reason: 'unknown_token' });
    });

    it('rejects an extension refresh on the web path', async () => {
      const extension = await harness.sessionOpener.open(
        session.user,
        'extension',
      );

      await expect(
        refresh.execute({
          refreshToken: extension.refreshToken,
          expectedClient: 'web',
        }),
      ).rejects.toMatchObject({ reason: 'unknown_token' });
    });

    it('rotates an extension session when expectedClient matches', async () => {
      const extension = await harness.sessionOpener.open(
        session.user,
        'extension',
      );

      const renewed = await refresh.execute({
        refreshToken: extension.refreshToken,
        expectedClient: 'extension',
      });

      expect(renewed.refreshToken).not.toBe(extension.refreshToken);
      expect(
        harness.sessions.clientOf(await sessionIdOf(renewed.refreshToken)),
      ).toBe('extension');
    });

    it('Reuso revoca la sesión', async () => {
      const renewed = await refresh.execute({
        refreshToken: session.refreshToken,
      });
      harness.clock.advance(11 * SECOND);

      await expect(
        refresh.execute({ refreshToken: session.refreshToken }),
      ).rejects.toMatchObject({ name: InvalidRefresh.name, reason: 'reused' });

      await expect(
        refresh.execute({ refreshToken: renewed.refreshToken }),
      ).rejects.toMatchObject({ reason: 'session_revoked' });
    });

    it('warns about reuse with userId and sessionId and without any token', async () => {
      const renewed = await refresh.execute({
        refreshToken: session.refreshToken,
      });
      const sessionId = await sessionIdOf(session.refreshToken);
      harness.clock.advance(10 * SECOND);

      await refresh
        .execute({ refreshToken: session.refreshToken })
        .catch(() => undefined);

      expect(harness.securityLog.reusedTokens).toEqual([
        { userId: session.user.id, sessionId },
      ]);
      const logged = JSON.stringify(harness.securityLog.reusedTokens);
      for (const secret of [
        session.refreshToken,
        renewed.refreshToken,
        hashRefreshToken(session.refreshToken),
        session.accessToken,
      ]) {
        expect(logged).not.toContain(secret);
      }
    });

    it('Refresh concurrente', async () => {
      const renewed = await refresh.execute({
        refreshToken: session.refreshToken,
      });
      const next = await refresh.execute({
        refreshToken: renewed.refreshToken,
      });
      harness.clock.advance(2 * SECOND);

      // R2 ya rotó: R1 deja de reemitirse dentro de la ventana.
      await expect(
        refresh.execute({ refreshToken: session.refreshToken }),
      ).rejects.toBeInstanceOf(RefreshConflict);

      await expect(
        refresh.execute({ refreshToken: next.refreshToken }),
      ).resolves.toMatchObject({ user: session.user });
      expect(harness.securityLog.reusedTokens).toEqual([]);
      expect(harness.securityLog.reissuedTokens).toEqual([]);
    });

    it('Respuesta de rotación perdida', async () => {
      // La respuesta de esta rotación se pierde: el cliente descarta el sucesor.
      const lost = await refresh.execute({
        refreshToken: session.refreshToken,
      });
      harness.clock.advance(2 * SECOND);

      const recovered = await refresh.execute({
        refreshToken: session.refreshToken,
      });

      expect(recovered.refreshToken).not.toBe(session.refreshToken);
      expect(recovered.refreshToken).not.toBe(lost.refreshToken);
      expect(recovered.user).toEqual(session.user);
      expect(recovered.refreshExpiresAt).toEqual(
        new Date(harness.clock.now().getTime() + 30 * DAY),
      );
      const sessionId = await sessionIdOf(session.refreshToken);
      expect(await sessionIdOf(recovered.refreshToken)).toBe(sessionId);
      await expect(
        refresh.execute({ refreshToken: recovered.refreshToken }),
      ).resolves.toMatchObject({ user: session.user });
      expect(harness.sessions.isActive(sessionId)).toBe(true);
    });

    it('reports a reissue with userId, sessionId and reissueCount and without any token', async () => {
      const lost = await refresh.execute({
        refreshToken: session.refreshToken,
      });
      const sessionId = await sessionIdOf(session.refreshToken);
      harness.clock.advance(SECOND);
      const first = await refresh.execute({
        refreshToken: session.refreshToken,
      });
      harness.clock.advance(SECOND);
      const second = await refresh.execute({
        refreshToken: session.refreshToken,
      });

      expect(harness.securityLog.reissuedTokens).toEqual([
        { userId: session.user.id, sessionId, reissueCount: 1 },
        { userId: session.user.id, sessionId, reissueCount: 2 },
      ]);
      const logged = JSON.stringify(harness.securityLog.reissuedTokens);
      for (const secret of [
        session.refreshToken,
        lost.refreshToken,
        first.refreshToken,
        second.refreshToken,
        hashRefreshToken(session.refreshToken),
        first.accessToken,
      ]) {
        expect(logged).not.toContain(secret);
      }
      expect(harness.securityLog.reusedTokens).toEqual([]);
    });

    it('stops reissuing after 3 reissues and answers conflict', async () => {
      await refresh.execute({ refreshToken: session.refreshToken });
      for (let i = 0; i < 3; i++) {
        harness.clock.advance(SECOND);
        await refresh.execute({ refreshToken: session.refreshToken });
      }
      harness.clock.advance(SECOND);

      await expect(
        refresh.execute({ refreshToken: session.refreshToken }),
      ).rejects.toBeInstanceOf(RefreshConflict);
    });

    it('does not reissue a token rotated before reissue existed', async () => {
      await refresh.execute({ refreshToken: session.refreshToken });
      const stored = harness.sessions.tokens.get(
        hashRefreshToken(session.refreshToken),
      );
      if (stored) {
        stored.reissueCount = null;
      }
      harness.clock.advance(2 * SECOND);

      await expect(
        refresh.execute({ refreshToken: session.refreshToken }),
      ).rejects.toBeInstanceOf(RefreshConflict);
    });

    it('superseded siblings answer conflict and then reuse', async () => {
      const r2 = await refresh.execute({ refreshToken: session.refreshToken });
      harness.clock.advance(SECOND);
      const r3 = await refresh.execute({ refreshToken: session.refreshToken });
      harness.clock.advance(SECOND);
      await refresh.execute({ refreshToken: r3.refreshToken });
      harness.clock.advance(SECOND);

      await expect(
        refresh.execute({ refreshToken: r2.refreshToken }),
      ).rejects.toBeInstanceOf(RefreshConflict);
      harness.clock.advance(10 * SECOND);
      await expect(
        refresh.execute({ refreshToken: r2.refreshToken }),
      ).rejects.toMatchObject({ reason: 'reused' });
    });
  });

  describe('Logout', () => {
    it('Logout revoca el refresh', async () => {
      await logout.execute({ refreshToken: session.refreshToken });

      await expect(
        refresh.execute({ refreshToken: session.refreshToken }),
      ).rejects.toMatchObject({
        name: InvalidRefresh.name,
        reason: 'session_revoked',
      });
    });

    it('Logout sin sesión', async () => {
      await expect(logout.execute({})).resolves.toBeUndefined();
      await expect(
        logout.execute({ refreshToken: 'not-a-known-token' }),
      ).resolves.toBeUndefined();
    });

    it('revokes the session also with a token that was already rotated', async () => {
      const renewed = await refresh.execute({
        refreshToken: session.refreshToken,
      });

      await logout.execute({ refreshToken: session.refreshToken });

      await expect(
        refresh.execute({ refreshToken: renewed.refreshToken }),
      ).rejects.toMatchObject({ reason: 'session_revoked' });
    });

    it('leaves other sessions of the user untouched', async () => {
      const other = await harness.sessionOpener.open(session.user);

      await logout.execute({ refreshToken: session.refreshToken });

      await expect(
        refresh.execute({ refreshToken: other.refreshToken }),
      ).resolves.toBeDefined();
    });
  });
});
