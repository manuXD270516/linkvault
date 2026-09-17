import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ProviderUnavailable } from '../../domain/errors';
import { OllamaProvider } from './ollama.provider';

// Requisito "Proveedor Ollama" (specs/ai/provider-routing) y D6 de ai-gateway-core.
// Servidor node:http local en puerto efímero que imita la API de Ollama.

interface ReceivedRequest {
  method: string;
  url: string;
  body: unknown;
}

type Handler = (
  req: ReceivedRequest,
  res: ServerResponse<IncomingMessage>,
) => void;

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
        body: raw === '' ? undefined : (JSON.parse(raw) as unknown),
      };
      received.push(request);
      handler(request, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const local: LocalServer = {
    baseUrl: `http://127.0.0.1:${port}`,
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

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe('OllamaProvider', () => {
  it('declares local, free, JSON-capable capabilities with the configured context', () => {
    const provider = new OllamaProvider({
      baseUrl: 'http://localhost:11434',
      model: 'qwen2.5:7b',
      maxContextTokens: 8192,
    });

    expect(provider.id).toBe('ollama');
    expect(provider.capabilities).toEqual({
      jsonMode: true,
      toolUse: false,
      maxContextTokens: 8192,
      external: false,
      costPer1kIn: 0,
      costPer1kOut: 0,
    });
  });

  it('Completado contra Ollama', async () => {
    const server = await startServer((req, res) => {
      if (req.method === 'POST' && req.url === '/api/chat') {
        setTimeout(
          () =>
            json(res, 200, {
              model: 'qwen2.5:7b',
              message: { role: 'assistant', content: '{"skills":[]}' },
              done: true,
              prompt_eval_count: 42,
              eval_count: 7,
            }),
          15,
        );
        return;
      }
      json(res, 404, {});
    });
    const provider = new OllamaProvider({
      baseUrl: `${server.baseUrl}/`,
      model: 'qwen2.5:7b',
      maxContextTokens: 8192,
    });

    const result = await provider.complete({
      system: 'You classify skills.',
      user: 'TypeScript and NestJS',
      temperature: 0,
      maxTokens: 1024,
      responseFormat: 'json',
    });

    expect(result).toEqual({
      text: '{"skills":[]}',
      usage: { inputTokens: 42, outputTokens: 7 },
      model: 'qwen2.5:7b',
      latencyMs: expect.any(Number),
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(10);

    expect(server.received).toHaveLength(1);
    expect(server.received[0]).toEqual({
      method: 'POST',
      url: '/api/chat',
      body: {
        model: 'qwen2.5:7b',
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: 'You classify skills.' },
          { role: 'user', content: 'TypeScript and NestJS' },
        ],
        options: { temperature: 0, num_ctx: 8192, num_predict: 1024 },
      },
    });
  });

  it('sends num_ctx and omits format when the response is plain text', async () => {
    const server = await startServer((_req, res) =>
      json(res, 200, { model: 'qwen2.5:7b', message: { content: 'hola' } }),
    );
    const provider = new OllamaProvider({
      baseUrl: server.baseUrl,
      model: 'qwen2.5:7b',
      maxContextTokens: 4096,
    });

    const result = await provider.complete({ system: 's', user: 'u' });

    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(server.received[0]?.body).toEqual({
      model: 'qwen2.5:7b',
      stream: false,
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
      ],
      options: { num_ctx: 4096 },
    });
  });

  it('throws ProviderUnavailable with the HTTP status on an error response', async () => {
    const server = await startServer((_req, res) =>
      json(res, 404, { error: 'model "qwen2.5:7b" not found' }),
    );
    const provider = new OllamaProvider({
      baseUrl: server.baseUrl,
      model: 'qwen2.5:7b',
      maxContextTokens: 8192,
    });

    const error = await provider
      .complete({ system: 's', user: 'u' })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ProviderUnavailable);
    expect(error).toMatchObject({ providerId: 'ollama', httpStatus: 404 });
    expect(String(error)).not.toContain('not found');
  });

  it('throws ProviderUnavailable when the response has an unexpected shape', async () => {
    const server = await startServer((_req, res) =>
      json(res, 200, { done: true }),
    );
    const provider = new OllamaProvider({
      baseUrl: server.baseUrl,
      model: 'qwen2.5:7b',
      maxContextTokens: 8192,
    });

    await expect(
      provider.complete({ system: 's', user: 'u' }),
    ).rejects.toBeInstanceOf(ProviderUnavailable);
  });

  it('honours req.signal and rethrows the abort reason', async () => {
    const server = await startServer(() => {
      // Nunca responde.
    });
    const provider = new OllamaProvider({
      baseUrl: server.baseUrl,
      model: 'qwen2.5:7b',
      maxContextTokens: 8192,
    });

    const error = await provider
      .complete({ system: 's', user: 'u', signal: AbortSignal.timeout(30) })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('TimeoutError');
  });

  it('reports healthy when GET /api/version answers', async () => {
    const server = await startServer((req, res) =>
      req.method === 'GET' && req.url === '/api/version'
        ? json(res, 200, { version: '0.5.0' })
        : json(res, 404, {}),
    );
    const provider = new OllamaProvider({
      baseUrl: server.baseUrl,
      model: 'qwen2.5:7b',
      maxContextTokens: 8192,
    });

    await expect(provider.healthy()).resolves.toBe(true);
    expect(server.received.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET /api/version',
    ]);
  });

  it('Ollama no disponible', async () => {
    const server = await startServer((_req, res) => json(res, 200, {}));
    const { baseUrl } = server;
    await servers.splice(servers.indexOf(server), 1)[0]?.close();
    const provider = new OllamaProvider({
      baseUrl,
      model: 'qwen2.5:7b',
      maxContextTokens: 8192,
    });

    await expect(provider.healthy()).resolves.toBe(false);
  });
});
