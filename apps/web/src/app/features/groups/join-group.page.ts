import { ChangeDetectionStrategy, Component, type OnInit, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import { HOME_ROUTE } from '../../core/navigation/home-route';
import { JoinGroupDialog } from './join-group.dialog';

/**
 * Destino del enlace de invitación (`/unirse?codigo=<código>`): abre el mismo diálogo que la lista con el código ya
 * escrito y borra el parámetro de la URL en cuanto lo lee, con `replaceUrl` para que tampoco quede en el historial
 * (Risks de design: el código viaja en la URL y podría acabar en `Referer` o en los logs de acceso). Como cualquier ruta
 * autenticada, `returnUrl` la recupera tras iniciar sesión o registrarse.
 */
@Component({
  selector: 'lv-join-group-page',
  template: `
    <section class="mx-auto flex max-w-sm flex-col gap-4 p-6">
      <h1 class="text-2xl font-medium" i18n="@@groups.joinPage.title">Unirse a un grupo</h1>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoinGroupPage implements OnInit {
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  ngOnInit(): void {
    const code = this.route.snapshot.queryParamMap.get('codigo') ?? '';
    if (code !== '') {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    }
    this.dialog
      .open(JoinGroupDialog, { data: { code } })
      .afterClosed()
      .subscribe((group: unknown) => {
        // Al unirse, el diálogo ya navega al detalle; si se cierra sin unirse, esta pantalla no tiene nada más que ofrecer.
        if (!group) {
          void this.router.navigateByUrl(HOME_ROUTE);
        }
      });
  }
}
