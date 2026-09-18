import type { EventStreamSink } from './event-stream.registry';

// Escritura de un flujo `text/event-stream` sobre la respuesta cruda (D9 de link-enrichment). Se escribe a mano y no con
// `@Sse()` de Nest por una razón concreta: el latido tiene que ser un **comentario** SSE (una línea que empieza por
// `:`), no un evento con nombre, para que el cliente lo descarte con una sola comprobación y ningún parser lo confunda
// con un mensaje. `@Sse()` solo sabe serializar mensajes.
//
// `Cache-Control: no-transform` y `X-Accel-Buffering: no` son para los intermediarios: sin ellos, un proxy puede
// acumular el cuerpo y la pantalla no se entera de nada hasta que se cierra el flujo.

/** Cada cuánto se envía un latido. Por debajo del minuto de inactividad con el que cortan muchos intermediarios. */
export const SSE_HEARTBEAT_INTERVAL_MS = 25_000;

export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

/** Lo que el flujo necesita de la respuesta cruda; `ServerResponse` de Node lo cumple. */
export interface SseResponse {
  writeHead(statusCode: number, headers: Record<string, string>): unknown;
  write(chunk: string): boolean;
  end(): unknown;
  readonly writableEnded: boolean;
}

/** Temporizador del latido, inyectable para que los tests no esperen 25 segundos de verdad. */
export interface HeartbeatTimer {
  start(tick: () => void, intervalMs: number): void;
  stop(): void;
}

/** Temporizador real: `setInterval` sin retener el proceso, para que apagar no espere al siguiente latido. */
export class IntervalHeartbeatTimer implements HeartbeatTimer {
  private handle: NodeJS.Timeout | undefined;

  start(tick: () => void, intervalMs: number): void {
    this.handle = setInterval(tick, intervalMs);
    this.handle.unref?.();
  }

  stop(): void {
    if (this.handle !== undefined) {
      clearInterval(this.handle);
      this.handle = undefined;
    }
  }
}

/**
 * Abre el flujo: escribe la cabecera, manda un primer latido para que el cliente sepa que está dentro y programa los
 * siguientes. El `data` de un evento se parte por líneas porque el formato lo exige: un salto de línea sin `data:`
 * delante terminaría el mensaje a la mitad.
 */
export function openSseStream(
  response: SseResponse,
  options: {
    heartbeatMs?: number;
    timer?: HeartbeatTimer;
  } = {},
): EventStreamSink {
  const timer = options.timer ?? new IntervalHeartbeatTimer();
  response.writeHead(200, { ...SSE_HEADERS });

  const write = (chunk: string): boolean => {
    if (response.writableEnded) {
      return false;
    }
    try {
      response.write(chunk);
      return true;
    } catch {
      // Un cliente que se fue en mitad de la escritura no es un error del servidor: la conexión se da por perdida.
      return false;
    }
  };

  const sink: EventStreamSink = {
    send(event, data) {
      const lines = data.split('\n').map((line) => `data: ${line}`);
      return write(`event: ${event}\n${lines.join('\n')}\n\n`);
    },
    heartbeat() {
      return write(': keep-alive\n\n');
    },
    close() {
      timer.stop();
      if (!response.writableEnded) {
        response.end();
      }
    },
  };

  sink.heartbeat();
  timer.start(() => {
    if (!sink.heartbeat()) {
      sink.close();
    }
  }, options.heartbeatMs ?? SSE_HEARTBEAT_INTERVAL_MS);
  return sink;
}
