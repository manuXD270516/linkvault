import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthApi } from '../../core/auth/auth.api';
import { EmailUnverifiedBanner } from './email-unverified-banner';

/** Marco de las rutas autenticadas: barra con enlace al perfil y botón de cerrar sesión. */
@Component({
  selector: 'lv-shell',
  imports: [EmailUnverifiedBanner, MatButtonModule, MatToolbarModule, RouterLink, RouterOutlet],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell {
  private readonly authApi = inject(AuthApi);
  private readonly router = inject(Router);

  protected readonly loggingOut = signal(false);

  protected async logout(): Promise<void> {
    this.loggingOut.set(true);
    try {
      await this.authApi.logout();
    } catch {
      // Con la red caída la cookie sigue válida, pero la sesión local ya está borrada (spec web/auth, "Logout con red caída").
    }
    await this.router.navigateByUrl('/login');
    this.loggingOut.set(false);
  }
}
