import { type ChildProcess, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { type AppName, parseRunnerArgs, playwrightGrepArgs, type RunnerArgs } from './lib/args';
import { blockPorts, composeProjectName, type PortBlock, resolveBlock } from './lib/block';
import { DOCKER_WINDOWS_EXTRA, pickWhitelisted, readEnvFile, SYSTEM_WHITELIST } from './lib/env';
import { type ComposeContext, composePs, parsePublishedPorts, startInfra, stopInfra } from './lib/infra';
import { isAlive, launchHiddenWindows } from './lib/launch-hidden';
import { evaluateListeners, listListeners } from './lib/listeners';
import { describeBusy, probePorts } from './lib/ports';
import { runCommand } from './lib/proc';
import { isSameCheckoutServe, killTree, listProcesses, type ProcessInfo, processTree } from './lib/processes';

// Runner de la suite end-to-end (change `e2e-suite`, design D3). Se ejecuta con `node --import tsx` desde el target
// `web-e2e:e2e-stack`, con la raíz del repositorio como directorio de trabajo. Salida por `process.stdout`/`stderr`.
//
// Fases: comprobación previa → infraestructura → aplicaciones → (siembra) → suite → apagado. El apagado ocurre
// siempre (`finally` y SIGINT/SIGTERM), salvo con `--keep-stack`, y solo toca lo que esta corrida lanzó.

const PREFIX = '[e2e-stack]';
const SUITE_TAG = '@lot1';
const ENV_FILE = 'apps/web-e2e/e2e.env';
const PLAYWRIGHT_CONFIG = 'apps/web-e2e/playwright.config.mts';
const PROXY_CONFIG = 'apps/web-e2e/proxy.conf.mjs';
const STACK_DIR = 'dist/.playwright/apps/web-e2e/stack-logs';
const STATE_FILE = 'stack-state.json';
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

  private async launch(name: AppName, nxArgs: readonly string[]): Promise<LaunchedApp> {
    const logPath = join(this.stackDir, `${name}.log`);
    const args = [nxBinPath(this.root), ...nxArgs];
    let app: LaunchedApp;
    if (process.platform === 'win32' && this.args.keepStack) {
      // --keep-stack en Windows: fuera del job del runner y sin ventanas (ver launch-hidden.ts).
      const pid = await launchHiddenWindows({
        name,
        executable: process.execPath,
        args,
        env: this.appEnv,
        cwd: this.root,
        logPath,
        workDir: this.stackDir,
      });
      app = { name, child: undefined, pid, logPath, exited: null, logOffset: 0 };
    } else {
      // Linux: grupo de procesos propio (se mata el grupo entero). Windows: libuv mete al hijo en un job que lo mata si
      // el runner muere, que es la red de seguridad que se quiere cuando la pila no se conserva.
      const fd = openSync(logPath, 'w');
      const child = spawn(process.execPath, args, {
        cwd: this.root,
        env: this.appEnv,
        stdio: ['ignore', fd, fd],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
      closeSync(fd);
      if (child.pid === undefined) {
        throw new PhaseError('aplicaciones', `${name} could not be launched`);
      }
      const launched: LaunchedApp = { name, child, pid: child.pid, logPath, exited: null, logOffset: 0 };
      child.once('exit', (code, signal) => this.markExited(launched, `exit ${code ?? signal ?? '?'}`));
      app = launched;
    }
    this.apps.push(app);
    log(`aplicaciones: ${name} lanzado (PID ${app.pid}) → ${STACK_DIR}/${name}.log`);
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
    writeFileSync(
      effectiveEnvFile,
      `${Object.entries(this.suiteEnv)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')}\n`,
    );
    const envFileArg = `--runtimeArgs=--env-file=${effectiveEnvFile}`;

    await this.launch('api', ['run', 'api:serve', '--watch=false', envFileArg, ...inspectArgs(this.block.apiInspector)]);
    await this.waitUntil(phase, `api /health on ${this.block.api}`, () => this.healthUp(this.block.api));
    log(`aplicaciones: api sano en ${this.block.api} (mongo y redis up)`);

    await this.launch('worker', [
      'run',
      'worker:serve',
      '--watch=false',
      envFileArg,
      ...inspectArgs(this.block.workerInspector),
    ]);
    await this.waitUntil(phase, `worker /health on ${this.block.worker}`, () => this.healthUp(this.block.worker));
    log(`aplicaciones: worker sano en ${this.block.worker} (mongo y redis up)`);

    await this.launch('web', ['run', 'web:serve:production', `--port=${this.block.web}`, `--proxyConfig=${PROXY_CONFIG}`]);
    await this.waitUntil(phase, `web document on ${this.block.web}`, () => this.webUp(this.block.web));
    log(`aplicaciones: web sirve el documento con <lv-root en ${this.block.web}`);

    await this.pidGuard(phase, inspect);
    this.throwIfFatal(phase);
    this.writeState(await listProcesses(this.toolEnv, this.root));
  }

  /** Guardia de PID (design D3): cada fila de escucha de cada puerto de aplicación es del árbol lanzado. */
  private async pidGuard(phase: Phase, inspect: boolean): Promise<void> {
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
    log(`aplicaciones: guardia de PID en verde (${rows.length} filas de escucha, todas del árbol lanzado)`);
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

  // --- 5. Suite -------------------------------------------------------------------------------------------------

  async suite(): Promise<void> {
    const phase: Phase = 'suite';
    const cli = join(dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
    const args = [cli, 'test', '-c', PLAYWRIGHT_CONFIG, ...playwrightGrepArgs(this.args.playwrightArgs, SUITE_TAG)];
    const env: Record<string, string> = {
      ...this.appEnv,
      E2E_BASE_URL: `http://localhost:${this.block.web}`,
      E2E_PROFILE: 'local',
      E2E_MATCH_EXPECTATION: this.args.matchExpectation,
    };
    log(`suite: playwright ${args.slice(1).join(' ')} (perfil local, E2E_BASE_URL=${env['E2E_BASE_URL']})`);
    const code = await new Promise<number>((resolve) => {
      const child = spawn(process.execPath, args, { cwd: this.root, env, stdio: 'inherit', windowsHide: true });
      this.playwright = child;
      child.once('exit', (exitCode) => resolve(exitCode ?? 1));
      child.once('error', () => resolve(1));
    });
    this.playwright = undefined;
    this.throwIfFatal(phase);
    if (code !== 0) {
      throw new PhaseError(phase, `Playwright exited with code ${code}`);
    }
    log('suite: Playwright en verde');
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
    if (args.rehearseRemote) {
      throw new PhaseError(
        'comprobación previa',
        '--rehearse-remote: the remote rehearsal (seeding and the remote profile) arrives with tasks 4.1 and 4.5; not available yet',
      );
    }
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
    await inPhase('suite', () => stack.suite());
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
    log(`--keep-stack: la pila sigue levantada (proyecto ${projectName}). Para apagarla: ${downCommand(args)}`);
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
