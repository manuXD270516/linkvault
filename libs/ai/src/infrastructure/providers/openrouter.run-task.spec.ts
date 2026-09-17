import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiiRedactor } from '../../application/pii-redactor';
import { RunTask } from '../../application/run-task.usecase';
import {
  InMemoryAiLogger,
  InMemoryQuotaPolicy,
  InMemoryResultCache,
  InMemoryUsageLedger,
  ManualClock,
} from '../../application/testing/in-memory-ports';
import type {
  CompletionRequest,
  CompletionResult,
  LlmProvider,
  ProviderCapabilities,
} from '../../domain/ports/llm-provider.port';
import type { RunContext } from '../../domain/run-context';
import { classifySkillsTask } from '../../tasks/classify-skills.task';
import { FilePromptRegistry } from '../prompt-registry/file-prompt-registry';
import { InMemoryCircuitBreaker } from '../resilience/in-memory-circuit-breaker';
import { OpenRouterProvider } from './openrouter.provider';

// Grupo 11 de ai-gateway-core, "Protección de datos de punta a punta" (specs/ai/data-protection, D6 y D11):
// runTask real + classify-skills (personal) + OpenRouterProvider real contra un servidor node:http local.

const PROMPTS_DIR = join(import.meta.dirname, '../prompts');
const API_KEY = 'sk-or-v1-e2e-credential-0a1b2c3d4e5f';
const EMAIL = 'ana.perez@example.com';
const PHONE = '+591 71234567';
const PERSONAL_TEXT = `Ana Pérez · ${EMAIL} · ${PHONE} · Backend con TypeScript y NestJS`;
const CONSENT: RunContext = { aiConsent: { externalProviders: true } };

interface LocalServer {
  baseUrl: string;
  /** Cuerpos crudos recibidos, tal como llegaron por la red. */
  bodies: string[];
}

type Reply = (
  rawBody: string,
  res: ServerResponse,
  authorization: string,
) => void;

const openServers: Server[] = [];

