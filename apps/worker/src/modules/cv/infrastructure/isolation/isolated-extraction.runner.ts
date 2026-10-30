import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Readable } from 'node:stream';
import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { buildChildCommand, type CvFileFormat } from './child-command';
import { parseFrame } from './child-protocol';
import { CvExtractionMachineryError } from './cv-extraction-machinery.error';
import {
  PrometheusCvExtractionMetrics,
  type CvExtractionCombination,
  type CvExtractionMetrics,
} from './cv-extraction.metrics';
import {
  CV_CHANNEL_MAX_BYTES,
  CV_CHILD_BOOT_TIMEOUT_MS,
  CV_MEMORY_CEILING_BYTES,
  CV_MEMORY_SAMPLE_MS,
} from './extraction-limits';

// Núcleo de la lectura aislada (D1, D2, D5, D6 y D7 de cv-extract-isolation): **un proceso hijo nuevo por CV**.
//
// - `ready` es la frontera: lo que pasa antes es maquinaria (lanza, la cola reintenta); lo que pasa después es del
//   archivo (`unreadable`, terminal).
// - El plazo de contenido corre **desde `ready`**; vencido, `SIGKILL`, que detiene también un bucle síncrono.
// - El hijo se mata **siempre** y la lectura se resuelve **después** de su `exit`: nunca queda un hijo vivo.
// - El canal es el descriptor 3, un pipe propio. El padre acumula `Buffer`, cuenta bytes, decodifica solo líneas
//   completas y parsea a la defensiva (D6, N4): una línea inválida es un desenlace, nunca una excepción.
// - Nada del hijo se registra: ni su salida (descartada), ni sus mensajes, ni el `ZodError`.

/** Causas de contenido que el runner devuelve (lista cerrada de D9, sin las de maquinaria). */
export type UnreadableCause =
  | 'parse_error'
  | 'password'
  | 'timeout'
  | 'heap_limit'
  | 'memory_ceiling'
  | 'child_exit'
  | 'input_budget'
  | 'protocol';

export type RunnerOutcome =
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly pagesCapped: boolean;
      readonly rawCapped: boolean;
    }
  | { readonly kind: 'unreadable'; readonly cause: UnreadableCause };

export interface RunnerLogger {
  warn(message: string): void;
  error(message: string): void;
}

export interface IsolatedExtractionRunnerOptions {
  /** Ruta del script del hijo. */
  readonly scriptPath: string;
  /** Rutas de lectura permitidas al hijo (la lista fijada en D1). */
  readonly allowRead: readonly string[];
  /** Plazo de contenido, contado desde `ready`. */
  readonly contentTimeoutMs: number;
  readonly bootTimeoutMs?: number;
  readonly memoryCeilingBytes?: number;
  readonly memorySampleMs?: number;
  /** Heap inyectable en tests. */
  readonly maxOldSpaceMb?: number;
  /** Lector de la memoria residente de un proceso; `null` si no se puede. Inyectable. */
  readonly readResidentBytes?: (pid: number) => number | null;
  readonly logger?: RunnerLogger;
  readonly metrics?: CvExtractionMetrics;
}

/** Tras perder el canal, lo que se espera al `exit` del hijo antes de darlo por perdido. */
const CHANNEL_LOSS_GRACE_MS = 500;

/** Todos los hijos vivos de este proceso, para el `afterEach` de los tests (N6). */
const LIVE_CHILDREN = new Set<ChildProcess>();

/** Mata con `SIGKILL` todo hijo vivo de este proceso y dice cuántos eran. Lo usa el `afterEach` de aislamiento. */
export function killLiveChildren(): number {
  const alive = [...LIVE_CHILDREN];
  for (const child of alive) {
    child.kill('SIGKILL');
  }
  return alive.length;
}

