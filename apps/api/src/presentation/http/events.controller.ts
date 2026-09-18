import type { ServerResponse } from 'node:http';
import { Controller, Get, Res } from '@nestjs/common';
import { EventStreamRegistry } from '../../infrastructure/realtime/event-stream.registry';
import { openSseStream } from '../../infrastructure/realtime/sse-stream';
import type { AuthenticatedUser } from './auth-context/authenticated-user';
import { CurrentUser } from './auth-context/current-user.decorator';

/**
 * `GET /api/events` (spec platform/realtime): el canal por el que el navegador se entera de lo que termina en segundo
 * plano. Lo protege el guard global, que lee `Authorization: Bearer`, así que **no hay ningún token en la URL** y una
 * sesión caducada no consigue reabrirlo: recibe `401` como cualquier otra ruta.
 *
 * Por eso el SPA no usa `EventSource`, que no sabe poner cabeceras, sino `HttpClient` con `observe: 'events'` y
 * `reportProgress: true`, que sí pasa por el interceptor que pone y refresca el access token (D9).
 *
 * La respuesta se escribe a mano sobre el socket (`reply.hijack()`): el flujo no termina, así que no hay nada que
 * `return` pueda devolver, y el latido tiene que ser un comentario SSE y no un mensaje.
 */

/**
 * Lo que el canal necesita de la respuesta de Fastify. Se declara aquí en vez de importar `FastifyReply` porque
 * `fastify` no es una dependencia directa de `api` —llega a través de `@nestjs/platform-fastify`— y porque esto deja
 * dicho exactamente qué se usa: apartar la respuesta del framework y escribir en el socket.
 */
export interface HijackableReply {
  hijack(): void;
  readonly raw: ServerResponse;
}
@Controller('events')
export class EventsController {
  constructor(private readonly registry: EventStreamRegistry) {}

  @Get()
  stream(
    @CurrentUser() user: AuthenticatedUser,
    @Res() reply: HijackableReply,
  ): void {
    reply.hijack();
    const sink = openSseStream(reply.raw);
    const unregister = this.registry.register(user.userId, sink);
    // Cuando el cliente se va —cierra la pestaña, pierde la red— la conexión se da de baja y su temporizador se para.
    reply.raw.on('close', () => {
      unregister();
      sink.close();
    });
  }
}
