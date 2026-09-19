import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  type TemplateRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { GroupDetail, GroupMember } from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';
import {
  type RequestFailure,
  hasApiErrorCode,
  toRequestFailure,
} from '../../core/api/api-error';
import { GroupsApi } from '../../core/groups/groups.api';
import { GroupsStore } from '../../core/groups/groups.store';
import { EventsChannel } from '../../core/events/events.channel';
import { LinksStore } from '../../core/links/links.store';
import { HOME_ROUTE } from '../../core/navigation/home-route';
import { ImportLinksDialog } from '../links/import-links.dialog';
import { LinkList } from '../links/link-list.component';
import { SaveLinkForm } from '../links/save-link.form';
import { confirmWith } from '../../shared/ui/confirm.dialog';
import { RequestError } from '../../shared/ui/request-error';
import { RenameGroupDialog, type RenameGroupDialogData } from './rename-group.dialog';

/**
 * Detalle de un grupo (`/grupos/:id`): nombre, miembros con su rol y su fecha de alta y, para el owner, el código de
 * invitación con su advertencia. Un `404` es el mismo para un grupo inexistente, uno ajeno y un identificador mal
 * formado (D2), así que solo se puede decir que el grupo no existe o que el usuario ya no pertenece a él; además se
 * quita de la lista guardada, que podría traerlo todavía.
 */
