import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Página provisional de `/unirse`: el formulario con el código de la query llega en 7.5. */
@Component({
  selector: 'lv-join-group-page',
  template: `
    <section class="p-6">
      <h1 class="text-2xl font-medium" i18n="@@groups.join.title">Unirse a un grupo</h1>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoinGroupPage {}
