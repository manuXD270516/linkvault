import { Controller, Get, HttpStatus, Inject, Logger, Param, Res } from '@nestjs/common';
import { PublicRouteLogger } from '../../../infrastructure/logging/public-route-logger';
import { Public } from '../../../presentation/http/auth-context/public.decorator';
import { GetPublicPreview } from '../application/get-public-preview.usecase';
import {
  LINK_LIMITER,
  type LinkLimiter,
} from '../application/ports/link-limiter.port';
import { PUBLIC_URLS, type PublicUrls } from '../application/ports/public-urls.port';
import { isValidPublicSlug } from '../domain/public-slug';
import {
  PUBLIC_PAGE_CACHE_CONTROL,
  PUBLIC_PAGE_CONTENT_TYPE,
  PUBLIC_PAGE_NO_STORE,
  PUBLIC_PAGE_SECURITY_HEADERS,
} from './public-page/public-page.headers';
import {
  publicPageGoneHtml,
  publicPageHtml,
  publicPageTooManyHtml,
} from './public-page/public-page.html';

/**
 * Lo que la página necesita de la respuesta de Fastify. Se declara aquí, como en `EventsController`, en vez de importar
 * `FastifyReply`: `fastify` no es una dependencia directa de `api` y así queda dicho exactamente qué se usa.
 */
export interface HtmlReply {
  status(code: number): HtmlReply;
  header(name: string, value: string): HtmlReply;
  send(payload: string): unknown;
}

/**
 * `GET /p/:slug` (spec links/public-share, D4 de public-preview-share). Se sirve **fuera del prefijo `/api`** y sin
 * sesión: la URL se pega en un chat, así que tiene que ser corta, y `/api/...` es por contrato JSON con sesión.
 *
 * **La misma respuesta para todo el mundo.** No se mira el `User-Agent` ni el `Accept`, y no hay `Vary`. Lo que separa
 * a un bot de una persona es que el navegador ejecuta el `<meta refresh>` y el bot no: una lista de bots caduca —cada
 * bolsa y cada app de mensajería cambian su `User-Agent`— y fallar hacia un lado deja a una persona en una página
 * muerta y hacia el otro deja el enlace sin tarjeta, que es justo lo que este change entrega.
 *
 * **Orden deliberado** (D4 y D8): formato del slug → contadores → lecturas.
 * 1. un slug mal formado responde `404` y **no cuesta ni el contador**: una ráfaga de basura no gasta la ventana de los
 *    enlaces buenos;
 * 2. se consume primero el contador global de la ruta y después el del slug; si el del slug rechaza, se **devuelve** el
 *    intento al global, porque si no un bucle contra un enlace agotado seguiría vaciando el tope de todos los demás;
 * 3. solo entonces se lee, y son las dos lecturas de D7.
 *
 * **Esta ruta nunca responde `application/json`**, tampoco ante un error inesperado, ni en `/p/` ni en `/p/a/b`: el
 * controlador **devuelve** la respuesta con su código en vez de lanzar, así que `ApiExceptionFilter` no interviene, y
 * las formas raras se registran como rutas propias del mismo controlador.
 *
 * Cada petición deja en el log `{ slug, status }` y **nada más**: ni dirección de origen, ni `User-Agent`, ni referente.
 */
@Public()
@Controller()
export class PublicPageController {
  private readonly logger = new Logger(PublicPageController.name);

  constructor(
    private readonly preview: GetPublicPreview,
    @Inject(LINK_LIMITER) private readonly limiter: LinkLimiter,
    @Inject(PUBLIC_URLS) private readonly urls: PublicUrls,
    private readonly log: PublicRouteLogger,
  ) {}

