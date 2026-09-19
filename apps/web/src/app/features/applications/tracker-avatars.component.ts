import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ApplicationStatus, GroupTracker } from '@linkvault/shared';
import { statusLabel } from './application-status.labels';

/** Avatares a la vista antes de resumir el resto como "+N". */
const VISIBLE_AVATARS = 5;

/** Iniciales de un nombre visible: las de las dos primeras palabras, o la primera letra si solo hay una. */
export function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter((word) => word.length > 0);
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? '');
  return letters.join('').toLocaleUpperCase();
}

/** Tono estable derivado del `userId`: la misma persona tiene el mismo color en todas las tarjetas y sesiones. */
export function hueOf(userId: string): number {
  let hash = 0;
  for (const char of userId) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  }
  return hash;
}

/** Etiqueta accesible, con el estado en tercera persona (business 2): "Beto · postulación: Postulada". */
export function trackerLabel(displayName: string, status: ApplicationStatus): string {
  return $localize`:@@applications.avatar.label:${displayName}:NAME: · postulación: ${statusLabel(status)}:STATUS:`;
}

/**
 * Quién más sigue esta oferta en el grupo (spec web/applications, "Quién más sigue esta oferta"): iniciales con un color
 * derivado del `userId`, hasta cinco y después "+N". Solo nombre y estado canónico: nunca la etapa ni las notas (D6).
 */
@Component({
  selector: 'lv-tracker-avatars',
  template: `
    @if (trackers().length > 0) {
      <ul
        class="m-0 flex list-none flex-wrap items-center gap-1 p-0"
        data-testid="tracker-avatars"
        [attr.aria-label]="listLabel"
      >
        @for (avatar of visible(); track avatar.userId) {
          <li>
            <span
              role="img"
              class="inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium text-white"
              [style.background-color]="avatar.color"
              [attr.aria-label]="avatar.label"
              [attr.title]="avatar.label"
              data-testid="tracker-avatar"
              >{{ avatar.initials }}</span
            >
          </li>
        }
        @if (hidden().length > 0) {
          <li>
            <span class="text-sm" [attr.title]="hiddenLabels()" data-testid="tracker-more"
              >+{{ hidden().length }}</span
            >
          </li>
        }
      </ul>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrackerAvatars {
  readonly trackers = input.required<readonly GroupTracker[]>();

  protected readonly listLabel = $localize`:@@applications.avatar.list:Siguen esta oferta`;

  private readonly avatars = computed(() =>
    this.trackers().map((tracker) => ({
      userId: tracker.userId,
      initials: initialsOf(tracker.displayName),
      color: `hsl(${hueOf(tracker.userId)} 55% 38%)`,
      label: trackerLabel(tracker.displayName, tracker.status),
    })),
  );
  protected readonly visible = computed(() => this.avatars().slice(0, VISIBLE_AVATARS));
  protected readonly hidden = computed(() => this.avatars().slice(VISIBLE_AVATARS));
  protected readonly hiddenLabels = computed(() =>
    this.hidden()
      .map((avatar) => avatar.label)
      .join(', '),
  );
}