/**
 * Memoria residente de un proceso a partir de `/proc/<pid>/status` (`VmRSS`, en kB). No depende del tamaño de página
 * del sistema, a diferencia de `statm`. `null` donde no hay `/proc` (Windows, macOS).
 */
export function readResidentBytesFromProc(pid: number): number | null {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
    return match?.[1] === undefined ? null : Number(match[1]) * 1024;
  } catch {
    return null;
  }
}

type Settlement =
  | RunnerOutcome
  | {
      readonly kind: 'machinery';
      readonly cause: 'boot_error' | 'boot_timeout' | 'protocol';
      readonly code?: string;
    };

export class IsolatedExtractionRunner implements OnApplicationShutdown {
  private readonly logger: RunnerLogger;
  private readonly metrics: CvExtractionMetrics;
  private readonly readResident: (pid: number) => number | null;
  private readonly watchdogEnabled: boolean;
  private readonly ownChildren = new Set<ChildProcess>();
  private activeWatchdogs = 0;

  constructor(private readonly options: IsolatedExtractionRunnerOptions) {
    this.logger = options.logger ?? new Logger(IsolatedExtractionRunner.name);
    this.metrics = options.metrics ?? new PrometheusCvExtractionMetrics();
    this.readResident = options.readResidentBytes ?? readResidentBytesFromProc;
    this.watchdogEnabled = this.probeResidentReader();
    if (!this.watchdogEnabled) {
      // Un solo aviso al arrancar: el heap acotado y los plazos siguen; solo falta el vigía de memoria externa.
      this.logger.warn(
        'cv extraction memory watchdog disabled: no process memory reader on this platform',
      );
    }
  }

  /** Vigías con su intervalo activo ahora mismo; 0 tras cada lectura (test de fugas). */
  get watchdogCount(): number {
    return this.activeWatchdogs;
  }

  /** Lee un CV en un hijo nuevo. Lanza `CvExtractionMachineryError` solo por fallos de maquinaria (antes de `ready`). */
  run(format: CvFileFormat, bytes: Uint8Array): Promise<RunnerOutcome> {
    const startedAt = Date.now();
    return new Promise<RunnerOutcome>((resolve, reject) => {
      this.session(format, bytes, (settlement) => {
        this.report(
          format,
          settlement,
          Date.now() - startedAt,
          bytes.byteLength,
        );
        if (settlement.kind === 'machinery') {
          reject(
            new CvExtractionMachineryError(settlement.cause, settlement.code),
          );
          return;
        }
        resolve(settlement);
      });
    });
  }

  onApplicationShutdown(): void {
    for (const child of [...this.ownChildren]) {
      child.kill('SIGKILL');
    }
  }

  private probeResidentReader(): boolean {
    try {
      return this.readResident(process.pid) !== null;
    } catch {
      return false;
    }
  }

