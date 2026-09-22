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
  AnthropicProvider,
  type AnthropicProviderOptions,
} from './anthropic.provider';

const API_KEY = 'sk-ant-test-credential-9f8e7d6c5b4a';
const SYSTEM_PROMPT = 'You classify professional skills.';
const USER_PROMPT = 'Candidate: TypeScript and NestJS';

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

function options(
  overrides: Partial<AnthropicProviderOptions> = {},
): AnthropicProviderOptions {
  return {
    baseUrl: 'https://api.anthropic.com',
    apiKey: API_KEY,
    model: 'claude-sonnet-4-20250514',
    maxContextTokens: 200_000,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe('AnthropicProvider', () => {
  it('declares external jsonMode capabilities and optional byok id', () => {
    const provider = new AnthropicProvider(
      options({ id: 'byok:ana:anthropic' }),
    );

    expect(provider.id).toBe('byok:ana:anthropic');
    expect(provider.capabilities).toMatchObject({
      jsonMode: true,
      external: true,
      maxContextTokens: 200_000,
    });
  });

  it('does not expose the credential when serialized', () => {
    const provider = new AnthropicProvider(options());
    expect(JSON.stringify(provider)).not.toContain(API_KEY);
    expect(inspect(provider, { depth: 5 })).not.toContain(API_KEY);
  });

  it('posts to /v1/messages with x-api-key and returns text', async () => {
    const server = await startServer((req, res) => {
      if (req.method === 'POST' && req.url === '/v1/messages') {
        json(res, 200, {
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: '{"skills":[]}' }],
          usage: { input_tokens: 40, output_tokens: 8 },
        });
        return;
      }
      json(res, 404, {});
    });
    const provider = new AnthropicProvider(
      options({ baseUrl: server.baseUrl }),
    );

    const result = await provider.complete({
      system: SYSTEM_PROMPT,
      user: USER_PROMPT,
      temperature: 0,
      maxTokens: 512,
      responseFormat: 'json',
    });

    expect(result).toEqual({
      text: '{"skills":[]}',
      usage: { inputTokens: 40, outputTokens: 8 },
      model: 'claude-sonnet-4-20250514',
      latencyMs: expect.any(Number),
    });
    expect(server.received[0]?.headers['x-api-key']).toBe(API_KEY);
    expect(server.received[0]?.headers['anthropic-version']).toBe('2023-06-01');
    expect(server.received[0]?.body).toMatchObject({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: USER_PROMPT }],
      temperature: 0,
    });
  });

  it('throws ProviderUnavailable without leaking the body or key on HTTP errors', async () => {
    const server = await startServer((_req, res) =>
      json(res, 401, { error: { message: `bad key ${API_KEY}` } }),
    );
    const provider = new AnthropicProvider(
      options({ baseUrl: server.baseUrl }),
    );

    const error = await provider
      .complete({ system: SYSTEM_PROMPT, user: USER_PROMPT })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ProviderUnavailable);
    expect(inspect(error, { depth: 10 })).not.toContain(API_KEY);
  });
});
