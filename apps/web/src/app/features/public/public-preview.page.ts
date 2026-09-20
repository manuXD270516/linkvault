import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  LOCALE_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { PublicJobPreview } from '@linkvault/shared';
import { hasApiErrorCode } from '../../core/api/api-error';
import { PublicPreviewApi } from '../../core/public/public-preview.api';
import {
  daysSince,
  formatSalary,
  linkLabel,
  modalityLabel,
  platformName,
  seniorityLabel,
} from '../links/link-preview';

/**
 * En qué estado está la vista: cargando, con la oferta, con el enlace quemado (`404`) o con una avería nuestra
 * (`429`, `5xx` o fallo de red). Los dos últimos son estados distintos a propósito (critic N1 de la iteración 2): un
 * `429` no puede decirle a nadie que su oferta ha desaparecido.
 */
export type PublicPreviewStatus = 'loading' | 'ready' | 'gone' | 'unavailable';

/**
 * Vista pública de una oferta (`/oferta/:slug`, D9 y D12 de public-preview-share). Se abre sin sesión y su **única**
 * petición a la API es el preview público: no pide la sesión, ni la lista de grupos, ni nada más. No muestra quién
 * compartió la oferta, a qué grupo pertenece, la nota, los comentarios, el resumen ni la procedencia de ningún campo:
 * lo que llega es exactamente lo publicable (`publicJobPreviewSchema`).
 */
@Component({
  selector: 'lv-public-preview-page',
  imports: [DatePipe, MatButtonModule, RouterLink],
  templateUrl: './public-preview.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicPreviewPage {
  private readonly api = inject(PublicPreviewApi);
  private readonly router = inject(Router);
  private readonly locale = inject(LOCALE_ID);

  /** El `slug` de la URL, tal cual: juzgarlo es cosa de la API, que responde el mismo `404` para todo lo que no vale. */
  protected readonly slug = inject(ActivatedRoute).snapshot.paramMap.get('slug') ?? '';

  protected readonly status = signal<PublicPreviewStatus>('loading');
  /** `true` mientras la navegación del CTA está en curso: el botón se ve pendiente y no acepta una segunda pulsación. */
  protected readonly saving = signal(false);
  private readonly preview = signal<PublicJobPreview | null>(null);

  constructor() {
    // `noindex` mientras la vista está abierta, y se quita al salir (critic 15): la oferta es de la bolsa que la
    // publicó y LinkVault no la duplica en los buscadores. A esta ruta no llegan los bots de las tarjetas —los que
    // leen OG piden `/p/:slug`—, así que aquí sí se puede reforzar además con `Disallow: /oferta/` en el `robots.txt`.
    const meta = inject(Meta);
    const tag = meta.addTag({ name: 'robots', content: 'noindex' });
    inject(DestroyRef).onDestroy(() => {
      if (tag !== null) {
        meta.removeTagElement(tag);
      }
    });
    void this.load();
  }

  /** Pide el preview público y deja la vista en uno de sus tres desenlaces. Nunca rechaza. */
  protected async load(): Promise<void> {
    this.status.set('loading');
    try {
      const response = await this.api.preview(this.slug);
      this.preview.set(response.link);
      this.status.set('ready');
    } catch (error: unknown) {
      this.preview.set(null);
      // Solo el `404` significa "ya no está"; cualquier otro fallo es nuestro y se dice como tal.
      this.status.set(hasApiErrorCode(error, 404, 'link_not_found') ? 'gone' : 'unavailable');
    }
  }

  /**
   * "Guardar en LinkVault": navega **siempre** a `/registro?import=<slug>`, haya sesión o no, y **sin esperar a nada**.
   * No consulta la sesión, no dispara un refresh y no se bloquea: es una navegación del router y punto. A quien ya
   * tiene sesión lo desvía `guestGuard`, que ya la restaura, a `/mis-links?import=<slug>`. Preguntar aquí por la sesión
   * metería una espera de hasta 10 s dentro del clic que convierte (business 1, iteración 2).
   *
   * Mientras la navegación está en curso el botón queda pendiente, porque el guard puede tardar y un botón que no
   * responde se vuelve a pulsar (business 3, iteración 3). El destino no depende de ese estado.
   */
  protected async save(): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    try {
      await this.router.navigate(['/registro'], { queryParams: { import: this.slug } });
    } finally {
      // Si la navegación llegó a su destino, esta vista ya no existe; si no llegó, el botón vuelve a poder pulsarse.
      this.saving.set(false);
    }
  }

  /** El título de la vacante cuando se pudo leer; si no, la etiqueta derivada de su URL, como en la tarjeta. */
  protected readonly headline = computed(() => {
    const link = this.preview();
    if (link === null) {
      return '';
    }
    const title = link.title;
    return title === undefined || title.length === 0 ? linkLabel(link.displayUrl ?? '') : title;
  });

  protected readonly company = computed(() => this.preview()?.company ?? null);
  protected readonly location = computed(() => this.preview()?.location ?? null);
  protected readonly modality = computed(() => modalityLabel(this.preview()?.modality));
  protected readonly seniority = computed(() => seniorityLabel(this.preview()?.seniority));
  protected readonly salary = computed(() => formatSalary(this.preview()?.salary, this.locale));
  protected readonly platform = computed(() => {
    const link = this.preview();
    return link === null ? null : platformName(link.platform);
  });

  /** Días desde que se publicó la oferta, si la página lo dijo. */
  protected readonly daysSincePosted = computed(() => daysSince(this.preview()?.postedAt, new Date()));
  protected readonly expiresAt = computed(() => this.preview()?.expiresAt ?? null);

  /**
   * La URL original ya saneada por la API (`publicHttpUrl`), o `null` cuando no se puede publicar. Sin ella la página
   * se muestra sin el enlace a la oferta, que es lo que decidió D6.
   */
  protected readonly originalUrl = computed(() => this.preview()?.displayUrl ?? null);
}
