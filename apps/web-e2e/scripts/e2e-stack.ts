import { type ChildProcess, spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { type AppName, parseRunnerArgs, playwrightGrepArgs, type RunnerArgs } from './lib/args';
import { blockPorts, composeProjectName, type PortBlock, resolveBlock } from './lib/block';
import { DOCKER_WINDOWS_EXTRA, pickWhitelisted, readEnvFile, SYSTEM_WHITELIST } from './lib/env';
import { type ComposeContext, composePs, parsePublishedPorts, startInfra, stopInfra } from './lib/infra';
import { keepStackMessage } from './lib/keep-stack';
import { isAlive, launchHiddenWindows } from './lib/launch-hidden';
import { evaluateListeners, listListeners } from './lib/listeners';
import { describeBusy, probePorts } from './lib/ports';
import { runCommand } from './lib/proc';
import { isSameCheckoutServe, killTree, listProcesses, type ProcessInfo, processTree } from './lib/processes';
import {
  compareListenerPids,
  describeRehearsalWorker,
  REHEARSAL_WORKER_OVERRIDES,
  rehearsalMatchExpectation,
  rehearsalWorkerEnv,
} from './lib/rehearsal';
import { findCredentialsInDotEnvFiles, REMOTE_CREDENTIAL_KEYS, resolveRemoteOrigins } from './lib/remote';
import { type SeedAccount, seedRehearsalAccount } from './lib/seed';

// Runner de la suite end-to-end (change `e2e-suite`, design D3). Se ejecuta con `node --import tsx` desde dos targets,
// con la raíz del repositorio como directorio de trabajo. Salida por `process.stdout`/`stderr`.
//
// `web-e2e:e2e-stack`: comprobación previa → infraestructura → aplicaciones → (siembra) → suite → apagado. El apagado
// ocurre siempre (`finally` y SIGINT/SIGTERM), salvo con `--keep-stack`, y solo toca lo que esta corrida lanzó. Con
// `--rehearse-remote`, la siembra de la cuenta del ensayo y, tras el perfil `local` (salvo `--skip-local`), el
// **ensayo**: el perfil `remote` contra la misma pila.
//
// `web-e2e:e2e-remote` (su orden lleva `--e2e-remote`): no monta nada; comprobación previa (origen, expectativa,
// credenciales) → suite con el perfil `remote` contra el origen de `--base-url`.

/** Prefijo de los mensajes: el del target que lanzó el runner. */
const PREFIX = process.argv.includes('--e2e-remote') ? '[e2e-remote]' : '[e2e-stack]';
/** Etiquetas que exige cada perfil (design D1, D9, D14). */
const LOCAL_TAGS = ['@lot1'] as const;
const REMOTE_TAGS = ['@lot1', '@remote-safe'] as const;
const E2E_PROJECT_DIR = 'apps/web-e2e';
const ENV_FILE = 'apps/web-e2e/e2e.env';
const PLAYWRIGHT_CONFIG = 'apps/web-e2e/playwright.config.mts';
const PROXY_CONFIG = 'apps/web-e2e/proxy.conf.mjs';
const STACK_DIR = 'dist/.playwright/apps/web-e2e/stack-logs';
const STATE_FILE = 'stack-state.json';
/** Cuenta del ensayo remoto: sale de `e2e.env`, no del entorno (design D3, D10). */
const REHEARSAL_EMAIL_KEY = 'E2E_REHEARSAL_EMAIL';
const REHEARSAL_PASSWORD_KEY = 'E2E_REHEARSAL_PASSWORD';
const REHEARSAL_DISPLAY_NAME = 'Ensayo remoto e2e';
const APP_START_TIMEOUT_MS = 10 * 60_000;
const SHUTDOWN_FREE_TIMEOUT_MS = 30_000;

type Phase = 'comprobación previa' | 'infraestructura' | 'aplicaciones' | 'siembra' | 'suite' | 'apagado';

class PhaseError extends Error {
  constructor(
    readonly phase: Phase,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Copia de los mensajes del runner en `stack-logs/runner.log`. Con Ctrl+C, Nx (el padre) puede terminar antes que el
 * runner y cerrar su salida: el apagado sigue y lo que dice queda en el fichero (medido en la tarea 2.8).
 */
let runnerLogPath: string | undefined;
const earlyLines: string[] = [];

/** Empieza la copia en fichero con lo ya dicho (nombre del proyecto, comprobación previa). */
function startRunnerLog(path: string): void {
  writeFileSync(path, earlyLines.join(''));
  runnerLogPath = path;
}

function writeLine(stream: NodeJS.WriteStream, line: string): void {
  if (runnerLogPath === undefined) {
    earlyLines.push(line);
  } else {
    try {
      writeFileSync(runnerLogPath, line, { flag: 'a' });
    } catch {
      // El fichero es una copia; su fallo no cambia el resultado.
    }
  }
  try {
    stream.write(line);
  } catch {
    // Salida cerrada (EPIPE): la copia en fichero ya está escrita.
  }
}

function log(message: string): void {
  writeLine(process.stdout, `${PREFIX} ${message}\n`);
}

function logError(message: string): void {
  writeLine(process.stderr, `${PREFIX} ${message}\n`);
}

// Una salida cerrada por el padre no puede tumbar el apagado.
process.stdout.on('error', () => undefined);
process.stderr.on('error', () => undefined);

interface LaunchedApp {
  readonly name: AppName;
  /** `undefined` cuando se lanzó fuera del runner (`--keep-stack` en Windows): su fin se detecta por el PID. */
  readonly child: ChildProcess | undefined;
  readonly pid: number;
  readonly logPath: string;
  exited: string | null;
  logOffset: number;
}

interface StackState {
  readonly projectName: string;
  readonly block: PortBlock;
  readonly apps: readonly { name: AppName; pid: number; commandLine: string }[];
}

/** Sustituye el puerto de una URI (`mongodb://…`, `redis://…`, `http://…`) conservando el resto. */
function withPort(uri: string, port: number): string {
  return uri.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/:?#]+):\d+/i, `$1:${port}`);
}

/** Variables de `e2e.env` recalculadas desde el bloque efectivo (design D4). */
function applyBlock(suiteEnv: Readonly<Record<string, string>>, block: PortBlock): Record<string, string> {
  const env: Record<string, string> = { ...suiteEnv };
  const set = (key: string, value: string): void => {
    if (key in env) {
      env[key] = value;
    }
  };
  set('MONGO_PORT', String(block.mongo));
  set('REDIS_PORT', String(block.redis));
  set('OBJECT_STORE_PORT', String(block.objectStore));
  set('MINIO_PORT', String(block.objectStore));
  set('MINIO_CONSOLE_PORT', String(block.objectStoreConsole));
  set('MAILPIT_SMTP_PORT', String(block.mailpitSmtp));
  set('MAILPIT_UI_PORT', String(block.mailpitUi));
  set('MAIL_SMTP_PORT', String(block.mailpitSmtp));
  set('API_PORT', String(block.api));
  set('WORKER_HEALTH_PORT', String(block.worker));
  for (const [key, port] of [
    ['MONGO_URI', block.mongo],
    ['REDIS_URL', block.redis],
    ['S3_ENDPOINT', block.objectStore],
    ['WEB_BASE_URL', block.web],
    ['PUBLIC_PAGE_BASE_URL', block.api],
  ] as const) {
    const value = env[key];
    if (value !== undefined) {
      env[key] = withPort(value, port);
    }
  }
  return env;
}

class Stack {
  readonly root = process.cwd();
  readonly stackDir = join(this.root, STACK_DIR);
  readonly apps: LaunchedApp[] = [];
  faultChild: ChildProcess | undefined;
  playwright: ChildProcess | undefined;
  fatal: string | null = null;
  shuttingDown = false;
  started = false;
  private shutdownPromise: Promise<void> | undefined;
  private watcher: NodeJS.Timeout | undefined;

  constructor(
    readonly args: RunnerArgs,
    readonly block: PortBlock,
    readonly projectName: string,
    readonly suiteEnv: Record<string, string>,
    readonly appEnv: Record<string, string>,
    readonly compose: ComposeContext,
    readonly toolEnv: Record<string, string>,
  ) {}

  appPort(name: AppName): number {
    return name === 'api' ? this.block.api : name === 'worker' ? this.block.worker : this.block.web;
  }

  throwIfFatal(phase: Phase): void {
    if (this.fatal !== null) {
      throw new PhaseError(phase, this.fatal);
    }
  }

  // --- 1. Comprobación previa -----------------------------------------------------------------------------------

  async preflight(): Promise<void> {
    const phase: Phase = 'comprobación previa';
    const docker = await runCommand('docker', ['version', '--format', '{{.Server.Version}}'], {
      cwd: this.root,
      env: this.compose.env,
    });
    if (docker.code !== 0) {
      throw new PhaseError(phase, `Docker does not respond: ${docker.stderr.trim() || docker.stdout.trim()}`);
    }
    const compose = await runCommand('docker', ['compose', 'version', '--short'], { cwd: this.root, env: this.compose.env });
    if (compose.code !== 0) {
      throw new PhaseError(phase, `docker compose is not available: ${compose.stderr.trim()}`);
    }
    const browser = chromium.executablePath();
    if (!existsSync(browser)) {
      throw new PhaseError(phase, `the Playwright Chromium browser is not installed (${browser}): pnpm exec playwright install chromium`);
    }
    const probes = await probePorts(blockPorts(this.block));
    if (probes.some((probe) => probe.busy)) {
      throw new PhaseError(phase, `ports of the suite block are not free; nothing was started:\n  ${describeBusy(probes)}`);
    }
    const processes = await listProcesses(this.toolEnv, this.root);
    const serves = processes.filter(
      (info) => info.pid !== process.pid && isSameCheckoutServe(info.commandLine, this.root, process.platform),
    );
    if (serves.length > 0) {
      throw new PhaseError(
        phase,
        'a development serve of api or worker from this checkout is running (it builds into the same dist/); nothing was started:\n' +
          serves.map((info) => `  PID ${info.pid}: ${info.commandLine}`).join('\n'),
      );
    }
    log(`comprobación previa: Docker ${docker.stdout.trim()}, compose ${compose.stdout.trim()}, Chromium instalado, ${probes.length} puertos del bloque libres, ningún serve de api/worker de este checkout`);
  }

  /** `--stack-fault=listen-after-preflight`: un oyente en un hijo que **no** entra en el árbol lanzado (design D3). */
  async startFaultListener(): Promise<void> {
    const fault = this.args.stackFault;
    if (fault?.kind !== 'listen-after-preflight') {
      return;
    }
    const script =
      "const [host, port] = process.argv.slice(1); require('node:net').createServer().listen(Number(port), host, () => process.stdout.write('ready\\n'));";
    const child = spawn(process.execPath, ['-e', script, fault.host, String(fault.port)], {
      cwd: this.root,
      env: this.toolEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.faultChild = child;
    await new Promise<void>((resolve, reject) => {
      child.stdout?.once('data', () => resolve());
      child.once('exit', (code) => reject(new PhaseError('comprobación previa', `fault listener exited (${code})`)));
    });
    log(`--stack-fault: oyente ajeno en ${fault.host}:${fault.port} (PID ${child.pid ?? '?'}, fuera del árbol lanzado)`);
  }

  // --- 2. Infraestructura ---------------------------------------------------------------------------------------

  async infrastructure(): Promise<void> {
    const phase: Phase = 'infraestructura';
    this.started = true;
    log(`infraestructura: docker compose del proyecto ${this.projectName} con ${ENV_FILE}`);
    const up = await startInfra(this.compose);
    this.appendLog('infra.log', `$ docker compose up -d --wait\n${up.stdout}${up.stderr}`);
    if (up.code !== 0) {
      throw new PhaseError(phase, `docker compose up failed (exit ${up.code})`);
    }
    const ps = await composePs(this.compose, false);
    if (ps.code !== 0) {
      throw new PhaseError(phase, `docker compose ps failed: ${ps.stderr.trim()}`);
    }
    this.appendLog('infra.log', `$ docker compose ps --format json\n${ps.stdout}`);
    const allowed = new Set(blockPorts(this.block));
    const outside = parsePublishedPorts(ps.stdout).filter((published) => !allowed.has(published.port));
    if (outside.length > 0) {
      const unique = [...new Map(outside.map((item) => [`${item.service}:${item.port}`, item])).values()];
      throw new PhaseError(
        phase,
        unique.map((item) => `service ${item.service} publishes port ${item.port}, fuera del bloque`).join('; '),
      );
    }
    log('infraestructura: servicios sanos y todos los puertos publicados dentro del bloque');
  }

  // --- 3. Aplicaciones ------------------------------------------------------------------------------------------

  /**
   * Lanza una aplicación con `nx`. Por defecto, con el entorno de la suite y un log nuevo; el `worker` del ensayo
   * (tarea 4.5) pasa su propio entorno y **añade** al log, que así conserva también el del perfil `local`.
   */
  private async launch(
    name: AppName,
    nxArgs: readonly string[],
    options: { readonly env?: Record<string, string>; readonly append?: boolean; readonly label?: string } = {},
  ): Promise<LaunchedApp> {
    const logPath = join(this.stackDir, `${name}.log`);
    const append = options.append === true;
    const logOffset = append && existsSync(logPath) ? statSync(logPath).size : 0;
    const args = [nxBinPath(this.root), ...nxArgs];
    // Nx 23.2.1 apunta cada tarea en curso en su base de datos local (`task_invocations`) con la clave «PID raíz de la
    // invocación» (`NX_INVOCATION_ROOT_PID`, o el propio PID si no está) y la borra al terminar la tarea. El apagado mata
    // el árbol de `nx serve` sin dejarle borrarla, y cuando Windows reutiliza ese PID para el `nx serve` de una corrida
    // posterior, Nx lo toma por una recursión («Recursive task invocation detected: api:serve:development ->
    // api:serve:development») y sale: medido el 2026-09-27. Cada lanzamiento recibe una raíz propia, que no es un PID
    // real ni se repite, para que un registro huérfano no pueda chocar con él. Es una variable `NX_*`: entra en el
    // conjunto permitido de design D6.
    const env = { ...(options.env ?? this.appEnv), NX_INVOCATION_ROOT_PID: String(randomInt(1_000_000_000, 2_000_000_000)) };
    let app: LaunchedApp;
    if (process.platform === 'win32' && this.args.keepStack) {
      // --keep-stack en Windows: fuera del job del runner y sin ventanas (ver launch-hidden.ts).
      const pid = await launchHiddenWindows({
        name,
        executable: process.execPath,
        args,
        env,
        cwd: this.root,
        logPath,
        workDir: this.stackDir,
        append,
      });
      app = { name, child: undefined, pid, logPath, exited: null, logOffset };
    } else {
      // Linux: grupo de procesos propio (se mata el grupo entero). Windows: libuv mete al hijo en un job que lo mata si
      // el runner muere, que es la red de seguridad que se quiere cuando la pila no se conserva.
      const fd = openSync(logPath, append ? 'a' : 'w');
      const child = spawn(process.execPath, args, {
        cwd: this.root,
        env,
        stdio: ['ignore', fd, fd],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
      closeSync(fd);
      if (child.pid === undefined) {
        throw new PhaseError('aplicaciones', `${name} could not be launched`);
      }
      const launched: LaunchedApp = { name, child, pid: child.pid, logPath, exited: null, logOffset };
      child.once('exit', (code, signal) => this.markExited(launched, `exit ${code ?? signal ?? '?'}`));
      app = launched;
    }
    this.apps.push(app);
    log(`${options.label ?? 'aplicaciones'}: ${name} lanzado (PID ${app.pid}) → ${STACK_DIR}/${name}.log`);
    return app;
  }

  private markExited(app: LaunchedApp, how: string): void {
    if (app.exited !== null) {
      return;
    }
    app.exited = how;
    if (!this.shuttingDown && this.fatal === null) {
      // El fin del proceso puede llegar antes que la lectura periódica del log: se mira aquí mismo si dijo EADDRINUSE,
      // para que el motivo quede nombrado siempre (medido en la repetición de la 2.7).
      const log = existsSync(app.logPath) ? readFileSync(app.logPath, 'utf8') : '';
      const cause = /EADDRINUSE/.test(log) ? 'reports EADDRINUSE (its port is in use by another process) and ' : '';
      this.fatal = `${app.name} ${cause}terminated before the end of the run (${how}); see ${STACK_DIR}/${app.name}.log`;
    }
  }

  /** Mientras dura la corrida, un proceso lanzado que termina o cuyo log dice `EADDRINUSE` hace fallar la corrida. */
  private startWatcher(): void {
    this.watcher = setInterval(() => {
      for (const app of this.apps) {
        if (app.child === undefined && !isAlive(app.pid)) {
          this.markExited(app, 'process gone');
        }
        if (!existsSync(app.logPath)) {
          continue;
        }
        const size = statSync(app.logPath).size;
        if (size <= app.logOffset) {
          continue;
        }
        const text = readFileSync(app.logPath).subarray(app.logOffset).toString('utf8');
        app.logOffset = size;
        if (/EADDRINUSE/.test(text) && !this.shuttingDown && this.fatal === null) {
          this.fatal = `${app.name} reports EADDRINUSE (its port is in use by another process); see ${STACK_DIR}/${app.name}.log`;
        }
      }
    }, 500);
    this.watcher.unref();
  }

  private async waitUntil(phase: Phase, label: string, probe: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + APP_START_TIMEOUT_MS;
    for (;;) {
      this.throwIfFatal(phase);
      if (await probe()) {
        return;
      }
      if (Date.now() > deadline) {
        throw new PhaseError(phase, `${label}: not ready after ${APP_START_TIMEOUT_MS / 60_000} minutes`);
      }
      await delay(1_000);
    }
  }

  private async healthUp(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(3_000) });
      if (response.status !== 200) {
        return false;
      }
      const body = (await response.json()) as {
        status?: string;
        checks?: { mongo?: { status?: string }; redis?: { status?: string } };
      };
      return body.status === 'up' && body.checks?.mongo?.status === 'up' && body.checks.redis?.status === 'up';
    } catch {
      return false;
    }
  }

  private async webUp(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(3_000) });
      return response.status === 200 && (await response.text()).includes('<lv-root');
    } catch {
      return false;
    }
  }

  async applications(): Promise<void> {
    const phase: Phase = 'aplicaciones';
    mkdirSync(this.stackDir, { recursive: true });
    this.startWatcher();
    const inspect = this.args.stackFault?.kind === 'inspect';
    const inspectArgs = (port: number): string[] => (inspect ? ['--inspect=inspect', `--port=${port}`] : ['--inspect=false']);
    // Nx quita del entorno de cada tarea las variables cuyo valor coincide con el del `.env` de la raíz, aunque no las
    // haya cargado (`unloadDotEnvFiles`, nx 23.2.1, también con `NX_LOAD_DOT_ENV_FILES=false`): con un `.env` de
    // desarrollo, `api` arrancaba sin `LOG_LEVEL`, `AUTH_*`… (medido el 2026-09-27, tarea 2.4b). Por eso `api` y
    // `worker` reciben además el entorno efectivo de la suite con `node --env-file`, que repone lo quitado y no pisa
    // lo que ya está (los valores del runner). Es el mismo entorno: no añade ninguna variable.
    const effectiveEnvFile = join(this.stackDir, 'effective-e2e.env');
    writeEnvFile(effectiveEnvFile, this.suiteEnv);
    const envFileArg = `--runtimeArgs=--env-file=${effectiveEnvFile}`;

    await this.launch('api', ['run', 'api:serve', '--watch=false', envFileArg, ...inspectArgs(this.block.apiInspector)]);
    await this.waitUntil(phase, `api /health on ${this.block.api}`, () => this.healthUp(this.block.api));
    log(`aplicaciones: api sano en ${this.block.api} (mongo y redis up)`);

    await this.launch('worker', this.workerArgs(effectiveEnvFile, inspect));
    await this.waitUntil(phase, `worker /health on ${this.block.worker}`, () => this.healthUp(this.block.worker));
    log(`aplicaciones: worker sano en ${this.block.worker} (mongo y redis up)`);

    await this.launch('web', ['run', 'web:serve:production', `--port=${this.block.web}`, `--proxyConfig=${PROXY_CONFIG}`]);
    await this.waitUntil(phase, `web document on ${this.block.web}`, () => this.webUp(this.block.web));
    log(`aplicaciones: web sirve el documento con <lv-root en ${this.block.web}`);

    await this.pidGuard(phase, 'aplicaciones', inspect);
    this.throwIfFatal(phase);
    this.writeState(await listProcesses(this.toolEnv, this.root));
  }

  /** Argumentos de `nx` para `worker`: los mismos en el arranque y en el reinicio del ensayo. */
  private workerArgs(envFile: string, inspect: boolean): string[] {
    return [
      'run',
      'worker:serve',
      '--watch=false',
      `--runtimeArgs=--env-file=${envFile}`,
      ...(inspect ? ['--inspect=inspect', `--port=${this.block.workerInspector}`] : ['--inspect=false']),
    ];
  }

  /** PID de cada fila de escucha de un puerto. */
  private async listenerPids(port: number): Promise<number[]> {
    const rows = await listListeners([port], this.toolEnv, this.root);
    return rows.map((row) => row.pid).filter((pid): pid is number => pid !== null);
  }

  /** Guardia de PID (design D3): cada fila de escucha de cada puerto de aplicación es del árbol lanzado. */
  private async pidGuard(phase: Phase, label: string, inspect: boolean): Promise<void> {
    const ports: { port: number; owner: string }[] = [
      { port: this.block.api, owner: 'api' },
      { port: this.block.worker, owner: 'worker' },
      { port: this.block.web, owner: 'web' },
      ...(inspect
        ? [
            { port: this.block.apiInspector, owner: 'api inspector' },
            { port: this.block.workerInspector, owner: 'worker inspector' },
          ]
        : []),
    ];
    const rows = await listListeners(
      ports.map((item) => item.port),
      this.toolEnv,
      this.root,
    );
    const processes = await listProcesses(this.toolEnv, this.root);
    const own = processTree(
      this.apps.map((app) => app.pid),
      processes,
    );
    own.delete(process.pid);
    const problems: string[] = [];
    for (const { port, owner } of ports) {
      const verdict = evaluateListeners(
        rows.filter((row) => row.port === port),
        own,
      );
      if (!verdict.ok) {
        problems.push(...verdict.problems.map((problem) => `${owner}: ${problem}${describePid(problem, processes)}`));
      }
    }
    if (problems.length > 0) {
      throw new PhaseError(phase, `PID guard: another process serves a port of the block:\n  ${problems.join('\n  ')}`);
    }
    log(`${label}: guardia de PID en verde (${rows.length} filas de escucha, todas del árbol lanzado)`);
  }

  private writeState(processes: readonly ProcessInfo[]): void {
    const state: StackState = {
      projectName: this.projectName,
      block: this.block,
      apps: this.apps.map((app) => ({
        name: app.name,
        pid: app.pid,
        commandLine: processes.find((info) => info.pid === app.pid)?.commandLine ?? '',
      })),
    };
    writeFileSync(join(this.stackDir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
  }

  // --- 4. Siembra (solo con --rehearse-remote) --------------------------------------------------------------------

  /** Origen de la aplicación servida por la pila; el de su API se deriva de él, como en `remote` (design D9). */
  private webOrigin(): string {
    return `http://localhost:${this.block.web}`;
  }

  /**
   * La cuenta del ensayo, **por la API pública** a través del mismo origen que usará el ensayo (design D3 fase 4, D5):
   * alta y, si ya existe, login correcto. Consume un intento de registro.
   */
  async seed(account: SeedAccount): Promise<void> {
    const phase: Phase = 'siembra';
    this.throwIfFatal(phase);
    const { apiOrigin } = resolveRemoteOrigins(this.webOrigin(), undefined);
    const outcome = await seedRehearsalAccount(
      async (url, init) => {
        const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
        return { status: response.status };
      },
      apiOrigin,
      account,
    );
    this.throwIfFatal(phase);
    log(
      outcome === 'registered'
        ? `siembra: cuenta del ensayo ${account.email} registrada por POST /api/auth/register (201)`
        : `siembra: cuenta del ensayo ${account.email} ya existía (409); login correcto (200)`,
    );
  }

  // --- 5. Suite -------------------------------------------------------------------------------------------------

  /** El perfil `local` (salvo `--skip-local`) y, con `--rehearse-remote`, el ensayo del perfil `remote`. */
  async suite(rehearsal: SeedAccount | undefined): Promise<void> {
    if (!this.args.skipLocal) {
      await this.runProfile(
        'local',
        LOCAL_TAGS,
        {
          ...this.appEnv,
          E2E_BASE_URL: this.webOrigin(),
          E2E_PROFILE: 'local',
          E2E_MATCH_EXPECTATION: this.args.matchExpectation ?? 'replay-report',
        },
        `perfil local, E2E_BASE_URL=${this.webOrigin()}`,
      );
    }
    if (rehearsal !== undefined) {
      await this.restartWorkerForRehearsal();
      const origins = resolveRemoteOrigins(this.webOrigin(), undefined);
      // El ensayo acepta `--match-expectation` como `e2e-remote`; sin ella, `consent-required`: la cuenta del ensayo no
      // tiene permiso de IA externa y el `worker` reiniciado tiene un proveedor inalcanzable (design D3, D7; decisión del
      // usuario del 2026-09-27, tarea 5.7).
      const expectation = rehearsalMatchExpectation(this.args.matchExpectation);
      // Como `e2e-remote`: lista blanca del sistema y las variables del perfil, sin `e2e.env` (el perfil `remote` no
      // sabe nada de la pila que tiene detrás, design D9).
      await this.runProfile(
        'remote',
        REMOTE_TAGS,
        {
          ...this.toolEnv,
          E2E_BASE_URL: origins.baseUrl,
          E2E_API_ORIGIN: origins.apiOrigin,
          E2E_PROFILE: 'remote',
          E2E_MATCH_EXPECTATION: expectation,
          E2E_REMOTE_EMAIL: rehearsal.email,
          E2E_REMOTE_PASSWORD: rehearsal.password,
        },
        `ensayo: perfil remote contra ${origins.baseUrl}, API ${origins.apiOrigin}, expectativa ${expectation}, cuenta ${rehearsal.email}`,
      );
    }
  }

  /**
   * Tarea 4.5 (design D3 fase 5, D7): antes del ensayo, reinicia **solo** `worker` con un proveedor de IA externo
   * configurado pero inalcanzable (`lib/rehearsal.ts`), espera su `/health` y el guardia de PID sobre el `worker`
   * nuevo, y comprueba que `api` no se reinició: los PID que escuchan en su puerto son los mismos antes y después.
   */
  async restartWorkerForRehearsal(): Promise<void> {
    const phase: Phase = 'suite';
    this.throwIfFatal(phase);
    const old = this.apps.find((app) => app.name === 'worker');
    const api = this.apps.find((app) => app.name === 'api');
    if (old === undefined || api === undefined) {
      throw new PhaseError(phase, 'ensayo: api and worker must be running before the worker restart');
    }
    const inspect = this.args.stackFault?.kind === 'inspect';
    const apiBefore = await this.listenerPids(this.block.api);
    // Parada a propósito: ni su manejador de salida ni el vigilante la cuentan como una caída.
    old.exited = 'stopped by the runner for the rehearsal';
    await killTree(old.pid, this.toolEnv, this.root);
    const ports = [this.block.worker, ...(inspect ? [this.block.workerInspector] : [])];
    const busy = await waitForFreeBlock(ports, SHUTDOWN_FREE_TIMEOUT_MS);
    if (busy !== '') {
      throw new PhaseError(phase, `ensayo: the old worker still holds its port after being stopped:\n  ${busy}`);
    }
    this.apps.splice(this.apps.indexOf(old), 1);
    // El fichero de `--env-file` lleva también las variables del ensayo: Nx quita del entorno de la tarea las que
    // coinciden con el `.env` de la raíz, y ese fichero las repone (design D6, hallazgos del apply).
    const envFile = join(this.stackDir, 'effective-rehearsal-worker.env');
    writeEnvFile(envFile, rehearsalWorkerEnv(this.suiteEnv));
    const chain = describeRehearsalWorker();
    this.appendLog('worker.log', `\n${PREFIX} ensayo: worker reiniciado (PID anterior ${old.pid}) con ${chain}\n`);
    const fresh = await this.launch('worker', this.workerArgs(envFile, inspect), {
      env: { ...this.appEnv, ...REHEARSAL_WORKER_OVERRIDES },
      append: true,
      label: 'ensayo',
    });
    await this.waitUntil(phase, `rehearsal worker /health on ${this.block.worker}`, () => this.healthUp(this.block.worker));
    await this.pidGuard(phase, 'ensayo', inspect);
    const apiAfter = await this.listenerPids(this.block.api);
    const problem = compareListenerPids(`api (port ${this.block.api})`, apiBefore, apiAfter);
    if (problem !== null) {
      throw new PhaseError(phase, `ensayo: ${problem}`);
    }
    this.throwIfFatal(phase);
    this.writeState(await listProcesses(this.toolEnv, this.root));
    log(
      `ensayo: worker reiniciado (PID ${old.pid} → ${fresh.pid}) con ${chain}; api no se reinició ` +
        `(PID raíz ${api.pid}; escucha en ${this.block.api}: ${[...new Set(apiBefore)].join(',')} antes y ${[...new Set(apiAfter)].join(',')} después)`,
    );
  }

  private async runProfile(
    profile: 'local' | 'remote',
    tags: readonly string[],
    env: Record<string, string>,
    description: string,
  ): Promise<void> {
    const phase: Phase = 'suite';
    this.throwIfFatal(phase);
    const args = playwrightCliArgs(this.args.playwrightArgs, tags);
    log(`suite: playwright ${args.slice(1).join(' ')} (${description})`);
    const code = await runPlaywright(this.root, args, env, (child) => {
      this.playwright = child;
    });
    this.playwright = undefined;
    this.throwIfFatal(phase);
    if (code !== 0) {
      throw new PhaseError(phase, `Playwright exited with code ${code} (perfil ${profile})`);
    }
    log(`suite: Playwright en verde (perfil ${profile})`);
  }

  // --- 6. Apagado -----------------------------------------------------------------------------------------------

  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.doShutdown();
    return this.shutdownPromise;
  }

  private async doShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.watcher !== undefined) {
      clearInterval(this.watcher);
    }
    const problems: string[] = [];
    if (this.playwright?.pid !== undefined) {
      await killTree(this.playwright.pid, this.toolEnv, this.root);
    }
    const skip = this.args.stackFault?.kind === 'skip-kill' ? this.args.stackFault.app : undefined;
    for (const app of [...this.apps].reverse()) {
      if (app.name === skip) {
        log(`apagado: --stack-fault=skip-kill:${app.name}: ${app.name} (PID ${app.pid}) NO se mata`);
        continue;
      }
      await killTree(app.pid, this.toolEnv, this.root);
    }
    if (this.faultChild?.pid !== undefined) {
      await killTree(this.faultChild.pid, this.toolEnv, this.root);
      log(`apagado: oyente de --stack-fault (PID ${this.faultChild.pid}) terminado`);
    }
    if (this.started) {
      const down = await stopInfra(this.compose);
      this.appendLog('infra.log', `$ docker compose down -v --remove-orphans\n${down.stdout}${down.stderr}`);
      if (down.code !== 0) {
        problems.push(`docker compose down failed (exit ${down.code})`);
      }
    }
    const busy = await waitForFreeBlock(blockPorts(this.block), SHUTDOWN_FREE_TIMEOUT_MS);
    if (busy !== '') {
      problems.push(`the block is not free after shutdown:\n  ${busy}`);
    }
    // Lo que siga vivo (solo con --stack-fault=skip-kill) no retiene al runner: el fallo ya está nombrado.
    for (const app of this.apps) {
      app.child?.unref();
    }
    if (problems.length > 0) {
      throw new PhaseError('apagado', problems.join('\n'));
    }
    log(`apagado: procesos lanzados terminados, proyecto ${this.projectName} sin contenedores ni volúmenes, bloque libre`);
  }

  appendLog(file: string, text: string): void {
    mkdirSync(this.stackDir, { recursive: true });
    writeFileSync(join(this.stackDir, file), text, { flag: 'a' });
  }
}

