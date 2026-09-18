import { describe, expect, it } from 'vitest';
import {
  openSseStream,
  SSE_HEADERS,
  type HeartbeatTimer,
  type SseResponse,
} from './sse-stream';

// Escritura del flujo `text/event-stream` (tarea 6.8). El temporizador se inyecta: ningún test espera 25 segundos.

class ResponseDouble implements SseResponse {
  status = 0;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  writableEnded = false;
  failOnWrite = false;

  writeHead(statusCode: number, headers: Record<string, string>): void {
    this.status = statusCode;
    this.headers = headers;
  }

  write(chunk: string): boolean {
    if (this.failOnWrite) {
      throw new Error('socket closed');
    }
    this.chunks.push(chunk);
    return true;
  }

  end(): void {
    this.writableEnded = true;
  }

  get body(): string {
    return this.chunks.join('');
  }
}

class ManualTimer implements HeartbeatTimer {
  private tick: (() => void) | undefined;
  intervalMs = 0;
  stopped = false;

  start(tick: () => void, intervalMs: number): void {
    this.tick = tick;
    this.intervalMs = intervalMs;
  }

  stop(): void {
    this.stopped = true;
  }

  /** Hace pasar el intervalo del latido. */
  advance(): void {
    this.tick?.();
  }
}

function open(response: ResponseDouble, timer: ManualTimer) {
  return openSseStream(response, { timer, heartbeatMs: 1000 });
}

describe('openSseStream', () => {
  it('answers 200 with the headers of an event stream', () => {
    const response = new ResponseDouble();
    open(response, new ManualTimer());

    expect(response.status).toBe(200);
    expect(response.headers).toEqual({ ...SSE_HEADERS });
    expect(response.headers['Content-Type']).toBe(
      'text/event-stream; charset=utf-8',
    );
  });

  it('Latido: sends a comment, not a message', () => {
    const response = new ResponseDouble();
    const timer = new ManualTimer();
    open(response, timer);

    timer.advance();

    // Dos latidos: el de apertura y el del intervalo. Ambos son comentarios.
    expect(response.body).toBe(': keep-alive\n\n: keep-alive\n\n');
    expect(response.body).not.toContain('event:');
    expect(response.body).not.toContain('data:');
    expect(timer.intervalMs).toBe(1000);
  });

  it('writes an event with its name and its body', () => {
    const response = new ResponseDouble();
    const sink = open(response, new ManualTimer());
    response.chunks = [];

    expect(sink.send('link.enriched', '{"link":{"id":"7"}}')).toBe(true);
    expect(response.body).toBe(
      'event: link.enriched\ndata: {"link":{"id":"7"}}\n\n',
    );
  });

  it('splits a body with line breaks, which would otherwise end the message halfway', () => {
    const response = new ResponseDouble();
    const sink = open(response, new ManualTimer());
    response.chunks = [];

    sink.send('link.enriched', '{\n  "a": 1\n}');

    expect(response.body).toBe(
      'event: link.enriched\ndata: {\ndata:   "a": 1\ndata: }\n\n',
    );
  });

  it('stops the heartbeat and ends the response when it is closed', () => {
    const response = new ResponseDouble();
    const timer = new ManualTimer();
    const sink = open(response, timer);

    sink.close();

    expect(timer.stopped).toBe(true);
    expect(response.writableEnded).toBe(true);
    expect(sink.send('link.enriched', '{}')).toBe(false);
  });

  it('gives the connection up for lost when writing throws, instead of failing the server', () => {
    const response = new ResponseDouble();
    const sink = open(response, new ManualTimer());
    response.failOnWrite = true;

    expect(sink.send('link.enriched', '{}')).toBe(false);
    expect(sink.heartbeat()).toBe(false);
  });

  it('closes itself when a heartbeat no longer gets through', () => {
    const response = new ResponseDouble();
    const timer = new ManualTimer();
    open(response, timer);
    response.failOnWrite = true;

    timer.advance();

    expect(timer.stopped).toBe(true);
    expect(response.writableEnded).toBe(true);
  });
});
