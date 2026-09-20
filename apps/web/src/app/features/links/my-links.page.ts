import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import { hasApiErrorCode } from '../../core/api/api-error';
import { EventsChannel } from '../../core/events/events.channel';
import { LinksStore } from '../../core/links/links.store';
import { importSlug } from '../../core/public/import-slug';
import { PublicPreviewApi } from '../../core/public/public-preview.api';
import { RequestError } from '../../shared/ui/request-error';
import { ImportLinksDialog } from './import-links.dialog';
import { LinkList } from './link-list.component';
import { SaveLinkForm } from './save-link.form';

/**
 * En qué acabó la importación de una oferta pública (D9):
 * - `running`: se está leyendo o guardando;
 * - `saved` / `already`: la oferta está en la lista privada, recién guardada o de antes;
 * - `gone`: el enlace público ya no existe; no hay nada a lo que volver, así que no se ofrece reintentar;
 * - `unreadable`: el preview no se pudo leer por un `429`, un `5xx` o un fallo de red, y se puede reintentar;
 * - `saveFailed`: el preview se leyó pero el guardado falló, y se puede reintentar sin volver al enlace público.
 */
export type ImportOutcome =
  | 'running'
  | 'saved'
  | 'already'
  | 'gone'
  | 'unreadable'
  | 'saveFailed';

/**
 * Lista privada (`/mis-links`): lo que el usuario guardó sin grupo, con las mismas acciones que dentro de un grupo
 * (guardar, importar, abrir y quitar). La lista solo se pinta una vez cargada, para que el estado vacío no aparezca
 * mientras se pide la primera página.
 *
 * Con `?import=<slug>` importa además la oferta de un enlace público (D9 de public-preview-share): pide su preview una
 * sola vez por navegación y la guarda **sin grupo**, porque quien llega desde un chat no tiene contexto de grupo y
 * meter una oferta ajena en un grupo sin preguntar la volvería a compartir con gente que no la pidió.
 */
@Component({
  selector: 'lv-my-links-page',
  imports: [LinkList, MatButtonModule, RequestError, SaveLinkForm],
  templateUrl: './my-links.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyLinksPage {
  private readonly store = inject(LinksStore);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly publicPreviews = inject(PublicPreviewApi);

  protected readonly links = this.store.items;
  protected readonly loaded = this.store.loaded;
  protected readonly loadingMore = this.store.loadingMore;
  protected readonly hasMore = this.store.hasMore;
  protected readonly failure = this.store.failure;
  /** `true` solo con la lista privada abierta: guardar e importar nunca pueden ir al grupo que se miraba antes. */
  protected readonly scopeReady = computed(() => this.store.scope()?.kind === 'mine');

  /** El `slug` con el que se llegó, si tiene forma de slug; cualquier otra cosa se ignora y no se importa nada. */
  private readonly slug = importSlug(this.route.snapshot.queryParamMap.get('import'));
  protected readonly importOutcome = signal<ImportOutcome | null>(null);
  /** Grupos propios donde la oferta ya estaba, para decirlo en cuáles. */
  protected readonly importGroups = signal<string | null>(null);
  /** La URL que devolvió el preview: es lo que se guarda, y lo que deja reintentar el guardado sin releer nada. */
  private importUrl: string | null = null;

  constructor() {
    // El canal deja que las tarjetas se enteren solas de las lecturas que terminan; si no se puede abrir, la lista
    // sigue funcionando con lo que devolvió la API.
    inject(EventsChannel).connect();
    void this.enter();
  }

  /** Abre la lista privada y, solo después, importa la oferta pública: guardar necesita el ámbito ya abierto. */
  private async enter(): Promise<void> {
    await this.store.open({ kind: 'mine' });
    if (this.slug !== null) {
      await this.importPublicLink();
    }
  }

  /**
   * Lee el preview público y guarda la oferta. Tres desenlaces (critic I3): con `200` se guarda y el parámetro
   * desaparece; con `404` se dice que el enlace ya no está, sin reintento y sin parámetro; con `429`, `5xx` o un fallo
   * de red se ofrece reintentar y el parámetro **se conserva**, para que recargar vuelva a intentarlo: si se borrara,
   * recargar perdería la oferta, que es justo lo que no puede pasar cuando la culpa es nuestra.
   */
  protected async importPublicLink(): Promise<void> {
    const slug = this.slug;
    if (slug === null || this.importOutcome() === 'running') {
      return;
    }
    this.importOutcome.set('running');
    this.importGroups.set(null);
    let link;
    try {
      link = (await this.publicPreviews.preview(slug)).link;
    } catch (error: unknown) {
      if (hasApiErrorCode(error, 404, 'link_not_found')) {
        this.clearImportParam();
        this.importOutcome.set('gone');
      } else {
        this.importOutcome.set('unreadable');
      }
      return;
    }
    // El intento llegó a la API, así que el parámetro ya no hace falta: recargar no vuelve a guardar la oferta.
    this.clearImportParam();
    // Sin URL publicable no hay nada que guardar ni nada que reintentar: se trata como un enlace que ya no está.
    if (link.displayUrl === undefined) {
      this.importOutcome.set('gone');
      return;
    }
    this.importUrl = link.displayUrl;
    await this.saveImported();
  }

  /** Guarda la oferta ya leída en la lista privada, sin grupo. Se puede reintentar sin volver al enlace público. */
  protected async saveImported(): Promise<void> {
    const url = this.importUrl;
    if (url === null) {
      return;
    }
    this.importOutcome.set('running');
    try {
      const response = await this.store.save(url);
      this.importGroups.set(
        response.alreadyInGroups.length === 0
          ? null
          : response.alreadyInGroups.map((group) => group.name).join(', '),
      );
      this.importOutcome.set(response.shared === 'already_there' ? 'already' : 'saved');
    } catch {
      this.importOutcome.set('saveFailed');
    }
  }

  /** Quita `import` de la URL sin dejar entrada en el historial: recargar la página no repite el intento. */
  private clearImportParam(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      replaceUrl: true,
    });
  }

  protected openImport(): void {
    this.dialog.open(ImportLinksDialog);
  }

  protected loadMore(): void {
    void this.store.loadMore();
  }
}
