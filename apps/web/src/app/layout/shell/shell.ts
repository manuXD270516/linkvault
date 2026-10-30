import { BreakpointObserver } from '@angular/cdk/layout';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { filter } from 'rxjs';
import { AuthApi } from '../../core/auth/auth.api';
import { CapabilitiesStore } from '../../core/capabilities/capabilities.store';
import { EmailUnverifiedBanner } from './email-unverified-banner';
import { NAV_ENTRIES, type NavEntry } from './nav-entries';
import { SHELL_COMPACT_QUERY } from './shell-breakpoint';

/** `id` del panel de navegación compacto: el botón «Menú» lo referencia con `aria-controls`. */
const NAV_PANEL_ID = 'lv-shell-nav';

/**
 * Marco de las rutas autenticadas: barra con la marca, la lista de entradas (`NAV_ENTRIES`, filtrada por las
 * capacidades del despliegue) y «Cerrar sesión». Por debajo del umbral de `SHELL_COMPACT_QUERY` la barra es una fila
 * con la marca y «Menú», que despliega un `<nav>` bajo ella (spec web/shell).
 */
@Component({
  selector: 'lv-shell',
  imports: [
    EmailUnverifiedBanner,
    MatButtonModule,
    MatToolbarModule,
    RouterLink,
    RouterOutlet,
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell {
  private readonly authApi = inject(AuthApi);
  private readonly router = inject(Router);
  private readonly breakpoints = inject(BreakpointObserver);
  protected readonly capabilities = inject(CapabilitiesStore);

  protected readonly navPanelId = NAV_PANEL_ID;
  protected readonly loggingOut = signal(false);
  /** Valor síncrono de entrada: el primer render ya está en el modo correcto (C7). */
  protected readonly compact = signal(
    this.breakpoints.isMatched(SHELL_COMPACT_QUERY),
  );
  protected readonly menuOpen = signal(false);

  /** Entradas visibles: las condicionales según el store (desconocido oculta, fallo abre). */
  protected readonly entries = computed<readonly NavEntry[]>(() =>
    NAV_ENTRIES.filter((entry) => {
      switch (entry.capability) {
        case 'search':
          return this.capabilities.showSearch();
        case 'discovery':
          return this.capabilities.showDiscovery();
        case undefined:
          return true;
      }
    }),
  );

  private readonly main = viewChild<ElementRef<HTMLElement>>('main');
  private readonly menuButton = viewChild('menuButton', {
    read: ElementRef<HTMLElement>,
  });
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  constructor() {
    void this.capabilities.ensureLoaded();

    this.breakpoints
      .observe(SHELL_COMPACT_QUERY)
      .pipe(takeUntilDestroyed())
      .subscribe(({ matches }) => {
        if (!matches && this.menuOpen()) {
          // Se mira antes de que el panel salga del DOM: el enlace que tenía el foco queda oculto.
          const focusWasInPanel =
            this.panel()?.nativeElement.contains(document.activeElement) ??
            false;
          this.menuOpen.set(false);
          if (focusWasInPanel) {
            this.focusMain();
          }
        }
        this.compact.set(matches);
      });

    // Una navegación que termina con el panel abierto lo cierra, venga de donde venga (atrás, programática). Con el
    // panel cerrado no se toca el foco: varias páginas navegan con `replaceUrl` mientras se escribe en ellas.
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        if (this.menuOpen()) {
          this.menuOpen.set(false);
          this.focusMain();
        }
      });
  }

  protected toggleMenu(): void {
    if (this.menuOpen()) {
      this.closeToButton();
    } else {
      this.menuOpen.set(true);
    }
  }

  /** Un enlace del panel lo cierra aunque sea la ruta actual (que no produce `NavigationEnd`). */
  protected onPanelLink(): void {
    this.menuOpen.set(false);
    this.focusMain();
  }

  /** Escape se escucha en el `<header>` y solo cuenta con el panel abierto. */
  protected onEscape(): void {
    if (this.menuOpen()) {
      this.closeToButton();
    }
  }

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

  private closeToButton(): void {
    this.menuOpen.set(false);
    this.menuButton()?.nativeElement.focus();
  }

  private focusMain(): void {
    this.main()?.nativeElement.focus({ preventScroll: true });
  }
}
