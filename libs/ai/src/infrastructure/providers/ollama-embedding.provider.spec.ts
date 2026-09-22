import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ProviderUnavailable } from '../../domain/errors';
import { OllamaEmbeddingProvider } from './ollama-embedding.provider';

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

describe('OllamaEmbeddingProvider', () => {
  it('declares local embeddings capabilities', () => {
    const provider = new OllamaEmbeddingProvider({
      baseUrl: 'http://localhost:11434',
      model: 'nomic-embed-text',
      dimensions: 768,
    });
    expect(provider.id).toBe('ollama');
    expect(provider.capabilities).toEqual({
      embeddings: true,
      dimensions: 768,
      external: false,
      costPer1kTokens: 0,
    });
  });

  it('POSTs /api/embed and returns vectors', async () => {
    const vector = Array.from({ length: 4 }, (_, i) => i * 0.1);
    const server = await startServer((req, res) => {
      if (req.url === '/api/embed') {
        json(res, 200, {
          model: 'nomic-embed-text',
          embeddings: [vector],
          prompt_eval_count: 12,
        });
        return;
      }
      json(res, 404, {});
    });

    const provider = new OllamaEmbeddingProvider({
      baseUrl: server.baseUrl,
      model: 'nomic-embed-text',
      dimensions: 4,
    });
    const result = await provider.embed({ texts: ['hola mundo'] });
    expect(result.vectors).toEqual([vector]);
    expect(result.model).toBe('nomic-embed-text');
    expect(result.usage.inputTokens).toBe(12);
    expect(server.received[0]).toMatchObject({
      method: 'POST',
      url: '/api/embed',
      body: { model: 'nomic-embed-text', input: ['hola mundo'] },
    });
  });

  it('maps HTTP errors to ProviderUnavailable', async () => {
    const server = await startServer((_req, res) => json(res, 503, {}));
    const provider = new OllamaEmbeddingProvider({
      baseUrl: server.baseUrl,
      model: 'nomic-embed-text',
      dimensions: 4,
    });
    await expect(provider.embed({ texts: ['x'] })).rejects.toBeInstanceOf(
      ProviderUnavailable,
    );
  });
});
