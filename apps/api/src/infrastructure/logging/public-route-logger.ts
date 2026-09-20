import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

/**
 * Log de las rutas públicas (D4 de public-preview-share). Escribe `{ slug, status }` sobre el logger **raíz** y no
 * sobre el de la petición: el de la petición lleva enganchado el `req` —con la dirección de origen, el `User-Agent` y
 * el referente de quien visita— en **todas** las líneas que se escriban dentro de ella, y de una página pública no se
 * guarda ni un dato de quien la abre.
 *
 * Es lo que permite contar cuántas páginas se sirven y cuántas acaban en `404` sin escribir nada en la base y sin
 * guardar nada de nadie. La línea automática de `pino-http` para estas rutas se apaga aparte, en `buildLoggerParams`.
 */
@Injectable()
export class PublicRouteLogger {
  /** `route` es un literal de la ruta, no un dato de la petición: distingue la página del endpoint del SPA. */
  record(route: 'public-page' | 'public-preview', slug: string, status: number): void {
    PinoLogger.root.info({ slug, status }, route);
  }
}
