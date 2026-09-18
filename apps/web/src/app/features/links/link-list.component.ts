import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import type { JobLinkSummary, Platform, PreviewStatus } from '@linkvault/shared';
import { type RequestFailure, toRequestFailure } from '../../core/api/api-error';
import { SessionStore } from '../../core/auth/session.store';
import { LinksStore } from '../../core/links/links.store';
import { confirmWith } from '../../shared/ui/confirm.dialog';
import { RequestError } from '../../shared/ui/request-error';

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
 * Recibe los links ya cargados, así que quien la usa decide cuándo mostrarla y el estado vacío no aparece mientras la
 * página carga. Quitar sí lo resuelve ella: la confirmación y el destino (grupo o lista privada) son los mismos en las
 * dos pantallas y `LinksStore` ya sabe de cuál se trata.
 */
@Component({
  selector: 'lv-link-list',
  imports: [MatButtonModule, RequestError],
  templateUrl: './link-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkList {
  readonly links = input.required<JobLinkSummary[]>();
  readonly scope = input.required<LinkListScope>();
  /** `true` si quien mira es `owner` del grupo: puede quitar también lo que compartieron otros. */
  readonly canModerate = input(false);

  private readonly store = inject(LinksStore);
  private readonly dialog = inject(MatDialog);
  private readonly session = inject(SessionStore);

  protected readonly removing = signal(false);
  protected readonly failure = signal<RequestFailure | null>(null);

  /** Quitar lo ofrece a quien compartió el link y al owner; en la lista privada, todo link propio se puede quitar. */
  protected canRemove(link: JobLinkSummary): boolean {
    if (this.scope() === 'mine') {
      return true;
    }
    const userId = this.session.user()?.id;
    return this.canModerate() || (userId !== undefined && link.sharedBy?.userId === userId);
  }

  /** Solo se borra la relación con este grupo o con esta lista: la vacante sigue en los demás. */
  protected async remove(link: JobLinkSummary): Promise<void> {
    const confirmed = await confirmWith(this.dialog, {
      title: $localize`:@@links.list.removeTitle:Quitar el enlace`,
      message:
        this.scope() === 'mine'
          ? $localize`:@@links.list.removeMessageMine:Se quita de tu lista; la oferta sigue disponible en tus grupos.`
          : $localize`:@@links.list.removeMessageGroup:Se quita de este grupo; la oferta sigue disponible en otros grupos.`,
      confirmLabel: $localize`:@@links.list.removeConfirm:Quitar`,
    });
    if (!confirmed) {
      return;
    }
    this.removing.set(true);
    this.failure.set(null);
    try {
      await this.store.remove(link.id);
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
    } finally {
      this.removing.set(false);
    }
  }

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
