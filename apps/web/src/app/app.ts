import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { isPublicPath } from './core/auth/session-restore';
import { SessionStore } from './core/auth/session.store';

@Component({
  selector: 'lv-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly session = inject(SessionStore);

  /**
   * En una ruta pública no se restaura la sesión al arrancar (D9), así que ahí el estado `unknown` no es una espera:
   * es que nadie la ha pedido todavía. Se mira el `pathname` de arranque, que es el que decidió el initializer.
   */
  private readonly publicStart = isPublicPath(location.pathname);

  /** Mientras se restaura la sesión al cargar, los guards retienen la primera navegación. */
  protected readonly connecting = computed(
    () => !this.publicStart && this.session.status() === 'unknown',
  );
}
