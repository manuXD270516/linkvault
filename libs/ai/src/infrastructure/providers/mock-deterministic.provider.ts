import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  FixtureMissing,
  InvalidFixture,
  MockMisuse,
  SynthUnsupported,
} from '../../domain/errors';
import type {
  CompletionRequest,
  CompletionResult,
  CompletionTrace,
  LlmProvider,
  ProviderCapabilities,
} from '../../domain/ports/llm-provider.port';
import { MOCK_PROVIDER_ID } from '../../domain/provider-ids';
import type { Rng } from '../../domain/task';
import type { TaskRegistry } from '../../application/task-registry';

// Proveedor mock determinista (D5 de ai-gateway-core, ADR-018 §3 y §4). Localiza la ejecución por `req.trace`, nunca
// por el texto del prompt. `replay`: fixture o `FixtureMissing`. `synth`: fixture si existe; si no, `task.sample` con
// mulberry32 sembrado con la clave. `synth` en producción lo impide la configuración (D12).

/** Modelo que se informa en las salidas sintetizadas. */
export const MOCK_SYNTH_MODEL = 'mock-synth';

export type MockMode = 'replay' | 'synth';

export interface MockDeterministicProviderOptions {
  mode: MockMode;
  /** `AI_FIXTURES_DIR`: contiene `<taskName>/<key>.json`. */
  fixturesDir: string;
  /** Obligatorio en `synth`: de él sale `task.sample`. */
  tasks?: Pick<TaskRegistry, 'get'>;
}

// `MockMisuse` e `InvalidFixture` viven en domain/errors.ts (marca `AiProgrammingError` que runTask propaga); se
// reexportan aquí para quien los importa junto al proveedor.
export { InvalidFixture, MockMisuse } from '../../domain/errors';

const fixtureSchema = z.object({
  source: z.string().min(1),
  text: z.string(),
  model: z.string().min(1),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
});

export type MockFixture = z.infer<typeof fixtureSchema>;

const TASK_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const KEY_PATTERN = /^[0-9a-f]{64}$/;

/** PRNG mulberry32: determinista, en [0, 1). */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semilla: los 32 primeros bits de la clave hexadecimal. */
export function seedFromKey(key: string): number {
  return Number.parseInt(key.slice(0, 8), 16) >>> 0;
}

export class MockDeterministicProvider implements LlmProvider {
  readonly id = MOCK_PROVIDER_ID;
  readonly capabilities: ProviderCapabilities = {
    jsonMode: true,
    toolUse: false,
    maxContextTokens: 1_000_000,
    external: false,
    costPer1kIn: 0,
    costPer1kOut: 0,
  };

  constructor(private readonly options: MockDeterministicProviderOptions) {
    if (options.mode === 'synth' && options.tasks === undefined) {
      throw new MockMisuse(
        'Mock provider in synth mode requires a task registry',
      );
    }
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    req.signal?.throwIfAborted();
    const trace = this.traceOf(req);

    const fixture = await this.readFixture(trace);
    if (fixture !== null) {
      return {
        text: fixture.text,
        usage: fixture.usage,
        model: fixture.model,
        latencyMs: 0,
      };
    }
    if (this.options.mode === 'replay') throw new FixtureMissing(trace.key);

    return {
      text: this.synthesize(trace),
      usage: { inputTokens: 0, outputTokens: 0 },
      model: MOCK_SYNTH_MODEL,
      latencyMs: 0,
    };
  }

  healthy(): Promise<boolean> {
    return Promise.resolve(true);
  }

  private traceOf(req: CompletionRequest): CompletionTrace {
    const { trace } = req;
    if (trace === undefined) {
      throw new MockMisuse(
        'Mock provider requires CompletionRequest.trace (taskName, promptVersion, key); runTask must pass it',
      );
    }
    // La clave y el nombre forman la ruta del fixture: nada fuera del directorio.
    if (!TASK_NAME_PATTERN.test(trace.taskName)) {
      throw new MockMisuse(`Invalid task name in trace: "${trace.taskName}"`);
    }
    if (!KEY_PATTERN.test(trace.key)) {
      throw new MockMisuse(
        'Invalid execution key in trace: expected sha256 hex',
      );
    }
    return trace;
  }

  private async readFixture(
    trace: CompletionTrace,
  ): Promise<MockFixture | null> {
    const path = join(
      this.options.fixturesDir,
      trace.taskName,
      `${trace.key}.json`,
    );
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new InvalidFixture(trace.taskName, trace.key);
    }
    const parsed = fixtureSchema.safeParse(data);
    if (!parsed.success) throw new InvalidFixture(trace.taskName, trace.key);
    return parsed.data;
  }

  private synthesize(trace: CompletionTrace): string {
    const task = this.options.tasks?.get(trace.taskName);
    if (task === undefined) {
      throw new MockMisuse(
        `Mock provider in synth mode found no registered task "${trace.taskName}"`,
      );
    }
    if (task.sample === undefined) throw new SynthUnsupported(task.name);
    if (!('input' in trace)) {
      throw new MockMisuse(
        'Mock provider in synth mode requires CompletionRequest.trace.input; runTask must pass the parsed input',
      );
    }
    const output = task.sample(trace.input, mulberry32(seedFromKey(trace.key)));
    return JSON.stringify(output);
  }
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}
