import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import type { Application, GroupTracker, JobLinkSummary, PreviewFieldName } from '@linkvault/shared';
import { statusLabel } from '../applications/application-status.labels';
import { TrackerAvatars } from '../applications/tracker-avatars.component';
import { CommentAgo } from './comment-ago.component';
import {
  daysSince,
  fieldOrigin,
  formatSalary,
  latestPaste,
  linkLabel,
  modalityLabel,
  originText,
  platformName,
  seniorityLabel,
} from './link-preview';
import { linkCardStatus } from './link-status';

/**
 * Tarjeta de una oferta (spec web/links). Muestra lo que se leyó de la vacante —título, empresa, ubicación, modalidad y
 * seniority— y, cuando todavía no hay nada, la etiqueta derivada de la URL, para que la fila siga siendo reconocible.
 *
 * Es presentacional: recibe el link ya cargado y avisa de las acciones hacia arriba, porque quien sabe a qué lista
 * pertenece (un grupo o la privada) es `LinkList`, no la tarjeta.
 */
@Component({
  selector: 'lv-link-card',
  imports: [CommentAgo, DatePipe, MatButtonModule, RouterLink, TrackerAvatars],
  templateUrl: './link-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkCard {
  readonly link = input.required<JobLinkSummary>();
  /** `true` si quien mira puede quitar este link de la lista que está viendo. */
  readonly canRemove = input(false);
  /** `true` mientras hay una acción en curso sobre la lista: los botones no se pueden pulsar dos veces. */
  readonly busy = input(false);
  /** La postulación propia sobre esta oferta, o `null` si no la sigue (spec web/applications). */
  readonly application = input<Application | null>(null);
  /** `true` si el último gesto respondió que ya la seguía (otra pestaña): se dice "Ya la seguías". */
  readonly alreadyTracked = input(false);
  /** Quién comparte su estado sobre esta oferta en el grupo; `null` fuera de un grupo, donde no hay avatares. */
  readonly trackers = input<readonly GroupTracker[] | null>(null);
  /**
   * `true` en el detalle de un grupo: solo ahí hay nota de quien compartió y comentarios (spec web/group-comments). En
   * `/mis-links` la tarjeta no los muestra aunque el link los tenga en algún grupo.
   */
  readonly groupView = input(false);
  /** `true` si quien mira puede quitar la nota: quien compartió el link o el propietario del grupo. */
  readonly canRemoveNote = input(false);
  /**
   * `true` si quien mira puede encender y apagar el enlace público: quien compartió el link o el propietario del grupo
   * (ADR-027 §2). La **marca** de que está publicado la ve cualquier miembro; el interruptor, solo esos dos.
   */
  readonly canPublish = input(false);

  readonly remove = output<void>();
  /** Completar la oferta a mano: quien la abre es `LinkList`, que sabe recargar la lista al guardar. */
  readonly complete = output<void>();
  /** Volver a pedir la lectura; solo se ofrece cuando el motivo del fallo es transitorio. */
  readonly retry = output<void>();
  /** Completar la oferta pegando su descripción: el diálogo lo abre `LinkList`, igual que el de completar a mano. */
  readonly pasteDescription = output<void>();
  /** Deshacer de una vez todos los campos del último pegado; emite los campos que hay que devolver a lo anterior. */
  readonly undoPaste = output<PreviewFieldName[]>();
  /** Gesto de seguimiento: "Me interesa" o "Postulé". La fecha y la invitación a compartir las resuelve `LinkList`. */
  readonly track = output<'interested' | 'applied'>();
  /** Abrir el hilo de comentarios del link en el grupo; el diálogo lo abre `LinkList`. */
  readonly openComments = output<void>();
  /** Quitar la nota; la confirmación (propia o ajena) la pide `LinkList`, que sabe quién mira. */
  readonly removeNote = output<void>();
  /** Encender el enlace público; la confirmación que dice el alcance la pide `LinkList`. */
  readonly publish = output<void>();
  /** Apagarlo; su confirmación avisa de que el enlace deja de funcionar para quien ya lo tenga. */
  readonly unpublish = output<void>();
  /** Copiar la URL pública al portapapeles; el aviso de "todavía estamos leyendo la oferta" lo da `LinkList`. */
  readonly copyPublicLink = output<void>();

  private readonly locale = inject(LOCALE_ID);

  /** Nombre neutro del estado propio, con enlace al tablero. */
  protected readonly ownStatus = computed(() => {
    const application = this.application();
    return application === null ? null : statusLabel(application.status);
  });

  /** "Postulé" se ofrece sin seguirla y mientras está en "Guardada" o "Interés" (spec "Seguir desde la tarjeta"). */
  protected readonly offersApplied = computed(() => {
    const status = this.application()?.status;
    return status === undefined || status === 'saved' || status === 'interested';
  });

  /** La nota de quien compartió, solo en el grupo. */
  protected readonly shareNote = computed(() => (this.groupView() ? (this.link().note ?? null) : null));

  /**
   * El enlace público del link, solo en el grupo: la lista privada no lo lleva nunca, porque un link privado no se
   * puede publicar (ADR-027 §1).
   */
  protected readonly publicShare = computed(() =>
    this.groupView() ? (this.link().publicShare ?? null) : null,
  );

  /** `true` si aquí se puede ofrecer encender el enlace: en un grupo, a quien compartió el link y al propietario. */
  protected readonly offersPublish = computed(() => this.groupView() && this.canPublish());

  /** Cuántos comentarios tiene el link en el grupo: del contador que trae, no de los que se ven. */
  protected readonly commentCount = computed(() => this.link().comments?.count ?? 0);

  /** Los dos últimos comentarios, el más antiguo arriba: `latest` llega del más reciente al más antiguo. */
  protected readonly latestComments = computed(() =>
    this.groupView() ? [...(this.link().comments?.latest ?? [])].reverse() : [],
  );

  private readonly preview = computed(() => this.link().preview);
  private readonly sources = computed(() => this.link().previewSources);

  /** El título de la vacante cuando se pudo leer; si no, la etiqueta derivada de la URL. */
  protected readonly headline = computed(() => {
    const title = this.preview()?.title;
    return title === undefined || title.length === 0 ? linkLabel(this.link().displayUrl) : title;
  });

  protected readonly company = computed(() => this.preview()?.company ?? null);
  protected readonly location = computed(() => this.preview()?.location ?? null);
  protected readonly modality = computed(() => modalityLabel(this.preview()?.modality));
  protected readonly seniority = computed(() => seniorityLabel(this.preview()?.seniority));
  protected readonly platform = computed(() => platformName(this.link().platform));
  protected readonly salary = computed(() => formatSalary(this.preview()?.salary, this.locale));

  /**
   * `true` si el salario lo dedujo la IA. Entonces se enseña sin destacar: un salario inventado es el dato que más daño
   * hace de esta tarjeta, y presentarlo como si estuviera escrito en la oferta sería mentir por tipografía.
   */
  protected readonly salaryIsGuessed = computed(
    () => fieldOrigin(this.sources()?.salary)?.kind === 'ai',
  );

  /** Días desde que se publicó la oferta, si la página lo dijo. */
  protected readonly daysSincePosted = computed(() =>
    daysSince(this.preview()?.postedAt, new Date()),
  );

  protected readonly expiresAt = computed(() => this.preview()?.expiresAt ?? null);

  /**
   * Qué se le dice a la persona sobre esta oferta. Se recalcula con el link, así que un aviso que llega por el canal de
   * eventos cambia el texto sin que nadie recargue nada.
   */
  protected readonly status = computed(() => linkCardStatus(this.link(), new Date()));

  /**
   * El último pegado que sigue a la vista, para ofrecer "Deshacer lo que pegó Ana": una persona puede pegar la oferta
   * equivocada en un link compartido, y devolverlo campo a campo sería pedir a las demás que adivinaran cuáles tocó.
   */
  protected readonly lastPaste = computed(() => latestPaste(this.sources()));

  /**
   * Quién escribió ese dato, cuando no fue la página: "Escrito por Ana", "Descripción pegada por Beto" o "Deducido por
   * la IA". Lo leído de la página no se anota, que es el caso normal y llenaría la tarjeta de ruido; lo que sí hace
   * falta decir es cuándo el dato lo puso una persona —el link es compartido y las demás lo ven— y cuándo es una
   * conjetura de la IA.
   */
  protected note(field: PreviewFieldName): string | null {
    const origin = fieldOrigin(this.sources()?.[field]);
    return origin === null || origin.kind === 'page' ? null : originText(origin);
  }
}
