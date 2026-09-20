import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import type { CvDocument } from '@linkvault/shared';

/**
 * Una tarjeta por **CV guardado** (D13, spec web/cv). Se identifica por **su nombre y su fecha**, nunca por su número
 * de versión: nadie piensa en "la versión 3 de mi CV", piensa en "el que mandé a esa empresa". Tampoco se enseña el
 * número de caracteres leídos, que no le dice nada a nadie y compite con la única señal que sí importa: ver el texto.
 *
 * Es presentacional: recibe el CV y avisa hacia arriba, porque quien sabe pedir a la API es la página.
 */
@Component({
  selector: 'lv-cv-card',
  imports: [DatePipe, MatButtonModule],
  templateUrl: './cv-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CvCard {
  readonly cv = input.required<CvDocument>();
  /** `true` si hay otro CV que sí se pudo leer: solo entonces se ofrece "Usar el que sí se leyó". */
  readonly hasOtherExtracted = input(false);
  /** `true` mientras hay una acción en curso sobre la lista: los botones no se pueden pulsar dos veces. */
  readonly busy = input(false);

  /** Mover la marca a este CV. */
  readonly useThis = output<void>();
  /** Mover la marca al CV más reciente que sí se leyó, desde el aviso del marcado en `failed`. */
  readonly useExtracted = output<void>();
  readonly viewText = output<void>();
  readonly remove = output<void>();

  protected readonly extraction = computed(() => this.cv().extraction);
  protected readonly isExtracted = computed(() => this.extraction().status === 'extracted');
  protected readonly isPdf = computed(() => this.cv().fileType === 'pdf');
  /** El aviso de la consecuencia solo aparece en el CV marcado que no se pudo leer. */
  protected readonly warnsUseless = computed(
    () => this.cv().isDefault && this.extraction().status === 'failed',
  );
  protected readonly sizeLabel = computed(() => fileSizeLabel(this.cv().sizeBytes));
}

/**
 * El tamaño tal y como se enseña junto al nombre: KB hasta el mega y MB con un decimal a partir de ahí. Las unidades
 * se escriben igual en los dos idiomas, así que no hay nada que traducir.
 */
export function fileSizeLabel(bytes: number): string {
  const kilobytes = bytes / 1024;
  return kilobytes < 1024
    ? `${Math.max(1, Math.round(kilobytes))} KB`
    : `${(kilobytes / 1024).toFixed(1)} MB`;
}