  @Get('p/:slug')
  async page(
    @Param('slug') slug: string,
    @Res() reply: HtmlReply,
  ): Promise<void> {
    try {
      await this.respond(slug, reply);
    } catch (error) {
      // Ni siquiera un error inesperado devuelve JSON: quien pide esta URL es un navegador o un bot que espera HTML.
      this.logger.error(
        `Unhandled ${error instanceof Error ? error.name : typeof error} serving a public page`,
      );
      this.send(reply, HttpStatus.INTERNAL_SERVER_ERROR, publicPageGoneHtml(this.urls), {
        'Cache-Control': PUBLIC_PAGE_NO_STORE,
      });
      this.record('', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** `/p` sin slug: la misma página de error, nunca el `404` JSON de la API. */
  @Get('p')
  missing(@Res() reply: HtmlReply): void {
    this.gone('', reply);
  }

  /**
   * `/p/a/b` y cualquier otra forma con segmentos de más. Aquí el comodín va como `p/*`, la sintaxis del router de
   * Fastify, que es quien registra las rutas de un controlador: con `p/{*splat}` la app no arranca ("Wildcard must be
   * the last character in the route"). El `exclude` del prefijo, que resuelve `path-to-regexp` 8, sí lo escribe
   * `p/{*splat}` (ver `create-app`).
   */
  @Get('p/*')
  extra(@Res() reply: HtmlReply): void {
    this.gone('', reply);
  }

  private async respond(slug: string, reply: HtmlReply): Promise<void> {
    // 1. Formato. No cuesta ni el contador.
    if (!isValidPublicSlug(slug)) {
      this.gone(slug, reply);
      return;
    }
    // 2. Contadores, antes de cualquier lectura. Fallan abiertos.
    const decision = await this.consume(slug);
    if (!decision.allowed) {
      this.send(reply, HttpStatus.TOO_MANY_REQUESTS, publicPageTooManyHtml(this.urls), {
        'Cache-Control': PUBLIC_PAGE_NO_STORE,
        'Retry-After': String(Math.max(1, Math.ceil(decision.retryAfterSeconds))),
      });
      this.record(slug, HttpStatus.TOO_MANY_REQUESTS);
      return;
    }
    // 3. Lecturas: las dos de D7 y ninguna escritura.
    const found = await this.preview.execute(slug);
    if (found === null) {
      this.gone(slug, reply);
      return;
    }
    this.send(reply, HttpStatus.OK, publicPageHtml(found.link, this.pageUrls(slug)), {
      'Cache-Control': PUBLIC_PAGE_CACHE_CONTROL,
    });
    this.record(slug, HttpStatus.OK);
  }

  /**
   * Global primero y por slug después, con `refund` al global si el del slug rechaza: así las peticiones contra un
   * enlace agotado no consumen el tope de los demás enlaces. El orden inverso evitaría el `refund`, pero dejaría el
   * contador global sin ver las peticiones que el del slug rechaza, y un atacante que rotara entre slugs inexistentes
   * no tocaría ningún tope.
   */
  private async consume(
    slug: string,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const global = await this.limiter.consume({ kind: 'public-page' });
    if (!global.allowed) {
      return global;
    }
    const perSlug = await this.limiter.consume({
      kind: 'public-page-slug',
      slug,
    });
    if (!perSlug.allowed) {
      await this.limiter.refund({ kind: 'public-page' });
    }
    return perSlug;
  }

  private gone(slug: string, reply: HtmlReply): void {
    this.send(reply, HttpStatus.NOT_FOUND, publicPageGoneHtml(this.urls), {
      'Cache-Control': PUBLIC_PAGE_NO_STORE,
    });
    this.record(slug, HttpStatus.NOT_FOUND);
  }

  private pageUrls(slug: string) {
    return {
      pageUrl: this.urls.pageUrlOf(slug),
      webUrl: this.urls.webUrlOf(slug),
      webBaseUrl: this.urls.webBaseUrl,
    };
  }

  private send(
    reply: HtmlReply,
    status: number,
    html: string,
    headers: Readonly<Record<string, string>>,
  ): void {
    let response = reply.status(status);
    for (const [name, value] of Object.entries({
      ...PUBLIC_PAGE_SECURITY_HEADERS,
      ...headers,
      'Content-Type': PUBLIC_PAGE_CONTENT_TYPE,
    })) {
      response = response.header(name, value);
    }
    response.send(html);
  }

  /** `{ slug, status }` y nada más: es lo que permite contar páginas servidas y `404` sin guardar un dato de quien visita. */
  private record(slug: string, status: number): void {
    this.log.record('public-page', slug, status);
  }
}
