import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Página provisional de `/grupos/:id`: los miembros, el código y las acciones llegan en 7.6 a 7.9. */
@Component({
  selector: 'lv-group-detail-page',
  template: `
    <section class="p-6">
      <h1 class="text-2xl font-medium" i18n="@@groups.detail.title">Grupo</h1>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupDetailPage {}
