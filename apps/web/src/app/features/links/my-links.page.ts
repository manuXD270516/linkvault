import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { EventsChannel } from '../../core/events/events.channel';
import { LinksStore } from '../../core/links/links.store';
import { RequestError } from '../../shared/ui/request-error';
import { ImportLinksDialog } from './import-links.dialog';
import { LinkList } from './link-list.component';
import { SaveLinkForm } from './save-link.form';

/**
 * Lista privada (`/mis-links`): lo que el usuario guardó sin grupo, con las mismas acciones que dentro de un grupo
 * (guardar, importar, abrir y quitar). La lista solo se pinta una vez cargada, para que el estado vacío no aparezca
 * mientras se pide la primera página.
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

  protected readonly links = this.store.items;
  protected readonly loaded = this.store.loaded;
  protected readonly loadingMore = this.store.loadingMore;
  protected readonly hasMore = this.store.hasMore;
  protected readonly failure = this.store.failure;
  /** `true` solo con la lista privada abierta: guardar e importar nunca pueden ir al grupo que se miraba antes. */
  protected readonly scopeReady = computed(() => this.store.scope()?.kind === 'mine');

  constructor() {
    // El canal deja que las tarjetas se enteren solas de las lecturas que terminan; si no se puede abrir, la lista
    // sigue funcionando con lo que devolvió la API.
    inject(EventsChannel).connect();
    void this.store.open({ kind: 'mine' });
  }

  protected openImport(): void {
    this.dialog.open(ImportLinksDialog);
  }

  protected loadMore(): void {
    void this.store.loadMore();
  }
}
