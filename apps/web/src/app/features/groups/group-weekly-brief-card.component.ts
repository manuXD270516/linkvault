import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import type { GroupBriefOffer } from '@linkvault/shared';
import { GroupWeeklyBriefStore } from '../../core/groups/group-weekly-brief.store';
import {
  groupBriefBulletText,
  groupBriefHeaderText,
  groupBriefMissingText,
  groupBriefMoreText,
  groupBriefOfferClosesText,
  groupBriefShowOffersText,
} from './group-weekly-brief-text';

interface OfferRow {
  readonly offer: GroupBriefOffer;
  readonly name: string;
  /** «cierra el {fecha}»; solo en las ofertas de `closing_soon` que traen `expiresAt`. */
  readonly closes: string | null;
}

interface BulletRow {
  readonly factId: string;
  readonly text: string;
  readonly offers: readonly OfferRow[];
  /** Cantidad del botón: ofertas visibles más `moreCount`. Con 0 no hay botón. */
  readonly offerCount: number;
  readonly showOffersLabel: string;
  readonly more: string | null;
  readonly missing: string | null;
}

/**
 * Tarjeta «La semana del grupo» (spec web/group-weekly-brief, design D9): las viñetas verificadas de la semana con sus
 * ofertas a un toque. Solo lee: no escribe en la api y nunca muestra nombres, avatares, estados, marcas, notas ni
 * etiquetas de los miembros. Un fallo de la tarjeta no toca el detalle del grupo: solo ella muestra su error.
 */
@Component({
  selector: 'lv-group-weekly-brief-card',
  imports: [MatButtonModule],
  templateUrl: './group-weekly-brief-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupWeeklyBriefCard {
  protected readonly store = inject(GroupWeeklyBriefStore);
  private readonly locale = inject(LOCALE_ID);

  readonly groupId = input.required<string>();

  /** `factId` de las viñetas con las ofertas desplegadas. */
  private readonly expanded = signal<ReadonlySet<string>>(new Set());

  protected readonly brief = computed(() => this.store.response()?.brief ?? null);

  protected readonly header = computed((): string => {
    const brief = this.brief();
    return brief === null ? '' : groupBriefHeaderText(brief.asOf, brief.openOffers, this.locale);
  });

  protected readonly rows = computed((): BulletRow[] =>
    (this.brief()?.bullets ?? []).map((bullet) => {
      const closing = bullet.fact.kind === 'closing_soon';
      return {
        factId: bullet.factId,
        text: groupBriefBulletText(bullet.fact, this.locale),
        offers: bullet.offers.map((offer) => ({
          offer,
          name: offer.title ?? offer.displayUrl,
          closes:
            closing && offer.expiresAt !== undefined ? groupBriefOfferClosesText(offer.expiresAt, this.locale) : null,
        })),
        offerCount: bullet.offers.length + bullet.moreCount,
        showOffersLabel: groupBriefShowOffersText(bullet.offers.length + bullet.moreCount),
        more: bullet.moreCount > 0 ? groupBriefMoreText(bullet.moreCount) : null,
        missing: bullet.missingCount > 0 ? groupBriefMissingText(bullet.missingCount) : null,
      };
    }),
  );

  constructor() {
    // Una carga por grupo; `load` descarta la respuesta de un grupo anterior si el id cambia a mitad de camino.
    effect(() => {
      const groupId = this.groupId();
      untracked(() => {
        this.expanded.set(new Set());
        void this.store.load(groupId);
      });
    });
  }

  protected isExpanded(factId: string): boolean {
    return this.expanded().has(factId);
  }

  protected toggle(factId: string): void {
    this.expanded.update((current) => {
      const next = new Set(current);
      if (!next.delete(factId)) {
        next.add(factId);
      }
      return next;
    });
  }

  protected retry(): void {
    this.expanded.set(new Set());
    void this.store.retry();
  }
}
