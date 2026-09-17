import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Página de registro. Marcador de 7.5: el formulario llega con 7.7. */
@Component({
  selector: 'lv-register-page',
  template: `
    <section class="p-6">
      <h1 class="text-2xl font-medium" i18n="@@register.title">Crear cuenta</h1>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegisterPage {}