  private session(
    format: CvFileFormat,
    bytes: Uint8Array,
    done: (settlement: Settlement) => void,
  ): void {
    const command = buildChildCommand({
      script: this.options.scriptPath,
      allowRead: this.options.allowRead,
      format,
      ...(this.options.maxOldSpaceMb !== undefined
        ? { maxOldSpaceMb: this.options.maxOldSpaceMb }
        : {}),
    });
    let child: ChildProcess;
    try {
      child = spawn(command.command, command.args, command.options);
    } catch {
      done({ kind: 'machinery', cause: 'boot_error' });
      return;
    }

    let phase: 'booting' | 'running' | 'settled' = 'booting';
    let exited = false;
    let settlement: Settlement | undefined;
    let baseline: number | null = null;
    let bootTimer: NodeJS.Timeout | undefined;
    let contentTimer: NodeJS.Timeout | undefined;
    let watchdog: NodeJS.Timeout | undefined;
    let lossTimer: NodeJS.Timeout | undefined;
    const channel = child.stdio[3] as Readable | null;

    LIVE_CHILDREN.add(child);
    this.ownChildren.add(child);

    const clearTimers = (): void => {
      if (bootTimer !== undefined) {
        clearTimeout(bootTimer);
        bootTimer = undefined;
      }
      if (contentTimer !== undefined) {
        clearTimeout(contentTimer);
        contentTimer = undefined;
      }
      if (lossTimer !== undefined) {
        clearTimeout(lossTimer);
        lossTimer = undefined;
      }
      if (watchdog !== undefined) {
        clearInterval(watchdog);
        watchdog = undefined;
        this.activeWatchdogs -= 1;
      }
    };

    const deliver = (): void => {
      if (settlement !== undefined && exited) {
        const final = settlement;
        settlement = undefined;
        done(final);
      }
    };

    /** Resuelve una sola vez: el primero que llega gana, los demás se ignoran. */
    const settle = (outcome: Settlement): void => {
      if (phase === 'settled') {
        return;
      }
      phase = 'settled';
      settlement = outcome;
      clearTimers();
      if (!exited) {
        child.kill('SIGKILL');
      }
      // Se resuelve **después** del `exit`: nunca queda un hijo vivo al volver.
      deliver();
    };

    /** El proceso, el pipe o la salida del hijo dicen que no habrá resultado. */
    const noResult = (signal?: string | null, code?: number | null): void => {
      if (phase === 'booting') {
        settle({ kind: 'machinery', cause: 'boot_error' });
      } else if (signal === 'SIGABRT' || code === 134) {
        settle({ kind: 'unreadable', cause: 'heap_limit' });
      } else {
        settle({ kind: 'unreadable', cause: 'child_exit' });
      }
    };

    /**
     * El pipe o `stdin` dicen que el hijo ya no está al otro lado. Casi siempre es su muerte, y es el `exit` (con su
     * señal o su código) el que clasifica: un aborto por heap cierra el canal antes de que llegue. Si el proceso sigue
     * vivo tras la gracia, se da por perdido.
     */
    const channelLost = (): void => {
      if (phase === 'settled' || lossTimer !== undefined) {
        return;
      }
      lossTimer = setTimeout(() => {
        noResult();
      }, CHANNEL_LOSS_GRACE_MS);
    };

    const isSettled = (): boolean => phase === 'settled';

    const violation = (): void => {
      if (phase === 'booting') {
        settle({ kind: 'machinery', cause: 'protocol' });
      } else {
        settle({ kind: 'unreadable', cause: 'protocol' });
      }
    };

    const onReady = (): void => {
      if (bootTimer !== undefined) {
        clearTimeout(bootTimer);
        bootTimer = undefined;
      }
      phase = 'running';
      contentTimer = setTimeout(() => {
        settle({ kind: 'unreadable', cause: 'timeout' });
      }, this.options.contentTimeoutMs);
      if (this.watchdogEnabled && child.pid !== undefined) {
        const pid = child.pid;
        baseline = this.safeResident(pid);
        if (baseline !== null) {
          const ceiling =
            this.options.memoryCeilingBytes ?? CV_MEMORY_CEILING_BYTES;
          this.activeWatchdogs += 1;
          watchdog = setInterval(() => {
            const rss = this.safeResident(pid);
            if (rss !== null && baseline !== null && rss - baseline > ceiling) {
              settle({ kind: 'unreadable', cause: 'memory_ceiling' });
            }
          }, this.options.memorySampleMs ?? CV_MEMORY_SAMPLE_MS);
        }
      }
      // Solo tras `ready` recibe el hijo los bytes del archivo.
      child.stdin?.end(Buffer.from(bytes));
    };

    const onLine = (line: string): void => {
      const parsed = parseFrame(line);
      if (!parsed.ok) {
        violation();
        return;
      }
      const message = parsed.message;
      if (phase === 'booting') {
        if (message.type === 'ready') {
          onReady();
        } else if (message.type === 'boot_error') {
          settle({
            kind: 'machinery',
            cause: 'boot_error',
            code: message.code,
          });
        } else {
          violation();
        }
        return;
      }
      // Tras `ready` solo caben un `text` o un `failed`; un segundo `ready` o un `boot_error` es `protocol` (N5).
      if (message.type === 'text') {
        settle({
          kind: 'text',
          text: message.text,
          pagesCapped: message.pagesCapped,
          rawCapped: message.rawCapped,
        });
      } else if (message.type === 'failed') {
        settle({ kind: 'unreadable', cause: message.cause });
      } else {
        violation();
      }
    };

    // Oyentes explícitos (H3): ninguno lanza fuera del runner y cada uno solo resuelve la primera vez.
    child.once('error', () => {
      if (child.pid === undefined) {
        // No llegó a existir: no habrá `exit`.
        exited = true;
        LIVE_CHILDREN.delete(child);
        this.ownChildren.delete(child);
      }
      noResult();
    });
    child.stdin?.on('error', () => {
      channelLost();
    });
    child.on('exit', (code, signal) => {
      exited = true;
      LIVE_CHILDREN.delete(child);
      this.ownChildren.delete(child);
      if (phase === 'settled') {
        deliver();
      }
      // Si nadie ha resuelto aún, se espera al `close` para no perder un resultado que sigue en el pipe.
      child.once('close', () => {
        noResult(signal, code);
      });
    });

    if (channel === null) {
      noResult();
    } else {
      const pending: Buffer[] = [];
      let total = 0;
      channel.on('data', (chunk: Buffer) => {
        if (phase === 'settled') {
          return;
        }
        total += chunk.length;
        if (total > CV_CHANNEL_MAX_BYTES) {
          violation();
          return;
        }
        let start = 0;
        for (;;) {
          const end = chunk.indexOf(0x0a, start);
          if (end === -1) {
            break;
          }
          pending.push(chunk.subarray(start, end));
          const line = Buffer.concat(pending).toString('utf8');
          pending.length = 0;
          onLine(line);
          if (isSettled()) {
            return;
          }
          start = end + 1;
        }
        if (start < chunk.length) {
          pending.push(chunk.subarray(start));
        }
      });
      channel.on('error', () => {
        channelLost();
      });
      channel.on('close', () => {
        // El hijo cerró el canal sin resultado.
        channelLost();
      });
    }

    bootTimer = setTimeout(() => {
      settle({ kind: 'machinery', cause: 'boot_timeout' });
    }, this.options.bootTimeoutMs ?? CV_CHILD_BOOT_TIMEOUT_MS);
  }

