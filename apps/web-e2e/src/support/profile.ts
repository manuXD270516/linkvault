import { MATCH_EXPECTATIONS, type MatchExpectation } from '../../scripts/lib/args';
import { resolveRemoteOrigins } from '../../scripts/lib/remote';

/**
 * Perfil de la corrida (design D9): qué destino es y qué puede hacer la suite en él. Lo fija el runner con variables
 * que solo existen **del runner hacia Playwright** (D3): `E2E_PROFILE`, `E2E_BASE_URL`, `E2E_API_ORIGIN`,
 * `E2E_MATCH_EXPECTATION` y, en `remote`, las credenciales `E2E_REMOTE_EMAIL`/`E2E_REMOTE_PASSWORD`.
 *
 * | | `local` | `remote` |
 * |---|---|---|
 * | Pruebas | `@lot1` | `@lot1` **y** `@remote-safe` |
 * | Cuentas | las registra cada prueba | declaradas por variables |
 * | Encaje esperado | `replay-report` | lo declara el destino |
 * | Origen de la API | el de la configuración | **siempre** `new URL('/api', E2E_BASE_URL)` |
 */
export type ProfileName = 'local' | 'remote';

export interface RemoteAccount {
  readonly email: string;
  readonly password: string;
}

export interface Profile {
  readonly name: ProfileName;
  /** Origen de la aplicación: el `baseURL` de Playwright. Ninguna prueba escribe un origen a mano (D9). */
  readonly baseUrl: string;
  /** Origen de la API. En `remote`, derivado del de la aplicación; uno distinto hace fallar el perfil. */
  readonly apiOrigin: string;
  readonly matchExpectation: MatchExpectation;
  /** Cuenta de prueba declarada: solo en `remote`. En `local` cada prueba registra las suyas. */
  readonly remoteAccount: RemoteAccount | undefined;
}

function readMatchExpectation(value: string | undefined, fallback: MatchExpectation | undefined): MatchExpectation {
  if (value === undefined || value === '') {
    if (fallback === undefined) {
      throw new Error('E2E_MATCH_EXPECTATION is not set: the remote destination declares it (--match-expectation)');
    }
    return fallback;
  }
  const known = MATCH_EXPECTATIONS.find((expectation) => expectation === value);
  if (known === undefined) {
    throw new Error(`E2E_MATCH_EXPECTATION "${value}" is not ${MATCH_EXPECTATIONS.join(' or ')}`);
  }
  return known;
}

/**
 * Perfil a partir del entorno que pone el runner. `configuredBaseUrl` es el `baseURL` del proyecto de Playwright, que
 * sale de `E2E_BASE_URL` con el runner (y del camino antiguo sin él). Lanza un error, antes de ejecutar nada de la
 * prueba, si al perfil `remote` le falta el origen, la expectativa o la cuenta, o si el origen de la API no se deriva
 * del de la aplicación.
 */
export function resolveProfile(env: NodeJS.ProcessEnv, configuredBaseUrl: string | undefined): Profile {
  const name = env['E2E_PROFILE'] ?? 'local';
  if (name === 'remote') {
    const baseUrl = env['E2E_BASE_URL'];
    if (baseUrl === undefined || baseUrl === '') {
      throw new Error('the remote profile has no origin (E2E_BASE_URL, set by web-e2e:e2e-remote from --base-url)');
    }
    const origins = resolveRemoteOrigins(baseUrl, env['E2E_API_ORIGIN']);
    const email = env['E2E_REMOTE_EMAIL'] ?? '';
    const password = env['E2E_REMOTE_PASSWORD'] ?? '';
    if (email === '' || password === '') {
      throw new Error('the remote profile has no declared account (E2E_REMOTE_EMAIL and E2E_REMOTE_PASSWORD)');
    }
    return {
      name: 'remote',
      baseUrl: origins.baseUrl,
      apiOrigin: origins.apiOrigin,
      matchExpectation: readMatchExpectation(env['E2E_MATCH_EXPECTATION'], undefined),
      remoteAccount: { email, password },
    };
  }
  if (name !== 'local') {
    throw new Error(`E2E_PROFILE "${name}" is not local or remote`);
  }
  const baseUrl = env['E2E_BASE_URL'] ?? configuredBaseUrl;
  if (baseUrl === undefined || baseUrl === '') {
    throw new Error('the local profile has no origin: neither E2E_BASE_URL nor the Playwright baseURL is set');
  }
  const apiOrigin = env['E2E_API_ORIGIN'];
  return {
    name: 'local',
    baseUrl,
    apiOrigin: apiOrigin === undefined || apiOrigin === '' ? new URL('/api', baseUrl).href : apiOrigin,
    matchExpectation: readMatchExpectation(env['E2E_MATCH_EXPECTATION'], 'replay-report'),
    remoteAccount: undefined,
  };
}