async function startServer(reply: Reply): Promise<LocalServer> {
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      bodies.push(raw);
      reply(raw, res, req.headers.authorization ?? '');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  openServers.push(server);
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}/api/v1`, bodies };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

/**
 * Contenido del mensaje `user` del cuerpo recibido. Se aísla porque el `system` de classify-skills v1 menciona los
 * marcadores `[EMAIL_1]` y `[PHONE_1]` de forma literal: buscarlos en el cuerpo entero no probaría la redacción.
 */
function userMessageOf(rawBody: string | undefined): string {
  const body = JSON.parse(rawBody ?? '{}') as {
    messages?: { role: string; content: string }[];
  };
  const user = body.messages?.find((message) => message.role === 'user');
  if (user === undefined) throw new Error('request without a user message');
  return user.content;
}

function completion(res: ServerResponse, content: string): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 420, completion_tokens: 38 },
    }),
  );
}

/**
 * Delegado de test que deja pasar todo al proveedor real y guarda los errores que lanza, para inspeccionar su
 * mensaje, pila y `cause` aunque `runTask` los convierta en `provider_error`.
 */
class ErrorCapturingProvider implements LlmProvider {
  readonly errors: unknown[] = [];

  constructor(private readonly inner: LlmProvider) {}

  get id(): string {
    return this.inner.id;
  }

  get capabilities(): ProviderCapabilities {
    return this.inner.capabilities;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    try {
      return await this.inner.complete(req);
    } catch (error) {
      this.errors.push(error);
      throw error;
    }
  }

  healthy(): Promise<boolean> {
    return this.inner.healthy();
  }
}

function openRouterRunTask(baseUrl: string) {
  const clock = new ManualClock();
  const logger = new InMemoryAiLogger();
  const ledger = new InMemoryUsageLedger();
  const cache = new InMemoryResultCache();
  const provider = new ErrorCapturingProvider(
    new OpenRouterProvider({
      baseUrl,
      apiKey: API_KEY,
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      maxContextTokens: 32_000,
      referer: 'https://linkvault.test',
      title: 'LinkVault',
    }),
  );
  const runTask = new RunTask({
    providers: [provider],
    prompts: new FilePromptRegistry({ promptsDir: PROMPTS_DIR }),
    cache,
    ledger,
    quota: new InMemoryQuotaPolicy(),
    breaker: new InMemoryCircuitBreaker(clock),
    clock,
    logger,
    providerTimeoutsMs: { openrouter: 5_000 },
  });
  return { runTask, logger, ledger, cache, provider };
}

/** El modelo devuelve el marcador del email como si fuera un dato de la salida. */
const MARKED_OUTPUT = JSON.stringify({
  skills: [
    { name: 'TypeScript', category: 'language' },
    { name: 'NestJS', category: 'framework' },
    { name: '[EMAIL_1]', category: 'other' },
  ],
});

describe('data protection end to end with OpenRouter', () => {
  it('Proveedor externo: sends markers instead of personal data and reinjects them in the output', async () => {
    const server = await startServer((_raw, res) =>
      completion(res, MARKED_OUTPUT),
    );
    const { runTask } = openRouterRunTask(server.baseUrl);

    const result = await runTask.execute(
      classifySkillsTask,
      { text: PERSONAL_TEXT },
      CONSENT,
    );

    expect(server.bodies).toHaveLength(1);
    const body = userMessageOf(server.bodies[0]);
    expect(body).toContain('[EMAIL_1]');
    expect(body).toContain('[PHONE_1]');
    // Ni en el mensaje de usuario ni en ninguna otra parte del cuerpo que viaja por la red.
    expect(server.bodies[0]).not.toContain(EMAIL);
    expect(server.bodies[0]).not.toContain('71234567');
    expect(result).toEqual({
      status: 'success',
      output: {
        skills: [
          { name: 'TypeScript', category: 'language' },
          { name: 'NestJS', category: 'framework' },
          { name: EMAIL, category: 'other' },
        ],
      },
      providerId: 'openrouter',
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      promptVersion: 'v1',
      cached: false,
    });
  });

  it('control: with the redactor neutralised the same assertions would fail', async () => {
    // Contraprueba sin código de producción: se sustituye la redacción por la identidad solo en este test.
    vi.spyOn(PiiRedactor.prototype, 'redact').mockImplementation(
      (input: unknown) => ({
        value: input,
        reinject: <O>(output: O): O => output,
      }),
    );
    const server = await startServer((_raw, res) =>
      completion(res, MARKED_OUTPUT),
    );
    const { runTask } = openRouterRunTask(server.baseUrl);

    const result = await runTask.execute(
      classifySkillsTask,
      { text: PERSONAL_TEXT },
      CONSENT,
    );

    const body = userMessageOf(server.bodies[0]);
    expect(body).toContain(EMAIL);
    expect(body).not.toContain('[EMAIL_1]');
    expect(JSON.stringify(result)).toContain('[EMAIL_1]');
  });
});

describe('no secrets or prompts in logs, errors, results or ledger', () => {
  /** Respuesta de error que repite el cuerpo recibido (con el prompt) y la cabecera de autorización. */
  function echoingError(status: number): Reply {
    return (raw, res, authorization) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: `ECHOED-BODY rejected request ${raw} sent with ${authorization}`,
          },
        }),
      );
    };
  }

  it.each([401, 404, 429, 500, 200])(
    'Log de una petición a OpenRouter (HTTP %i con un cuerpo que repite prompt y credencial)',
    async (status) => {
      const server = await startServer(echoingError(status));
      const { runTask, logger, ledger, provider } = openRouterRunTask(
        server.baseUrl,
      );

      const result = await runTask.execute(
        classifySkillsTask,
        { text: PERSONAL_TEXT },
        CONSENT,
      );

      expect(result).toEqual({
        status: 'degraded',
        reason: 'providers_failed',
      });
      // El logger en memoria captura todos los niveles, incluido debug; hubo al menos el aviso del proveedor.
      expect(logger.warnings.map((w) => w.fields)).toContainEqual(
        expect.objectContaining({
          providerId: 'openrouter',
          httpStatus: status === 200 ? undefined : status,
        }),
      );
      expect(provider.errors).toHaveLength(1);

      const sentUserPrompt = userMessageOf(server.bodies[0]);
      const sentSystemPrompt = 'Eres un analista técnico de perfiles';
      const observable = [
        JSON.stringify(logger.entries),
        JSON.stringify(result),
        JSON.stringify(ledger.records),
        ...provider.errors.flatMap((error) => [
          error instanceof Error
            ? `${error.message}\n${error.stack ?? ''}`
            : '',
          inspect(error, { depth: 10, showHidden: true }),
          JSON.stringify(error),
        ]),
      ];
      for (const text of observable) {
        expect(text).not.toContain(API_KEY);
        expect(text).not.toContain('ECHOED-BODY');
        expect(text).not.toContain(sentUserPrompt);
        expect(text).not.toContain(sentSystemPrompt);
        expect(text).not.toContain('TypeScript y NestJS');
      }
    },
  );
});
