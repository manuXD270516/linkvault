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
  OpenAIProvider,
  type OpenAIProviderOptions,
} from './openai.provider';

const API_KEY = 'sk-openai-test-credential-9f8e7d6c5b4a';
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
  overrides: Partial<OpenAIProviderOptions> = {},
): OpenAIProviderOptions {
  return {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: API_KEY,
    model: 'gpt-4o-mini',
    maxContextTokens: 128_000,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe('OpenAIProvider', () => {
  it('declares external jsonMode capabilities and optional byok id', () => {
    const provider = new OpenAIProvider(options({ id: 'byok:ana:openai' }));

    expect(provider.id).toBe('byok:ana:openai');
    expect(provider.capabilities).toMatchObject({
      jsonMode: true,
      external: true,
      maxContextTokens: 128_000,
    });
  });

  it('does not expose the credential when serialized', () => {
    const provider = new OpenAIProvider(options());
    expect(JSON.stringify(provider)).not.toContain(API_KEY);
    expect(inspect(provider, { depth: 5 })).not.toContain(API_KEY);
  });

  it('posts chat completions with Bearer auth and json_object format', async () => {
    const server = await startServer((req, res) => {
      if (req.method === 'POST' && req.url === '/chat/completions') {
        json(res, 200, {
          model: 'gpt-4o-mini',
          choices: [{ message: { content: '{"skills":[]}' } }],
          usage: { prompt_tokens: 20, completion_tokens: 5 },
        });
        return;
      }
      json(res, 404, {});
    });
    const provider = new OpenAIProvider(options({ baseUrl: server.baseUrl }));

    const result = await provider.complete({
      system: SYSTEM_PROMPT,
      user: USER_PROMPT,
      temperature: 0,
      maxTokens: 256,
      responseFormat: 'json',
    });

    expect(result).toEqual({
      text: '{"skills":[]}',
      usage: { inputTokens: 20, outputTokens: 5 },
      model: 'gpt-4o-mini',
      latencyMs: expect.any(Number),
    });
    expect(server.received[0]?.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(server.received[0]?.body).toEqual({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: USER_PROMPT },
      ],
      temperature: 0,
      max_tokens: 256,
      response_format: { type: 'json_object' },
    });
  });

  it('throws ProviderUnavailable without leaking secrets on HTTP errors', async () => {
    const server = await startServer((_req, res) =>
      json(res, 429, { error: { message: `rate ${API_KEY}` } }),
    );
    const provider = new OpenAIProvider(options({ baseUrl: server.baseUrl }));

    const error = await provider
      .complete({ system: SYSTEM_PROMPT, user: USER_PROMPT })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ProviderUnavailable);
    expect((error as ProviderUnavailable).httpStatus).toBe(429);
    expect(inspect(error, { depth: 10 })).not.toContain(API_KEY);
  });
});
