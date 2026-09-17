import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Página de login. Marcador de 7.5: el formulario llega con 7.6. */
@Component({
  selector: 'lv-login-page',
  template: `
    <section class="p-6">
      <h1 class="text-2xl font-medium" i18n="@@login.title">Iniciar sesión</h1>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {}
