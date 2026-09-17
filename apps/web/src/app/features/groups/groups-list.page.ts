import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { GroupsStore } from '../../core/groups/groups.store';
import { RequestError } from '../../shared/ui/request-error';
import { CreateGroupDialog } from './create-group.dialog';
import { JoinGroupDialog } from './join-group.dialog';

/**
 * Inicio del SPA (`/grupos`): los grupos del usuario con su rol y su número de miembros, o el estado vacío con los dos
 * botones. La lista se pide cada vez que se entra en la pantalla, para que un grupo del que se salió o del que expulsaron
 * al usuario deje de aparecer (spec web/groups, "Lista actualizada al volver").
 */
@Component({
  selector: 'lv-groups-list-page',
  imports: [MatButtonModule, MatCardModule, RequestError, RouterLink],
  templateUrl: './groups-list.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupsListPage {
  private readonly store = inject(GroupsStore);
  private readonly dialog = inject(MatDialog);

  protected readonly groups = this.store.groups;
  protected readonly loading = this.store.loading;
  protected readonly isEmpty = this.store.isEmpty;
  protected readonly failure = this.store.failure;

  constructor() {
    void this.store.load();
  }

  /** Los diálogos llaman a la API y navegan al detalle; aquí solo se abren. */
  protected openCreate(): void {
    this.dialog.open(CreateGroupDialog);
  }

  protected openJoin(): void {
    this.dialog.open(JoinGroupDialog);
  }
}