/** Fichero para `node --env-file`: `CLAVE=valor` por línea. */
function writeEnvFile(path: string, env: Readonly<Record<string, string>>): void {
  writeFileSync(
    path,
    `${Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
  );
}

/** `node <cli de Playwright> test -c <config> --grep <etiquetas del perfil> …` (design D1, D9). */
function playwrightCliArgs(passthrough: readonly string[], tags: readonly string[]): string[] {
  const cli = join(dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
  return [cli, 'test', '-c', PLAYWRIGHT_CONFIG, ...playwrightGrepArgs(passthrough, tags)];
}

function runPlaywright(
  root: string,
  args: readonly string[],
  env: Record<string, string>,
  onSpawn: (child: ChildProcess) => void,
): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [...args], { cwd: root, env, stdio: 'inherit', windowsHide: true });
    onSpawn(child);
    child.once('exit', (exitCode) => resolve(exitCode ?? 1));
    child.once('error', () => resolve(1));
  });
}

/** Flags que solo tienen sentido con la pila que monta `e2e-stack`. */
function stackOnlyFlags(args: RunnerArgs): string[] {
  return [
    ...(args.keepStack ? ['--keep-stack'] : []),
    ...(args.down ? ['--down'] : []),
    ...(args.rehearseRemote ? ['--rehearse-remote'] : []),
    ...(args.skipLocal ? ['--skip-local'] : []),
    ...(args.stackFault === undefined ? [] : ['--stack-fault']),
    ...(Object.keys(args.portOverrides).length > 0 ? ['port overrides (--*-port)'] : []),
  ];
}

/**
 * `web-e2e:e2e-remote` (design D3, D9): el perfil `remote` contra el origen de `--base-url`, sin montar nada. Todo lo
 * que puede fallar antes de Playwright falla en la comprobación previa, **sin ejecutar ninguna prueba** ni enviar las
 * credenciales a ningún sitio. No lee `E2E_BASE_URL`, `E2E_API_ORIGIN` ni `E2E_MATCH_EXPECTATION` de su entorno:
 * solo las credenciales, que son secretos.
 */
async function runRemote(args: RunnerArgs, root: string): Promise<number> {
  const phase: Phase = 'comprobación previa';
  try {
    const misplaced = stackOnlyFlags(args);
    if (misplaced.length > 0) {
      throw new PhaseError(phase, `${misplaced.join(', ')} belong to web-e2e:e2e-stack, not to e2e-remote`);
    }
    if (args.baseUrl === undefined) {
      throw new PhaseError(
        phase,
        'the remote profile has no origin: pass --base-url <origin> (e2e-remote does not read E2E_BASE_URL from its environment)',
      );
    }
    let origins: ReturnType<typeof resolveRemoteOrigins>;
    try {
      origins = resolveRemoteOrigins(args.baseUrl, args.apiOrigin);
    } catch (error) {
      throw new PhaseError(phase, error instanceof Error ? error.message : String(error));
    }
    if (args.matchExpectation === undefined) {
      throw new PhaseError(
        phase,
        'pass --match-expectation replay-report|consent-required: the destination declares the expected match outcome (design D7)',
      );
    }
    const inFiles = findCredentialsInDotEnvFiles(root, [E2E_PROJECT_DIR]);
    if (inFiles.length > 0) {
      throw new PhaseError(
        phase,
        inFiles.map((item) => `${item.key} is in ${item.file}`).join('; ') +
          ': pass the remote credentials in the session environment, not in a .env file (design D3)',
      );
    }
    const missing = REMOTE_CREDENTIAL_KEYS.filter((key) => (process.env[key] ?? '') === '');
    if (missing.length > 0) {
      throw new PhaseError(phase, `${missing.join(' and ')} missing from the session environment (design D3)`);
    }
    const browser = chromium.executablePath();
    if (!existsSync(browser)) {
      throw new PhaseError(
        phase,
        `the Playwright Chromium browser is not installed (${browser}): pnpm exec playwright install chromium`,
      );
    }
    log(
      `comprobación previa: perfil remote, origen ${origins.baseUrl}, API ${origins.apiOrigin}, expectativa ${args.matchExpectation}, credenciales en el entorno de la sesión`,
    );
    const cliArgs = playwrightCliArgs(args.playwrightArgs, REMOTE_TAGS);
    const env: Record<string, string> = {
      ...pickWhitelisted(process.env, SYSTEM_WHITELIST, process.platform),
      E2E_BASE_URL: origins.baseUrl,
      E2E_API_ORIGIN: origins.apiOrigin,
      E2E_PROFILE: 'remote',
      E2E_MATCH_EXPECTATION: args.matchExpectation,
      E2E_REMOTE_EMAIL: process.env['E2E_REMOTE_EMAIL'] ?? '',
      E2E_REMOTE_PASSWORD: process.env['E2E_REMOTE_PASSWORD'] ?? '',
    };
    log(`suite: playwright ${cliArgs.slice(1).join(' ')} (perfil remote)`);
    const code = await runPlaywright(root, cliArgs, env, () => undefined);
    if (code !== 0) {
      throw new PhaseError('suite', `Playwright exited with code ${code}`);
    }
    log('suite: Playwright en verde');
    return 0;
  } catch (error) {
    reportFailure(error);
    return 1;
  }
}

/** `node_modules/nx/<bin>` de este checkout, según el campo `bin` de su `package.json`. */
function nxBinPath(root: string): string {
  const packageDir = join(root, 'node_modules', 'nx');
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { bin?: Record<string, string> };
  const bin = manifest.bin?.['nx'];
  if (bin === undefined) {
    throw new PhaseError('aplicaciones', 'node_modules/nx/package.json does not declare the nx bin');
  }
  return join(packageDir, bin);
}

function describePid(problem: string, processes: readonly ProcessInfo[]): string {
  const match = /PID (\d+)/.exec(problem);
  if (match === null) {
    return '';
  }
  const info = processes.find((item) => item.pid === Number(match[1]));
  return info === undefined ? '' : ` [${info.commandLine}]`;
}

async function waitForFreeBlock(ports: readonly number[], timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const probes = await probePorts(ports);
    if (!probes.some((probe) => probe.busy)) {
      return '';
    }
    if (Date.now() > deadline) {
      return describeBusy(probes);
    }
    await delay(1_000);
  }
}

/** `--down`: apaga una pila que quedó levantada con `--keep-stack`, matando solo los PID que siguen siendo los suyos. */
async function downMode(stack: Stack): Promise<void> {
  const statePath = join(stack.stackDir, STATE_FILE);
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as StackState;
    if (state.projectName !== stack.projectName) {
      log(`--down: el estado guardado es del proyecto ${state.projectName}, no de ${stack.projectName}: no se mata ningún proceso`);
    } else {
      const processes = await listProcesses(stack.toolEnv, stack.root);
      for (const app of state.apps) {
        const current = processes.find((info) => info.pid === app.pid);
        if (current !== undefined && app.commandLine !== '' && current.commandLine === app.commandLine) {
          await killTree(app.pid, stack.toolEnv, stack.root);
          log(`--down: ${app.name} (PID ${app.pid}) terminado`);
        } else {
          log(`--down: ${app.name} (PID ${app.pid}) ya no ejecuta la orden guardada: no se toca`);
        }
      }
    }
    rmSync(statePath);
  }
  const down = await stopInfra(stack.compose);
  if (down.code !== 0) {
    throw new PhaseError('apagado', `docker compose down failed (exit ${down.code})`);
  }
  const busy = await waitForFreeBlock(blockPorts(stack.block), SHUTDOWN_FREE_TIMEOUT_MS);
  if (busy !== '') {
    throw new PhaseError('apagado', `the block is not free after --down:\n  ${busy}`);
  }
  log(`--down: proyecto ${stack.projectName} sin contenedores ni volúmenes y bloque libre`);
}

function downCommand(args: RunnerArgs): string {
  const flags = Object.entries(args.portOverrides).map(([name, port]) => {
    const flag = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    return `--${flag}-port=${port}`;
  });
  return ['pnpm nx run web-e2e:e2e-stack -- --down', ...flags].join(' ');
}

async function main(): Promise<number> {
  let args: RunnerArgs;
  try {
    args = parseRunnerArgs(process.argv.slice(2));
  } catch (error) {
    logError(`FAILED in phase «comprobación previa»: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const root = process.cwd();
  if (args.remoteTarget) {
    return runRemote(args, root);
  }
  let suiteEnv: Record<string, string>;
  let block: PortBlock;
  try {
    suiteEnv = readEnvFile(join(root, ENV_FILE));
    block = resolveBlock(suiteEnv, args.portOverrides);
  } catch (error) {
    logError(`FAILED in phase «comprobación previa»: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const projectName = composeProjectName(root, block);
  log(`proyecto de compose: ${projectName}`);
  log(
    `bloque: web ${block.web}, api ${block.api}, worker ${block.worker}, mongo ${block.mongo}, redis ${block.redis}, ` +
      `S3 ${block.objectStore}/${block.objectStoreConsole}, mailpit ${block.mailpitSmtp}/${block.mailpitUi}, ` +
      `inspector ${block.apiInspector}/${block.workerInspector}`,
  );
  if (args.stackFault !== undefined) {
    log(`--stack-fault=${JSON.stringify(args.stackFault)} ACTIVO: fallo provocado para falsar un guardia`);
  }

  const base = pickWhitelisted(process.env, SYSTEM_WHITELIST, process.platform);
  const control = { NX_LOAD_DOT_ENV_FILES: 'false', NX_DAEMON: 'false', COMPOSE_PROJECT_NAME: projectName };
  const effectiveSuiteEnv = applyBlock(suiteEnv, block);
  const appEnv = { ...base, ...effectiveSuiteEnv, ...control };
  const toolEnv = { ...base, ...control };
  const dockerEnv =
    process.platform === 'win32'
      ? { ...appEnv, ...pickWhitelisted(process.env, DOCKER_WINDOWS_EXTRA, process.platform) }
      : appEnv;
  const compose: ComposeContext = { root, projectName, envFile: ENV_FILE, env: dockerEnv };
  const stack = new Stack(args, block, projectName, effectiveSuiteEnv, appEnv, compose, toolEnv);

  if (args.down) {
    try {
      await downMode(stack);
      return 0;
    } catch (error) {
      reportFailure(error);
      return 1;
    }
  }

  let interrupted = false;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (interrupted) {
      return;
    }
    interrupted = true;
    logError(`${signal}: interrumpido; apagando lo que arrancó esta corrida`);
    stack
      .shutdown()
      .catch((error: unknown) => reportFailure(error))
      .finally(() => process.exit(130));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('SIGHUP', onSignal);

  let failure: unknown;
  try {
    if (args.skipLocal && !args.rehearseRemote) {
      throw new PhaseError('comprobación previa', '--skip-local is only accepted together with --rehearse-remote');
    }
    const rehearsal = args.rehearseRemote ? rehearsalAccount(suiteEnv) : undefined;
    if (args.baseUrl !== undefined || args.apiOrigin !== undefined) {
      throw new PhaseError(
        'comprobación previa',
        '--base-url and --api-origin belong to web-e2e:e2e-remote; e2e-stack serves its own origin',
      );
    }
    await inPhase('comprobación previa', () => stack.preflight());
    await inPhase('comprobación previa', () => stack.startFaultListener());
    rmSync(stack.stackDir, { recursive: true, force: true });
    mkdirSync(stack.stackDir, { recursive: true });
    startRunnerLog(join(stack.stackDir, 'runner.log'));
    await inPhase('infraestructura', () => stack.infrastructure());
    await inPhase('aplicaciones', () => stack.applications());
    if (rehearsal !== undefined) {
      await inPhase('siembra', () => stack.seed(rehearsal));
    }
    await inPhase('suite', () => stack.suite(rehearsal));
  } catch (error) {
    failure = error;
    reportFailure(error);
  }

  if (interrupted) {
    return new Promise<number>(() => undefined);
  }
  if (!stack.started && stack.faultChild === undefined) {
    // Nada arrancado (fallo de la comprobación previa): no hay nada que apagar, y re-probar el bloque solo repetiría
    // el puerto ocupado que ya se ha nombrado.
    return failure === undefined ? 0 : 1;
  }
  const preflightFailure = failure instanceof PhaseError && failure.phase === 'comprobación previa';
  if (args.keepStack && stack.started && !preflightFailure) {
    if (stack.faultChild?.pid !== undefined) {
      await killTree(stack.faultChild.pid, toolEnv, root);
    }
    // Los procesos lanzados siguen vivos cuando el runner termina: se sueltan para que su manejador no lo retenga.
    for (const app of stack.apps) {
      app.child?.unref();
    }
    log(
      keepStackMessage({
        failed: failure !== undefined,
        platform: process.platform,
        underNx: process.env['NX_TASK_TARGET_PROJECT'] !== undefined,
        projectName,
        downCommand: downCommand(args),
        runnerArgs: process.argv.slice(2),
      }),
    );
    return failure === undefined ? 0 : 1;
  }
  try {
    await stack.shutdown();
  } catch (error) {
    reportFailure(error);
    return 1;
  }
  return failure === undefined ? 0 : 1;
}

/** Cuenta del ensayo desde `e2e.env`; sin ella, `--rehearse-remote` falla antes de arrancar nada. */
function rehearsalAccount(suiteEnv: Readonly<Record<string, string>>): SeedAccount {
  const email = suiteEnv[REHEARSAL_EMAIL_KEY] ?? '';
  const password = suiteEnv[REHEARSAL_PASSWORD_KEY] ?? '';
  if (email === '' || password === '') {
    throw new PhaseError(
      'comprobación previa',
      `--rehearse-remote needs ${REHEARSAL_EMAIL_KEY} and ${REHEARSAL_PASSWORD_KEY} in ${ENV_FILE} (design D10)`,
    );
  }
  return { email, password, displayName: REHEARSAL_DISPLAY_NAME };
}

/** Un error inesperado dentro de una fase se informa con el nombre de esa fase. */
async function inPhase(phase: Phase, step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch (error) {
    if (error instanceof PhaseError) {
      throw error;
    }
    throw new PhaseError(phase, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  }
}

function reportFailure(error: unknown): void {
  if (error instanceof PhaseError) {
    logError(`FAILED in phase «${error.phase}»: ${error.message}`);
  } else {
    logError(`FAILED: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    reportFailure(error);
    process.exitCode = 1;
  });