@Component({
  selector: 'lv-group-detail-page',
  imports: [
    DatePipe,
    LinkList,
    MatButtonModule,
    RequestError,
    RouterLink,
    SaveLinkForm,
  ],
  templateUrl: './group-detail.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupDetailPage {
  private readonly api = inject(GroupsApi);
  private readonly store = inject(GroupsStore);
  private readonly linksStore = inject(LinksStore);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  protected readonly groupId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly group = signal<GroupDetail | null>(null);
  protected readonly members = signal<GroupMember[]>([]);
  protected readonly notFound = signal(false);
  protected readonly failure = signal<RequestFailure | null>(null);
  protected readonly working = signal(false);
  protected readonly isOwner = computed(() => this.group()?.role === 'owner');
  protected readonly memberCount = computed(() => this.group()?.memberCount ?? 0);
  /** Mensaje de invitación cuando no hay portapapeles: se muestra seleccionado para copiarlo a mano. */
  protected readonly invitationToCopy = signal('');
  protected readonly invitationCopied = signal(false);
  /** Tras expulsar se ofrece regenerar el código; aceptar la oferta ya es la confirmación. */
  protected readonly rotateOffer = signal(false);

  /** Links del grupo: los pone `LinksStore`, que también los recarga al guardar, importar o quitar. */
  protected readonly links = this.linksStore.items;
  protected readonly linksLoaded = this.linksStore.loaded;
  protected readonly linksTotal = this.linksStore.total;
  protected readonly hasMoreLinks = this.linksStore.hasMore;
  protected readonly loadingMoreLinks = this.linksStore.loadingMore;

  private readonly invitationField = viewChild<ElementRef<HTMLTextAreaElement>>('invitationField');
  private readonly deleteMessage = viewChild.required<TemplateRef<unknown>>('deleteMessage');

  constructor() {
    // El canal deja que las tarjetas se enteren solas de las lecturas que terminan; si no se puede abrir, la lista
    // sigue funcionando con lo que devolvió la API.
    inject(EventsChannel).connect();
    void this.enter();
    // El respaldo aparece ya seleccionado, para que baste con copiar.
    effect(() => this.invitationField()?.nativeElement.select());
  }

  /**
   * Los links se piden solo cuando ya se sabe que el grupo existe y es del usuario: si el detalle responde `404`, no hay
   * lista que pedir. Va aparte de `load`, que también se usa para refrescar los miembros tras expulsar.
   */
  private async enter(): Promise<void> {
    await this.load();
    if (this.group() !== null) {
      await this.linksStore.open({ kind: 'group', groupId: this.groupId });
    }
  }

  protected openImport(): void {
    this.dialog.open(ImportLinksDialog);
  }

  protected loadMoreLinks(): void {
    void this.linksStore.loadMore();
  }

  protected async load(): Promise<void> {
    this.failure.set(null);
    try {
      this.group.set(await this.api.getGroup(this.groupId));
      this.members.set(await this.api.listMembers(this.groupId));
    } catch (error: unknown) {
      this.handle(error);
    }
  }

  /** Salir del grupo: el owner no puede, así que solo se ofrece a los demás. */
  protected async leave(): Promise<void> {
    const confirmed = await confirmWith(this.dialog, {
      title: $localize`:@@groups.detail.leaveTitle:Salir del grupo`,
      message: $localize`:@@groups.detail.leaveMessage:Dejarás de ver este grupo. Para volver necesitarás el código de invitación.`,
      confirmLabel: $localize`:@@groups.detail.leaveConfirm:Salir`,
    });
    if (!confirmed) {
      return;
    }
    await this.run(async () => {
      await this.store.leave(this.groupId);
      await this.router.navigateByUrl(HOME_ROUTE);
    });
  }

  /** Borrar el grupo: la confirmación dice a cuántos afecta (plantilla, porque el mensaje pluraliza con un ICU). */
  protected async remove(): Promise<void> {
    const confirmed = await confirmWith(this.dialog, {
      title: $localize`:@@groups.detail.deleteTitle:Borrar el grupo`,
      message: this.deleteMessage(),
      confirmLabel: $localize`:@@groups.detail.deleteConfirm:Borrar`,
    });
    if (!confirmed) {
      return;
    }
    await this.run(async () => {
      await this.store.remove(this.groupId);
      await this.router.navigateByUrl(HOME_ROUTE);
    });
  }

  /** Renombrar: el nombre se valida en el diálogo con el schema compartido y la lista se recarga para no mostrarlo viejo. */
  protected async rename(): Promise<void> {
    const current = this.group();
    if (!current) {
      return;
    }
    const name = await firstValueFrom(
      this.dialog
        .open<RenameGroupDialog, RenameGroupDialogData, string | undefined>(RenameGroupDialog, {
          data: { name: current.name },
        })
        .afterClosed(),
    );
    if (name === undefined) {
      return;
    }
    await this.run(async () => {
      this.group.set(await this.api.renameGroup(this.groupId, name));
      await this.store.load();
    });
  }

  /** Regenerar el código: los miembros actuales siguen dentro, solo deja de servir el código anterior. */
  protected async rotateInviteCode(): Promise<void> {
    const confirmed = await confirmWith(this.dialog, {
      title: $localize`:@@groups.detail.rotateTitle:Regenerar el código`,
      message: $localize`:@@groups.detail.rotateMessage:Los miembros actuales siguen dentro; solo dejará de servir el código anterior`,
      confirmLabel: $localize`:@@groups.detail.rotateConfirm:Regenerar`,
    });
    if (!confirmed) {
      return;
    }
    await this.run(async () => {
      const { inviteCode } = await this.api.rotateInviteCode(this.groupId);
      this.group.update((group) => (group ? { ...group, inviteCode } : group));
    });
  }

  /**
   * Copia el mensaje de invitación con el enlace absoluto del SPA. Sin portapapeles (o si lo deniega el navegador), deja
   * el mensaje visible y seleccionado para copiarlo a mano.
   */
  protected async copyInvitation(): Promise<void> {
    const group = this.group();
    if (!group?.inviteCode) {
      return;
    }
    const link = `${window.location.origin}/unirse?codigo=${encodeURIComponent(group.inviteCode)}`;
    const message = $localize`:@@groups.detail.invitationMessage:Únete a «${group.name}:NAME:» en LinkVault: ${link}:LINK: (código ${group.inviteCode}:CODE:)`;
    this.invitationCopied.set(false);
    this.invitationToCopy.set('');
    try {
      await navigator.clipboard.writeText(message);
      this.invitationCopied.set(true);
    } catch {
      this.invitationToCopy.set(message);
    }
  }

  /** Expulsar a un miembro: la lista se actualiza sin salir de la pantalla y se ofrece regenerar el código. */
  protected async removeMember(member: GroupMember): Promise<void> {
    const confirmed = await confirmWith(this.dialog, {
      title: $localize`:@@groups.detail.removeMemberTitle:Expulsar del grupo`,
      message: $localize`:@@groups.detail.removeMemberMessage:${member.displayName}:NAME: dejará de ver este grupo. Podrá volver a entrar si consigue el código.`,
      confirmLabel: $localize`:@@groups.detail.removeMemberConfirm:Expulsar`,
    });
    if (!confirmed) {
      return;
    }
    await this.run(async () => {
      await this.store.removeMember(this.groupId, member.userId);
      await this.load();
      this.rotateOffer.set(true);
    });
  }

  /**
   * Nombrar propietario a otro miembro (D3). No se puede deshacer desde aquí, así que la confirmación lo dice. La API
   * responde el detalle ya como miembro (sin código); los miembros se piden otra vez para ver los roles nuevos, sin
   * salir de la pantalla, que ya ofrece "Salir".
   */
  protected async transferOwnership(member: GroupMember): Promise<void> {
    const current = this.group();
    if (!current) {
      return;
    }
    const confirmed = await confirmWith(this.dialog, {
      title: $localize`:@@groups.detail.transferTitle:Nombrar propietario`,
      message: $localize`:@@groups.detail.transferMessage:«${member.displayName}:NAME:» tendrá el rol de propietario de «${current.name}:GROUP:»: podrá renombrarlo, expulsar miembros y borrarlo. Tú seguirás como miembro y no podrás deshacerlo.`,
      confirmLabel: $localize`:@@groups.detail.transferConfirm:Nombrar propietario`,
    });
    if (!confirmed) {
      return;
    }
    await this.run(async () => {
      const detail = await this.store.transferOwnership(this.groupId, member.userId);
      this.rotateOffer.set(false);
      this.invitationToCopy.set('');
      this.invitationCopied.set(false);
      this.group.set(detail);
      this.members.set(await this.api.listMembers(this.groupId));
    });
  }

  /** La oferta de regenerar tras expulsar ya cuenta como confirmación, así que no se vuelve a preguntar. */
  protected async acceptRotateOffer(): Promise<void> {
    this.rotateOffer.set(false);
    await this.run(async () => {
      const { inviteCode } = await this.api.rotateInviteCode(this.groupId);
      this.group.update((group) => (group ? { ...group, inviteCode } : group));
    });
  }

  protected dismissRotateOffer(): void {
    this.rotateOffer.set(false);
  }

  /** Ejecuta una acción sin dejar que se solapen y traduciendo su fallo como el de la carga. */
  private async run(action: () => Promise<void>): Promise<void> {
    this.working.set(true);
    this.failure.set(null);
    try {
      await action();
    } catch (error: unknown) {
      this.handle(error);
    } finally {
      this.working.set(false);
    }
  }

  private handle(error: unknown): void {
    if (hasApiErrorCode(error, 404, 'group_not_found')) {
      this.notFound.set(true);
      this.store.forget(this.groupId);
      return;
    }
    this.failure.set(toRequestFailure(error));
  }
}
