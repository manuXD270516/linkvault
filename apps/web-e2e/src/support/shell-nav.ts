import {
  expect,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test';
import {
  capabilitiesResponseSchema,
  type CapabilitiesResponse,
} from '@linkvault/shared';

/**
 * Ancho (px) desde el cual la barra del SPA es la ancha, con las entradas en la fila; por debajo, una fila con la marca
 * y el botón «Menú». Cambia junto con `SHELL_COMPACT_QUERY` de `apps/web/src/app/layout/shell/shell-breakpoint.ts`: son
 * el mismo umbral visto desde el SPA y desde Playwright (design D8 de web-shell-capabilities, tarea 3.6).
 */
export const SHELL_WIDE_MIN_WIDTH_PX = 1024;

/** `true` si el SPA muestra la barra compacta en el viewport de esta página: se decide por el ancho, no por «Menú». */
export function isShellCompact(page: Page): boolean {
  const size = page.viewportSize();
  if (size === null) {
    throw new Error('shell-nav: the page has no viewport size');
  }
  return size.width < SHELL_WIDE_MIN_WIDTH_PX;
}

/**
 * Espera la respuesta de `GET /api/capabilities`. Se arma **antes** de la acción que lleva al Shell (entrar o crear la
 * cuenta), porque es entonces cuando el Shell pide las capacidades. Nunca `page.request.get`: el access token vive en la
 * memoria del SPA (ADR-012) y una petición aparte de Playwright no lo lleva.
 */
export function armCapabilitiesResponse(page: Page): Promise<Response> {
  const response = page.waitForResponse(
    (candidate) =>
      candidate.url().endsWith('/api/capabilities') &&
      candidate.request().method() === 'GET' &&
      candidate.status() === 200,
  );
  // Si nadie la espera todavía (se consume en el paso 5), un rechazo por plazo no debe ser un error sin atender.
  response.catch(() => undefined);
  return response;
}

/** Botón «Menú» de la barra compacta. */
function menuButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Menú', exact: true });
}

/**
 * Lugar donde buscar las entradas de la barra: en compacto, el `<nav>` «Navegación principal» con el panel abierto
 * (lee `aria-expanded` y pulsa «Menú» **solo si es `false`**: pulsarlo con el panel abierto lo cerraría); en ancho, la
 * barra.
 */
async function shellEntries(page: Page): Promise<Locator> {
  if (!isShellCompact(page)) {
    return page.locator('mat-toolbar');
  }
  const button = menuButton(page);
  if ((await button.getAttribute('aria-expanded')) === 'false') {
    await button.click();
  }
  const nav = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(nav).toBeVisible();
  return nav;
}

/** Navega por la barra del SPA a una entrada, en el modo (ancho o compacto) que corresponde al viewport. */
export async function navigateByShell(page: Page, name: string): Promise<void> {
  const entries = await shellEntries(page);
  await entries.getByRole('link', { name, exact: true }).click();
}

/**
 * Espera `data-capabilities="ready"` en la barra y devuelve lo que el destino declaró en su respuesta. Mientras carga,
 * «Buscar» y «Descubrir» tampoco están, así que afirmar su ausencia sin esta espera pasaría sin haber recibido nada.
 */
export async function readShellCapabilities(
  page: Page,
  response: Promise<Response>,
): Promise<CapabilitiesResponse> {
  const declared = capabilitiesResponseSchema.parse(
    await (await response).json(),
  );
  await expect(page.locator('mat-toolbar')).toHaveAttribute(
    'data-capabilities',
    'ready',
  );
  return declared;
}

/** Afirma que «Buscar» y «Descubrir» están en la barra (o en el panel) si y solo si su capacidad es `true`. */
export async function expectShellOptionalEntries(
  page: Page,
  declared: CapabilitiesResponse,
): Promise<void> {
  const entries = await shellEntries(page);
  const expected: ReadonlyArray<readonly [string, boolean]> = [
    ['Buscar', declared.search],
    ['Descubrir', declared.discovery],
  ];
  for (const [name, visible] of expected) {
    const link = entries.getByRole('link', { name, exact: true });
    if (visible) {
      await expect(
        link,
        `"${name}" is in the shell because the target declares it`,
      ).toBeVisible();
    } else {
      await expect(
        link,
        `"${name}" is not in the shell because the target does not declare it`,
      ).toHaveCount(0);
    }
  }
}
