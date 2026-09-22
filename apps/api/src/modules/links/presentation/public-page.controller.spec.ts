import {
  apiErrorResponseSchema,
  publicPreviewResponseSchema,
  type GroupDetail,
  type PublicShare,
  type SaveLinkResponse,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createLinksTestApp,
  type LinksTestApp,
  type TestMember,
} from '../../../test-support/links-test-app';

// `GET /p/:slug` y `GET /api/public/previews/:slug` (tareas 6.6, 6.7, 6.10, 6.11 y 6.12 de public-preview-share) sobre
// la app completa con el Mongo del preset.

const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const OTHER_JOB = 'https://www.linkedin.com/jobs/view/3822222222/';
const UNKNOWN_SLUG = 'zzzzzzzzzzzz';
const WHATSAPP_AGENT = 'WhatsApp/2.23.20.0';
const BROWSER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

describe('la página pública', () => {
  let http: LinksTestApp;
  let ana: TestMember;
  let beto: TestMember;
  let carla: TestMember;
  let group: GroupDetail;

  beforeAll(async () => {
    http = await createLinksTestApp('links-public-page', getMongoTestUri());
    ana = await http.authenticated('Ana');
    beto = await http.authenticated('Beto');
    carla = await http.authenticated('Carla');
    group = await http.createGroup(ana, 'Backend Bolivia');
    await http.join(beto, group);
    await http.join(carla, group);
  });

  afterAll(async () => {
    await http.close();
  });

  /** Guarda la URL en el grupo (que comparte en público por defecto) y devuelve la respuesta del alta. */
  async function save(
    member: TestMember,
    url: string,
    groupId = group.id,
  ): Promise<SaveLinkResponse> {
    const response = await http.request('POST', '/api/links', {
      authorization: member.authorization,
      body: { url, groupId },
    });
    expect(response.statusCode).toBe(201);
    return response.json<SaveLinkResponse>();
  }

  /** Comparte la URL y devuelve el enlace público con el que nació. */
  async function published(member: TestMember, url: string): Promise<PublicShare> {
    const saved = await save(member, url);
    const share = saved.link.publicShare;
    if (share === undefined) {
      throw new Error('El grupo comparte en público: el link nace publicado');
    }
    return share;
  }

  function page(slug: string, headers: Record<string, string> = {}) {
    return http.request('GET', `/p/${slug}`, { headers });
  }

  it('Un bot pide la página', async () => {
    const share = await published(ana, JOB_PAGE);

    const response = await page(share.slug, { 'user-agent': WHATSAPP_AGENT });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.body).toContain('<meta property="og:title"');
    expect(response.body).toContain('<meta property="og:description"');
  });

  it('Una persona pide la página', async () => {
    const share = await published(ana, 'https://empresa.example/careers/human');

    const response = await page(share.slug, { 'user-agent': BROWSER_AGENT });

    expect(response.statusCode).toBe(200);
    // El salto al SPA y el enlace visible de respaldo, para quien tenga el `refresh` desactivado.
    expect(response.body).toContain(
      `<meta http-equiv="refresh" content="0; url=http://localhost:4200/oferta/${share.slug}">`,
    );
    expect(response.body).toContain(
      `<a href="http://localhost:4200/oferta/${share.slug}">Ver la oferta en LinkVault</a>`,
    );
  });

  it('El link sale del grupo', async () => {
    const saved = await save(ana, 'https://empresa.example/careers/removed');
    const share = saved.link.publicShare;
    expect(share).toBeDefined();

    const removed = await http.request(
      'DELETE',
      `/api/groups/${group.id}/links/${saved.link.id}`,
      { authorization: ana.authorization },
    );

    expect(removed.statusCode).toBe(204);
    await expect(page(share?.slug ?? '')).resolves.toMatchObject({
      statusCode: 404,
    });
  });

  it('La respuesta no depende de quién pide', async () => {
    const share = await published(ana, OTHER_JOB);

    const bot = await page(share.slug, { 'user-agent': WHATSAPP_AGENT });
    const person = await page(share.slug, {
      'user-agent': BROWSER_AGENT,
      accept: 'text/html,application/xhtml+xml',
    });

    expect(bot.body).toBe(person.body);
    expect(bot.headers['vary']).toBeUndefined();
    expect(person.headers['vary']).toBeUndefined();
    expect(person.body).toContain('<meta http-equiv="refresh" content="0; ');
    expect(person.body).toContain(
      `http://localhost:4200/oferta/${share.slug}`,
    );
  });

  it('Página pública fuera del prefijo, y bajo el prefijo no existe', async () => {
    const share = await published(ana, 'https://empresa.example/careers/fuera');

    const outside = await page(share.slug);
    const inside = await http.request('GET', `/api/p/${share.slug}`);

    expect(outside.statusCode).toBe(200);
    expect(outside.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(inside.statusCode).toBe(404);
    expect(inside.headers['content-type']).toMatch(/^application\/json/);
  });

  it('La página nunca devuelve JSON', async () => {
    const share = await published(ana, 'https://empresa.example/careers/json');

    const responses = await Promise.all([
      page(share.slug),
      page(UNKNOWN_SLUG),
      page('no-es-un-slug'),
      http.request('GET', '/p/'),
      http.request('GET', '/p/a/b'),
    ]);

    for (const response of responses) {
      expect(response.headers['content-type']).not.toMatch(/application\/json/);
      expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    }
    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 404, 404, 404, 404,
    ]);
  });

  it('Enlace que ya no está: los tres casos con el mismo cuerpo', async () => {
    const share = await published(ana, 'https://empresa.example/careers/gone');
    await http.request(
      'DELETE',
      `/api/groups/${group.id}/links/${await linkIdOf(share)}/public`,
      { authorization: ana.authorization },
    );

    const burnt = await page(share.slug);
    const unknown = await page(UNKNOWN_SLUG);
    const malformed = await page('no-es-un-slug');

    for (const response of [burnt, unknown, malformed]) {
      expect(response.statusCode).toBe(404);
      expect(response.body).toContain('Este enlace ya no está disponible');
      expect(response.body).toContain('Pídeselo de nuevo a quien te lo envió');
    }
    expect(burnt.body).toBe(unknown.body);
    expect(unknown.body).toBe(malformed.body);
  });

  it('Cabeceras de seguridad y de caché', async () => {
    const share = await published(ana, 'https://empresa.example/careers/head');

    const ok = await page(share.slug);
    const gone = await page(UNKNOWN_SLUG);

    for (const response of [ok, gone]) {
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      const csp = String(response.headers['content-security-policy']);
      expect(csp).toContain("default-src 'none'");
      expect(csp).not.toContain('script-src');
      expect(csp).not.toContain('img-src');
    }
    expect(ok.headers['cache-control']).toBe('public, max-age=60');
    expect(gone.headers['cache-control']).toBe('no-store');
  });

  it('La página no ejecuta JavaScript', async () => {
    const share = await published(ana, 'https://empresa.example/careers/nojs');

    const response = await page(share.slug);

    expect(response.body).not.toMatch(/<script\b/i);
    expect(response.body).toContain('<meta http-equiv="refresh" content="0; ');
  });

  it('Preview público sin sesión', async () => {
    const share = await published(
      ana,
      'https://empresa.example/careers/preview',
    );

    const response = await http.request(
      'GET',
      `/api/public/previews/${share.slug}`,
    );

    expect(response.statusCode).toBe(200);
    const body = publicPreviewResponseSchema.parse(response.json());
    expect(body.slug).toBe(share.slug);
    expect(body.link.platform).toBe('generic');
    expect(body.link.displayUrl).toBe(
      'https://empresa.example/careers/preview',
    );
  });

  it('Preview público de un enlace quemado', async () => {
    const share = await published(ana, 'https://empresa.example/careers/burnt');
    await http.request(
      'DELETE',
      `/api/groups/${group.id}/links/${await linkIdOf(share)}/public`,
      { authorization: ana.authorization },
    );

    const burnt = await http.request(
      'GET',
      `/api/public/previews/${share.slug}`,
    );
    const malformed = await http.request(
      'GET',
      '/api/public/previews/no-es-un-slug',
    );

    for (const response of [burnt, malformed]) {
      expect(response.statusCode).toBe(404);
      expect(apiErrorResponseSchema.parse(response.json()).code).toBe(
        'link_not_found',
      );
    }
    expect(burnt.body).toBe(malformed.body);
  });

  // "Lo público se limita a su prefijo" (spec auth/sessions): sin `Authorization` responden
  // register/login/refresh/logout, forgot/reset/verify-email, `/api/public/*`, salud y `/p/:slug`.
  // `verify-email/resend` y el resto exigen sesión → 401.
  it('Lo público se limita a su prefijo', async () => {
    const share = await published(ana, 'https://empresa.example/careers/scope');

    const openGets = await Promise.all(
      [
        `/p/${share.slug}`,
        `/api/public/previews/${share.slug}`,
        '/health',
        '/health/live',
      ].map((url) => http.request('GET', url)),
    );
    const openPosts = await Promise.all(
      [
        '/api/auth/forgot-password',
        '/api/auth/reset-password',
        '/api/auth/verify-email',
      ].map((url) =>
        http.request('POST', url, {
          body: {},
          headers: { 'x-requested-with': 'linkvault' },
        }),
      ),
    );
    const guarded = await Promise.all(
      [
        ['GET', '/api/users/me'],
        ['GET', '/api/links/mine'],
        ['GET', '/api/groups'],
        ['GET', `/api/groups/${group.id}`],
        ['GET', `/api/groups/${group.id}/links`],
        ['GET', '/api/applications'],
        ['GET', '/api/events'],
        ['POST', '/api/links'],
        ['POST', '/api/auth/verify-email/resend'],
        ['PUT', `/api/groups/${group.id}/links/x/public`],
        ['DELETE', `/api/groups/${group.id}/links/x/public`],
        ['PATCH', `/api/groups/${group.id}/settings`],
      ].map(([method, url]) =>
        http.request(
          method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
          url ?? '',
          method === 'POST' && url === '/api/auth/verify-email/resend'
            ? {
                body: {},
                headers: { 'x-requested-with': 'linkvault' },
              }
            : undefined,
        ),
      ),
    );

    for (const response of [...openGets, ...openPosts]) {
      expect(response.statusCode).not.toBe(401);
    }
    for (const response of guarded) {
      expect(response.statusCode).toBe(401);
    }
  });

  describe('el interruptor', () => {
    it('Quien compartió publica y su página responde 200', async () => {
      const saved = await save(beto, 'https://empresa.example/careers/switch');
      await http.request(
        'DELETE',
        `/api/groups/${group.id}/links/${saved.link.id}/public`,
        { authorization: beto.authorization },
      );

      const response = await http.request(
        'PUT',
        `/api/groups/${group.id}/links/${saved.link.id}/public`,
        { authorization: beto.authorization },
      );

      expect(response.statusCode).toBe(200);
      const share = response.json<PublicShare>();
      expect(share.url).toBe(`http://localhost:3000/p/${share.slug}`);
      await expect(page(share.slug)).resolves.toMatchObject({
        statusCode: 200,
      });
    });

    it('El propietario publica un link ajeno', async () => {
      const saved = await save(beto, 'https://empresa.example/careers/owner');

      const response = await http.request(
        'PUT',
        `/api/groups/${group.id}/links/${saved.link.id}/public`,
        { authorization: ana.authorization },
      );

      expect(response.statusCode).toBe(200);
    });

    it('Otro miembro no publica ni despublica, esté o no publicado', async () => {
      const saved = await save(beto, 'https://empresa.example/careers/member');

      const publish = await http.request(
        'PUT',
        `/api/groups/${group.id}/links/${saved.link.id}/public`,
        { authorization: carla.authorization },
      );
      const unpublish = await http.request(
        'DELETE',
        `/api/groups/${group.id}/links/${saved.link.id}/public`,
        { authorization: carla.authorization },
      );

      for (const response of [publish, unpublish]) {
        expect(response.statusCode).toBe(403);
        expect(apiErrorResponseSchema.parse(response.json()).code).toBe(
          'forbidden',
        );
      }
      // El enlace con el que nació sigue funcionando.
      await expect(
        page(saved.link.publicShare?.slug ?? ''),
      ).resolves.toMatchObject({ statusCode: 200 });
    });

    it('Publicar dos veces no cambia el enlace', async () => {
      const saved = await save(ana, 'https://empresa.example/careers/twice');

      const first = await http.request(
        'PUT',
        `/api/groups/${group.id}/links/${saved.link.id}/public`,
        { authorization: ana.authorization },
      );
      const second = await http.request(
        'PUT',
        `/api/groups/${group.id}/links/${saved.link.id}/public`,
        { authorization: ana.authorization },
      );

      expect(first.json()).toEqual(second.json());
    });

    it('Despublicar quema el enlace', async () => {
      const share = await published(ana, 'https://empresa.example/careers/off');
      const linkId = await linkIdOf(share);

      const response = await http.request(
        'DELETE',
        `/api/groups/${group.id}/links/${linkId}/public`,
        { authorization: ana.authorization },
      );

      expect(response.statusCode).toBe(204);
      await expect(page(share.slug)).resolves.toMatchObject({
        statusCode: 404,
      });
      const again = await http.request(
        'PUT',
        `/api/groups/${group.id}/links/${linkId}/public`,
        { authorization: ana.authorization },
      );
      expect(again.json<PublicShare>().slug).not.toBe(share.slug);
    });

    it('Despublicar lo que no estaba publicado', async () => {
      const share = await published(
        ana,
        'https://empresa.example/careers/twice-off',
      );
      const linkId = await linkIdOf(share);
      await http.request(
        'DELETE',
        `/api/groups/${group.id}/links/${linkId}/public`,
        { authorization: ana.authorization },
      );

      const response = await http.request(
        'DELETE',
        `/api/groups/${group.id}/links/${linkId}/public`,
        { authorization: ana.authorization },
      );

      expect(response.statusCode).toBe(204);
    });

    it('Extraño no toca el interruptor', async () => {
      const stranger = await http.authenticated('Extraño');
      const saved = await save(
        ana,
        'https://empresa.example/careers/stranger',
      );

      const own = await http.request(
        'PUT',
        `/api/groups/${group.id}/links/${saved.link.id}/public`,
        { authorization: stranger.authorization },
      );
      const malformed = await http.request(
        'PUT',
        `/api/groups/${group.id}/links/no-es-un-id/public`,
        { authorization: stranger.authorization },
      );

      expect(own.statusCode).toBe(404);
      expect(malformed.statusCode).toBe(404);
      expect(own.json()).toEqual(malformed.json());
      expect(apiErrorResponseSchema.parse(own.json()).code).toBe(
        'group_not_found',
      );
    });

    it('Relación que no está en el grupo', async () => {
      const response = await http.request(
        'PUT',
        `/api/groups/${group.id}/links/66e9a00000000000000000ff/public`,
        { authorization: ana.authorization },
      );

      expect(response.statusCode).toBe(404);
      expect(apiErrorResponseSchema.parse(response.json()).code).toBe(
        'link_not_found',
      );
    });
  });

  /** Identificador del link detrás de un enlace público, leyéndolo por el endpoint público. */
  async function linkIdOf(share: PublicShare): Promise<string> {
    const list = await http.request('GET', `/api/groups/${group.id}/links`, {
      authorization: ana.authorization,
    });
    const items = list.json<{ items: { id: string; publicShare?: PublicShare }[] }>()
      .items;
    const found = items.find((item) => item.publicShare?.slug === share.slug);
    if (found === undefined) {
      throw new Error(`No hay ningún link publicado con ${share.slug}`);
    }
    return found.id;
  }
});
