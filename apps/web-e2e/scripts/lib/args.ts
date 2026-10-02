import { type OverridablePort, PORT_FLAGS, parsePort } from './block';

export type StackFault =
  | { readonly kind: 'inspect' }
  | { readonly kind: 'listen-after-preflight'; readonly host: string; readonly port: number }
  | { readonly kind: 'skip-kill'; readonly app: AppName };

export type AppName = 'api' | 'worker' | 'web';
export const APP_NAMES: readonly AppName[] = ['api', 'worker', 'web'];

export type MatchExpectation = 'replay-report' | 'consent-required';
export const MATCH_EXPECTATIONS: readonly MatchExpectation[] = ['replay-report', 'consent-required'];

/** Entradas del runner: **solo flags** (design D3). El resto de argumentos pasa a Playwright. */
export interface RunnerArgs {
  /**
   * `--e2e-remote`: la pone el target `web-e2e:e2e-remote` en su orden (design D3, «un runner, dos llamadores»). Sin
   * ella, el runner es `web-e2e:e2e-stack`.
   */
  readonly remoteTarget: boolean;
  readonly keepStack: boolean;
  readonly down: boolean;
  readonly rehearseRemote: boolean;
  readonly skipLocal: boolean;
  readonly portOverrides: Partial<Record<OverridablePort, number>>;
  /**
   * `undefined` si no se pasó: `e2e-stack` usa `replay-report` en el perfil `local` y `consent-required` en el ensayo
   * (`--rehearse-remote`, tarea 5.7); `e2e-remote` la exige (la declara el destino, D7). Si se pasa, vale para los dos
   * perfiles de la corrida.
   */
  readonly matchExpectation: MatchExpectation | undefined;
  readonly baseUrl: string | undefined;
  readonly apiOrigin: string | undefined;
  readonly stackFault: StackFault | undefined;
  readonly playwrightArgs: readonly string[];
}

export function parseStackFault(value: string): StackFault {
  if (value === 'inspect') {
    return { kind: 'inspect' };
  }
  const listen = /^listen-after-preflight:(.+):(\d+)$/.exec(value);
  if (listen !== null) {
    return {
      kind: 'listen-after-preflight',
      host: listen[1] ?? '',
      port: parsePort(listen[2] ?? '', '--stack-fault'),
    };
  }
  const skip = /^skip-kill:(api|worker|web)$/.exec(value);
  if (skip !== null) {
    return { kind: 'skip-kill', app: skip[1] as AppName };
  }
  throw new Error(
    `--stack-fault: unknown value "${value}" (expected inspect, listen-after-preflight:<host>:<port> or skip-kill:<api|worker|web>)`,
  );
}

function parseMatchExpectation(value: string): MatchExpectation {
  const known = MATCH_EXPECTATIONS.find((expectation) => expectation === value);
  if (known !== undefined) {
    return known;
  }
  throw new Error(`--match-expectation: "${value}" is not replay-report or consent-required`);
}

/**
 * Separa las flags del runner de los argumentos de Playwright. Acepta `--flag=valor` y `--flag valor`. Un `--grep` del
 * llamador se combina con el `@lot1` de la suite más adelante (no se pierde el filtro del lote).
 */
export function parseRunnerArgs(argv: readonly string[]): RunnerArgs {
  const portFlagToName = new Map<string, OverridablePort>(
    Object.entries(PORT_FLAGS).map(([name, flag]) => [flag, name as OverridablePort]),
  );
  let remoteTarget = false;
  let keepStack = false;
  let down = false;
  let rehearseRemote = false;
  let skipLocal = false;
  let matchExpectation: MatchExpectation | undefined;
  let baseUrl: string | undefined;
  let apiOrigin: string | undefined;
  let stackFault: StackFault | undefined;
  const portOverrides: Partial<Record<OverridablePort, number>> = {};
  const playwrightArgs: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const eq = arg.indexOf('=');
    const flag = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    const inlineValue = arg.startsWith('--') && eq > 0 ? arg.slice(eq + 1) : undefined;
    const takeValue = (): string => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`${flag} needs a value`);
      }
      i += 1;
      return next;
    };

    if (flag === '--e2e-remote') {
      remoteTarget = true;
    } else if (flag === '--keep-stack') {
      keepStack = true;
    } else if (flag === '--down') {
      down = true;
    } else if (flag === '--rehearse-remote') {
      rehearseRemote = true;
    } else if (flag === '--skip-local') {
      skipLocal = true;
    } else if (flag === '--match-expectation') {
      matchExpectation = parseMatchExpectation(takeValue());
    } else if (flag === '--base-url') {
      baseUrl = takeValue();
    } else if (flag === '--api-origin') {
      apiOrigin = takeValue();
    } else if (flag === '--stack-fault') {
      stackFault = parseStackFault(takeValue());
    } else if (portFlagToName.has(flag)) {
      const name = portFlagToName.get(flag);
      if (name !== undefined) {
        portOverrides[name] = parsePort(takeValue(), flag);
      }
    } else {
      playwrightArgs.push(arg);
    }
  }

  return {
    remoteTarget,
    keepStack,
    down,
    rehearseRemote,
    skipLocal,
    portOverrides,
    matchExpectation,
    baseUrl,
    apiOrigin,
    stackFault,
    playwrightArgs,
  };
}

/**
 * Argumentos finales de Playwright: las etiquetas que exige el perfil siempre —`@lot1` en `local`; `@lot1` **y**
 * `@remote-safe` en `remote` (design D1, D9, D14)—, combinadas con el `--grep` del llamador si lo hay (todas las
 * condiciones a la vez, con lookaheads).
 */
export function playwrightGrepArgs(passthrough: readonly string[], requiredTags: readonly string[]): string[] {
  const rest: string[] = [];
  let userGrep: string | undefined;
  for (let i = 0; i < passthrough.length; i += 1) {
    const arg = passthrough[i] ?? '';
    if (arg === '--grep' || arg === '-g') {
      userGrep = passthrough[i + 1];
      i += 1;
    } else if (arg.startsWith('--grep=')) {
      userGrep = arg.slice('--grep='.length);
    } else {
      rest.push(arg);
    }
  }
  const escaped = requiredTags.map((tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const conditions = [...escaped, ...(userGrep === undefined ? [] : [`(?:${userGrep})`])];
  const [only] = conditions;
  const grep =
    conditions.length === 1 && only !== undefined ? only : conditions.map((condition) => `(?=.*${condition})`).join('');
  return ['--grep', grep, ...rest];
}
