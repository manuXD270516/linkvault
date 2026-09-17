import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Página provisional de `/grupos`: la lista con tarjetas, estado vacío y diálogos llega en 7.3 y 7.4. */
@Component({
  selector: 'lv-groups-list-page',
  template: `
    <section class="p-6">
      <h1 class="text-2xl font-medium" i18n="@@groups.list.title">Grupos</h1>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupsListPage {}
