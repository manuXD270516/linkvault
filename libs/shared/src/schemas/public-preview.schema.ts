import { z } from 'zod';
import { publicSlugSchema } from '../links/public-slug';
import {
  jobModalitySchema,
  jobSalarySchema,
  jobSenioritySchema,
} from './preview.schema';
import { platformSchema } from './link.schema';

// Contrato de lo que sale en una página pública (D6 y D10 de public-preview-share, ADR-027 §3). Es la garantía escrita
// de "qué no sale nunca": un `strictObject` con **exactamente** los campos publicables, de modo que `summary`,
// habilidades, idiomas, procedencia por campo, quién compartió el link o el grupo no puedan colarse ni por un
// `...preview` despistado ni por un campo nuevo del preview.
//
// El mapeo que lo produce parte de una lista explícita de campos, y la plantilla HTML solo recibe este objeto, así que
// no puede pintar lo que no le llega.

/**
 * La vacante tal y como se publica. Todo opcional menos `platform`: un link recién compartido aún no se ha leído y se
 * publica igual, con la etiqueta derivada de su URL.
 *
 * `displayUrl` es la URL de la oferta original **ya saneada** por `publicHttpUrl`: falta cuando esa URL no se puede
 * publicar, y entonces la página se muestra sin enlace a la oferta.
 */
export const publicJobPreviewSchema = z.strictObject({
  platform: platformSchema,
  displayUrl: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  company: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  modality: jobModalitySchema.optional(),
  seniority: jobSenioritySchema.optional(),
  salary: jobSalarySchema.optional(),
  postedAt: z.iso.date().optional(),
  expiresAt: z.iso.date().optional(),
});
export type PublicJobPreview = z.infer<typeof publicJobPreviewSchema>;

/** Respuesta de `GET /api/public/previews/:slug`. El `slug` viaja de vuelta para que el SPA sepa qué está pintando. */
export const publicPreviewResponseSchema = z.strictObject({
  slug: publicSlugSchema,
  link: publicJobPreviewSchema,
});
export type PublicPreviewResponse = z.infer<typeof publicPreviewResponseSchema>;

/**
 * Cortes de las etiquetas Open Graph, en code points (D5). WhatsApp enseña alrededor de 65 caracteres del título y unos
 * 150 de la descripción, pero cada app recorta distinto: se corta por arriba, holgado, y que cada una recorte lo suyo.
 */
export const OG_TITLE_MAX_LENGTH = 100;
export const OG_DESCRIPTION_MAX_LENGTH = 200;
