import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { inspect } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { ProviderUnavailable } from '../../domain/errors';
import {
  OpenRouterProvider,
  type OpenRouterProviderOptions,
} from './openrouter.provider';

// Requisito "Proveedor OpenRouter" (specs/ai/provider-routing), "Sin persistencia de prompts ni registro de secretos"
// (specs/ai/data-protection) y D6 de ai-gateway-core. Servidor node:http local en puerto efímero.

const API_KEY = 'sk-or-v1-test-credential-9f8e7d6c5b4a';
const SYSTEM_PROMPT = 'You classify professional skills.';
const USER_PROMPT =
  'Candidate text: TypeScript, NestJS and ana.perez@example.com';

interface ReceivedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

type Handler = (req: ReceivedRequest, res: ServerResponse) => void;

interface LocalServer {
  baseUrl: string;
  received: ReceivedRequest[];
  close(): Promise<void>;
}

const servers: LocalServer[] = [];

async function startServer(handler: Handler): Promise<LocalServer> {
  const received: ReceivedRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const request: ReceivedRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: raw === '' ? undefined : (JSON.parse(raw) as unknown),
      };
      received.push(request);
      handler(request, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const local: LocalServer = {
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  servers.push(local);
  return local;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function options(
  overrides: Partial<OpenRouterProviderOptions> = {},
): OpenRouterProviderOptions {
  return {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: API_KEY,
    model: 'cohere/north-mini-code:free',
    maxContextTokens: 32_000,
    referer: 'https://linkvault.local',
    title: 'LinkVault',
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe('OpenRouterProvider', () => {
  it('declares external, free, JSON-capable capabilities with the configured context', () => {
    const provider = new OpenRouterProvider(options());

    expect(provider.id).toBe('openrouter');
    expect(provider.capabilities).toEqual({
      jsonMode: true,
      toolUse: false,
      maxContextTokens: 32_000,
      external: true,
      costPer1kIn: 0,
      costPer1kOut: 0,
    });
  });

  it('does not expose the credential when the provider itself is serialized', () => {
    const provider = new OpenRouterProvider(options());

    expect(JSON.stringify(provider)).not.toContain(API_KEY);
    expect(inspect(provider, { depth: 5 })).not.toContain(API_KEY);
  });

  it('Completado contra OpenRouter', async () => {
    const server = await startServer((req, res) => {
      if (req.method === 'POST' && req.url === '/api/v1/chat/completions') {
        setTimeout(
          () =>
            json(res, 200, {
              id: 'gen-1',
              model: 'cohere/north-mini-code:free',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: '{"skills":[]}' },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 120,
                completion_tokens: 9,
                total_tokens: 129,
              },
            }),
          15,
        );
        return;
      }
      json(res, 404, {});
    });
    const provider = new OpenRouterProvider(
      options({ baseUrl: `${server.baseUrl}/` }),
    );

    const result = await provider.complete({
      system: SYSTEM_PROMPT,
      user: USER_PROMPT,
      temperature: 0,
      maxTokens: 1024,
      responseFormat: 'json',
    });

    expect(result).toEqual({
      text: '{"skills":[]}',
      usage: { inputTokens: 120, outputTokens: 9 },
      model: 'cohere/north-mini-code:free',
      latencyMs: expect.any(Number),
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(10);

    expect(server.received).toHaveLength(1);
    const [request] = server.received;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('/api/v1/chat/completions');
    expect(request?.body).toEqual({
      model: 'cohere/north-mini-code:free',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: USER_PROMPT },
      ],
      temperature: 0,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
      provider: { data_collection: 'deny' },
    });
    expect(request?.headers).toMatchObject({
      authorization: `Bearer ${API_KEY}`,
      'content-type': 'application/json',
      'http-referer': 'https://linkvault.local',
      'x-title': 'LinkVault',
    });
    expect(JSON.stringify(request?.body)).not.toContain(API_KEY);
  });

  it('omits response_format for text but still denies data collection', async () => {
    const server = await startServer((_req, res) =>
      json(res, 200, { choices: [{ message: { content: 'hola' } }] }),
    );
    const provider = new OpenRouterProvider(
      options({ baseUrl: server.baseUrl }),
    );

    const result = await provider.complete({ system: 's', user: 'u' });

    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(result.model).toBe('cohere/north-mini-code:free');
    expect(server.received[0]?.body).toEqual({
      model: 'cohere/north-mini-code:free',
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
      ],
      provider: { data_collection: 'deny' },
    });
  });

  it('plataforma always denies data collection by default', async () => {
    const server = await startServer((_req, res) =>
      json(res, 200, { choices: [{ message: { content: '{}' } }] }),
    );
    const provider = new OpenRouterProvider(
      options({ baseUrl: server.baseUrl }),
    );

    await provider.complete({ system: 's', user: 'u', responseFormat: 'json' });

    expect(provider.id).toBe('openrouter');
    expect(server.received[0]?.body).toMatchObject({
      provider: { data_collection: 'deny' },
    });
  });

  it('BYOK free model keeps deny when dataCollection is deny', async () => {
    const server = await startServer((_req, res) =>
      json(res, 200, { choices: [{ message: { content: '{}' } }] }),
    );
    const provider = new OpenRouterProvider(
      options({
        baseUrl: server.baseUrl,
        id: 'byok:ana:openrouter',
        model: 'cohere/north-mini-code:free',
        dataCollection: 'deny',
      }),
    );

    await provider.complete({ system: 's', user: 'u' });

    expect(provider.id).toBe('byok:ana:openrouter');
    expect(server.received[0]?.body).toMatchObject({
      model: 'cohere/north-mini-code:free',
      provider: { data_collection: 'deny' },
    });
  });

  it('BYOK paid model omits data_collection when dataCollection is omit', async () => {
    const server = await startServer((_req, res) =>
      json(res, 200, { choices: [{ message: { content: '{}' } }] }),
    );
    const provider = new OpenRouterProvider(
      options({
        baseUrl: server.baseUrl,
        id: 'byok:ana:openrouter',
        model: 'anthropic/claude-sonnet-4',
        dataCollection: 'omit',
      }),
    );

    await provider.complete({ system: 's', user: 'u' });

    const body = server.received[0]?.body as Record<string, unknown>;
    expect(body['model']).toBe('anthropic/claude-sonnet-4');
    expect(body).not.toHaveProperty('provider');
  });

  it('Error de la API', async () => {
    const server = await startServer((req, res) =>
      json(res, 400, {
        error: {
          code: 400,
          message: `Bad request for prompt: ${USER_PROMPT}`,
          metadata: {
            echo: req.body,
            authorization: req.headers.authorization,
          },
        },
      }),
    );
    const provider = new OpenRouterProvider(
      options({ baseUrl: server.baseUrl }),
    );

    const error = await provider
      .complete({
        system: SYSTEM_PROMPT,
        user: USER_PROMPT,
        responseFormat: 'json',
      })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ProviderUnavailable);
    expect(error).toMatchObject({ providerId: 'openrouter', httpStatus: 400 });
    const err = error as ProviderUnavailable;
    expect(err.cause).toBeUndefined();

    const serialized = [
      String(err),
      err.message,
      err.stack ?? '',
      JSON.stringify(err),
      JSON.stringify(err.cause) ?? '',
      inspect(err, { depth: 10 }),
    ];
    for (const text of serialized) {
      expect(text).not.toContain(API_KEY);
      expect(text).not.toContain(USER_PROMPT);
      expect(text).not.toContain(SYSTEM_PROMPT);
      expect(text).not.toContain('Bad request for prompt');
    }
  });

  it('throws ProviderUnavailable without the body when a 200 response carries an error instead of choices', async () => {
    const server = await startServer((_req, res) =>
      json(res, 200, { error: { message: `upstream failed: ${USER_PROMPT}` } }),
    );
    const provider = new OpenRouterProvider(
      options({ baseUrl: server.baseUrl }),
    );

    const error = await provider
      .complete({ system: SYSTEM_PROMPT, user: USER_PROMPT })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ProviderUnavailable);
    expect(inspect(error, { depth: 10 })).not.toContain(USER_PROMPT);
  });

  it('throws ProviderUnavailable without the body when the response is not JSON', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(`not json ${USER_PROMPT}`);
    });
    const provider = new OpenRouterProvider(
      options({ baseUrl: server.baseUrl }),
    );

    const error = await provider
      .complete({ system: SYSTEM_PROMPT, user: USER_PROMPT })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ProviderUnavailable);
    expect((error as ProviderUnavailable).cause).toBeUndefined();
    expect(inspect(error, { depth: 10 })).not.toContain(USER_PROMPT);
  });

  it('throws ProviderUnavailable without credential or cause when the network fails', async () => {
    const server = await startServer((_req, res) => json(res, 200, {}));
    const { baseUrl } = server;
    await servers.splice(servers.indexOf(server), 1)[0]?.close();
    const provider = new OpenRouterProvider(options({ baseUrl }));

    const error = await provider
      .complete({ system: SYSTEM_PROMPT, user: USER_PROMPT })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ProviderUnavailable);
    expect((error as ProviderUnavailable).httpStatus).toBeUndefined();
    expect((error as ProviderUnavailable).cause).toBeUndefined();
    expect(inspect(error, { depth: 10 })).not.toContain(API_KEY);
  });

  it('honours req.signal and rethrows the abort reason', async () => {
    const server = await startServer(() => {
      // Nunca responde.
    });
    const provider = new OpenRouterProvider(
      options({ baseUrl: server.baseUrl }),
    );

    const error = await provider
      .complete({ system: 's', user: 'u', signal: AbortSignal.timeout(30) })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('TimeoutError');
  });

  it('reports health from GET /models without sending the credential', async () => {
    const server = await startServer((req, res) =>
      req.method === 'GET' && req.url === '/api/v1/models'
        ? json(res, 200, { data: [] })
        : json(res, 404, {}),
    );
    const provider = new OpenRouterProvider(
      options({ baseUrl: server.baseUrl }),
    );

    await expect(provider.healthy()).resolves.toBe(true);
    expect(server.received[0]?.headers.authorization).toBeUndefined();

    await server.close();
    servers.splice(servers.indexOf(server), 1);
    await expect(provider.healthy()).resolves.toBe(false);
  });
});
