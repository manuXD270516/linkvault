import type { APIRequestContext, APIResponse } from '@playwright/test';

/** Lo único que el cliente necesita de un esquema de `@linkvault/shared`: validar el cuerpo. */
export interface BodySchema<T> {
  parse(body: unknown): T;
}

/**
 * Cliente de la API **pública** para los guardias y la limpieza de la cuenta remota (design D9, D10). Solo habla con el
 * origen de la API del perfil (`Profile.apiOrigin`, que en `remote` se deriva siempre del de la aplicación): las
 * credenciales no viajan a ningún otro sitio. El access token es el que devolvió el login de la interfaz en el paso 0;
 * nunca se escribe en un mensaje ni en un log.
 */
export class SuiteApi {
  private readonly base: URL;

  constructor(
    private readonly request: APIRequestContext,
    apiOrigin: string,
    private readonly accessToken: string,
  ) {
    this.base = new URL(apiOrigin.endsWith('/') ? apiOrigin : `${apiOrigin}/`);
  }

  /** URL de `path` bajo el origen de la API; una ruta que se saliera de él (`..`, absoluta) lanza. */
  private url(path: string): string {
    const url = new URL(path, this.base);
    if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname)) {
      throw new Error(`SuiteApi: ${path} is outside the API origin ${this.base.href}`);
    }
    return url.href;
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.accessToken}`, 'x-requested-with': 'linkvault' };
  }

  async get<T>(path: string, schema: BodySchema<T>): Promise<T> {
    const response = await this.request.get(this.url(path), { headers: this.headers() });
    await expectStatus(response, 'GET', path, [200]);
    return schema.parse(await response.json());
  }

  /** `DELETE`; `200` (el de CV devuelve la lista) y `204` valen. */
  async delete(path: string): Promise<void> {
    const response = await this.request.delete(this.url(path), { headers: this.headers() });
    await expectStatus(response, 'DELETE', path, [200, 204]);
  }
}

async function expectStatus(response: APIResponse, method: string, path: string, ok: readonly number[]): Promise<void> {
  if (ok.includes(response.status())) {
    return;
  }
  const body = (await response.text()).slice(0, 300);
  throw new Error(`${method} /api/${path} answered ${response.status()}, expected ${ok.join(' or ')}: ${body}`);
}
