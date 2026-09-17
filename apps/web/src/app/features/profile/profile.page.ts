import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Página de perfil. Marcador de 7.5: nombre y cambio de contraseña llegan con 7.8. */
@Component({
  selector: 'lv-profile-page',
  template: `
    <section class="p-6">
      <h1 class="text-2xl font-medium" i18n="@@profile.title">Perfil</h1>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePage {}
