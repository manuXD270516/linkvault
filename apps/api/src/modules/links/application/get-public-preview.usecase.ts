import {
  publicHttpUrl,
  type PublicJobPreview,
  type PublicPreviewResponse,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { JobLink } from '../domain/job-link';
import { isValidPublicSlug } from '../domain/public-slug';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from './ports/group-link-repository.port';
import {
  JOB_LINK_REPOSITORY,
  type JobLinkRepository,
} from './ports/job-link-repository.port';

/**
 * La oferta detrás de un enlace público, para la página `/p/:slug` y para `GET /api/public/previews/:slug` (D6 y D7 de
 * public-preview-share).
 *
 * **Dos lecturas indexadas y ninguna escritura**: la relación por su slug y la vacante. No resuelve nombres, no lee
 * miembros, no cuenta nada, no pide el enriquecimiento del link aunque esté `pending` o `failed`, no toca el outbox, no
 * publica avisos y no llama a la IA. Un bot que pida la página mil veces cuesta mil pares de lecturas y ni una sola
 * petición a la bolsa (ADR-003, ADR-009).
 *
 * `null` es la respuesta de un slug inexistente, uno quemado, uno mal formado, uno cuyo link salió del grupo y uno cuyo
 * grupo se borró: los cinco son el mismo `404`, así que quien prueba slugs no aprende nada. Un slug mal formado NO
 * cuesta ninguna lectura.
 *
 * El mapeo va por **lista explícita de campos**, nunca por `...preview`: es lo que garantiza que `summary`, las
 * habilidades, los idiomas, la procedencia por campo, el estado del preview, quién lo compartió o el grupo no salgan
 * jamás, ni siquiera el día que el preview gane un campo nuevo (ADR-027 §3).
 */
@Injectable()
export class GetPublicPreview {
  constructor(
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(JOB_LINK_REPOSITORY) private readonly links: JobLinkRepository,
  ) {}

  async execute(slug: string): Promise<PublicPreviewResponse | null> {
    if (!isValidPublicSlug(slug)) {
      return null;
    }
    const relation = await this.groupLinks.findByPublicSlug(slug);
    if (relation === null) {
      return null;
    }
    const link = await this.links.findById(relation.linkId);
    if (link === null) {
      return null;
    }
    return { slug, link: toPublicJobPreview(link) };
  }
}

/** La vacante con **exactamente** los campos publicables, uno a uno. */
function toPublicJobPreview(link: JobLink): PublicJobPreview {
  const preview = link.preview;
  // La URL de la oferta se publica saneada (D6): sin credenciales ni parámetros de campaña y conservando el fragmento.
  // Si no es `http(s)`, se omite y la página se pinta sin enlace a la oferta original.
  const displayUrl = publicHttpUrl(link.displayUrl);
  const title = textOf(preview?.title);
  const company = textOf(preview?.company);
  const location = textOf(preview?.location);
  const modality = valueOf(preview?.modality);
  const seniority = valueOf(preview?.seniority);
  const salary = valueOf(preview?.salary);
  const postedAt = textOf(preview?.postedAt);
  const expiresAt = textOf(preview?.expiresAt);
  return {
    platform: link.platform,
    ...(displayUrl === null ? {} : { displayUrl }),
    ...(title === undefined ? {} : { title }),
    ...(company === undefined ? {} : { company }),
    ...(location === undefined ? {} : { location }),
    ...(modality === undefined ? {} : { modality }),
    ...(seniority === undefined ? {} : { seniority }),
    ...(salary === undefined ? {} : { salary }),
    ...(postedAt === undefined ? {} : { postedAt }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

/** Una cadena con contenido. Un campo que la extracción dejó vacío o en `null` no se publica. */
function textOf(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Lo guardado, o nada cuando la extracción dijo que la página no lo decía. */
function valueOf<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}
