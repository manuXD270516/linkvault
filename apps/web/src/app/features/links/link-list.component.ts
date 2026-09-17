import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { JobLinkSummary, Platform, PreviewStatus } from '@linkvault/shared';

/** De qué lista son los links: la de un grupo o la privada. Solo cambia el texto del estado vacío. */
export type LinkListScope = 'group' | 'mine';

/** Nombre de cada plataforma con canonicalizador propio; son marcas, así que no se traducen. */
const PLATFORM_NAMES: Record<Exclude<Platform, 'generic'>, string> = {
  linkedin: 'LinkedIn',
  computrabajo: 'Computrabajo',
  indeed: 'Indeed',
  trabajopolis: 'Trabajopolis',
  getonboard: 'Get on Board',
};

/** Extensión de fichero al final del último segmento (`.html`, `.aspx`…): ruido para la etiqueta. */
const FILE_EXTENSION = /\.[a-z0-9]{1,5}$/i;

/**
 * Etiqueta legible de un link: el último segmento del path des-slugificado (sin guiones ni extensión) o, si el path no
 * tiene segmentos, el dominio sin `www.`. Se deriva de `displayUrl`, la URL tal como la escribió una persona, porque la
 * normalizada pierde el slug con el puesto y la empresa. Una cadena que no es una URL se muestra tal cual.
 */
export function linkLabel(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  const lastSegment = parsed.pathname.split('/').filter((segment) => segment.length > 0).at(-1);
  if (lastSegment === undefined) {
    return host;
  }
  const label = deslugify(lastSegment);
  return label.length === 0 ? host : label;
}

function deslugify(segment: string): string {
  return decodeSegment(segment)
    .replace(FILE_EXTENSION, '')
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // Un porcentaje suelto no se puede decodificar: se muestra el segmento tal cual.
    return segment;
  }
}

/**
 * Lista de links compartida por el detalle del grupo y por `/mis-links` (D9). Cada fila abre `displayUrl` en una pestaña
 * nueva con `rel="noopener noreferrer"` y muestra su etiqueta, su plataforma, quién la compartió y "Sin vista previa
 * todavía": en este change nadie prepara la vista previa, así que no se promete que esté en camino.
 *
 * Es una lista tonta: recibe lo ya cargado. Quien la usa decide cuándo mostrarla, para que el estado vacío no aparezca
 * mientras la página carga.
 */
@Component({
  selector: 'lv-link-list',
  templateUrl: './link-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkList {
  readonly links = input.required<JobLinkSummary[]>();
  readonly scope = input.required<LinkListScope>();

  protected label(displayUrl: string): string {
    return linkLabel(displayUrl);
  }

  protected platformName(platform: Platform): string {
    return platform === 'generic'
      ? $localize`:@@links.platform.generic:Otra web`
      : PLATFORM_NAMES[platform];
  }

  /** `pending` y `failed` son los estados sin nada que enseñar; el resto ya trae algo de la vacante. */
  protected withoutPreview(previewStatus: PreviewStatus): boolean {
    return previewStatus === 'pending' || previewStatus === 'failed';
  }
}