  private safeResident(pid: number): number | null {
    try {
      return this.readResident(pid);
    } catch {
      return null;
    }
  }

  /** Una línea `warn` por lectura que no termina en texto y una `error` por fallo de maquinaria; nada del CV. */
  private report(
    format: CvFileFormat,
    settlement: Settlement,
    durationMs: number,
    sizeBytes: number,
  ): void {
    const facts = `format=${format} durationMs=${durationMs} bytes=${sizeBytes}`;
    let combination: CvExtractionCombination;
    if (settlement.kind === 'text') {
      combination = {
        outcome: 'text',
        cause: settlement.rawCapped
          ? 'raw_text_capped'
          : settlement.pagesCapped
            ? 'pages_capped'
            : 'none',
      };
    } else if (settlement.kind === 'unreadable') {
      combination = { outcome: 'unreadable', cause: settlement.cause };
      this.logger.warn(
        `cv extraction unreadable cause=${settlement.cause} ${facts}`,
      );
    } else {
      combination = { outcome: 'machinery_error', cause: settlement.cause };
      const code =
        settlement.code === undefined ? '' : ` code=${settlement.code}`;
      this.logger.error(
        `cv extraction machinery failure cause=${settlement.cause}${code} ${facts}`,
      );
    }
    try {
      this.metrics.record(format, combination);
    } catch {
      // Un contador roto no puede romper la lectura.
    }
  }
}
