import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
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

  /** Mientras se restaura la sesión al cargar, los guards retienen la primera navegación. */
  protected readonly connecting = computed(() => this.session.status() === 'unknown');
}
