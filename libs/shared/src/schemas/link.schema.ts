import { z } from 'zod';
import { groupNameSchema } from './group.schema';
import {
  commentsSummarySchema,
  shareNoteSchema,
  shareNoteTextSchema,
} from './group-link-comment.schema';
import { linkSharerSchema } from './link-sharer.schema';
import {
  lastEnrichmentErrorSchema,
  resolvedPreviewSourcesSchema,
  storedPreviewSchema,
} from './preview.schema';

// Contratos HTTP del módulo `links` (D8 de job-links). Los límites de negocio (2048 caracteres de URL y 20 000 de texto
// importado) NO se validan aquí: los juzga el dominio, para que una URL demasiado larga responda `invalid_url` (400) y
// un texto pasado de largo `text_too_long` (400), en vez del `validation_error` genérico del pipe, que el SPA no sabría
// explicar. Lo que sí hay son cotas de cordura, muy por encima de las de negocio, que evitan gastar CPU en una cadena
// arbitrariamente larga antes de llegar al dominio (mismo patrón que el código de invitación en `groups`).

/** Longitud máxima de una URL guardada (spec links/job-link). La juzga el dominio, no este contrato. */
export const LINK_URL_MAX_LENGTH = 2048;

/** Cota de cordura de la URL recibida: cuatro veces el límite de negocio. */
export const LINK_URL_INPUT_MAX_LENGTH = 8192;

/** Longitud máxima del texto de una importación (spec links/sharing). La juzga el dominio, no este contrato. */
export const IMPORT_TEXT_MAX_LENGTH = 20_000;

/** Cota de cordura del texto recibido: diez veces el límite de negocio. */
export const IMPORT_TEXT_INPUT_MAX_LENGTH = 200_000;

/** Cota de cordura de un identificador recibido en el cuerpo: su formato lo juzga el dominio (404 uniforme). */
export const LINK_IDENTIFIER_INPUT_MAX_LENGTH = 64;

/** Cota de cordura del cursor opaco recibido: un cursor manipulado lo rechaza el caso de uso nombrando `cursor`. */
export const LINK_CURSOR_INPUT_MAX_LENGTH = 128;

/** Tamaño de página por defecto y máximo de los listados de links (spec links/sharing). */
export const LINK_PAGE_DEFAULT_LIMIT = 20;
export const LINK_PAGE_MAX_LIMIT = 50;

/**
 * Plataformas con canonicalizador propio (ADR-008). `generic` es el caso de una URL que ningún canonicalizador reconoce:
 * no tiene `externalJobId` y se deduplica por el hash de la URL normalizada.
 */
export const platformSchema = z.enum([
  'linkedin',
  'computrabajo',
  'indeed',
  'trabajopolis',
  'getonboard',
  'generic',
]);
export type Platform = z.infer<typeof platformSchema>;

/**
 * Estado del preview de una vacante. `pending` lo pone `api` al guardar el link y al pedir su relectura; los otros
 * cuatro los escribe el worker al terminar el enriquecimiento (D5 de link-enrichment), salvo `manual`, que también lo
 * pone la edición a mano. `pending` significa dos cosas para quien mira —"se está leyendo" y "nadie la ha leído
 * todavía"—, y por eso el link guarda además `previewRequestedAt`.
 */
export const previewStatusSchema = z.enum([
  'pending',
  'enriched',
  'partial',
  'failed',
  'manual',
]);
export type PreviewStatus = z.infer<typeof previewStatusSchema>;

/** Identificador recibido en el cuerpo: solo cadena no vacía; su formato lo juzga el dominio. */
const identifierInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(LINK_IDENTIFIER_INPUT_MAX_LENGTH);

/**
 * Cuerpo de `POST /api/links`. Sin `groupId` el link queda solo en la lista privada de quien lo guarda.
 *
 * `note` es la nota de quien comparte (D3 de group-comments). Se normaliza **primero**: una nota que queda vacía equivale
 * a no enviarla, también sin `groupId`, y sale del cuerpo ya validado. Con texto, exige `groupId` y nombra `note` si
 * falta: en la lista privada no hay nadie a quien dejarle una nota.
 */
export const saveLinkRequestSchema = z
  .object({
    url: z.string().trim().min(1).max(LINK_URL_INPUT_MAX_LENGTH),
    groupId: identifierInputSchema.optional(),
    // Vacía tras normalizar → `undefined`, como si no se hubiera enviado. Sigue siendo un `z.object` (con `shape`) porque
    // el SPA valida sus campos uno a uno.
    note: shareNoteTextSchema
      .transform((note) => (note.length === 0 ? undefined : note))
      .optional(),
  })
  .superRefine((request, context) => {
    if (request.note !== undefined && request.groupId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'A note needs a group',
      });
    }
  });
export type SaveLinkRequest = z.infer<typeof saveLinkRequestSchema>;

/**
 * Cuerpo de `POST /api/links/import`. El texto NO se recorta con `trim`: sus espacios y saltos de línea son parte del
 * chat pegado y el dominio mide lo que el usuario envió.
 */
export const importLinksRequestSchema = z.object({
  text: z.string().min(1).max(IMPORT_TEXT_INPUT_MAX_LENGTH),
  groupId: identifierInputSchema.optional(),
});
export type ImportLinksRequest = z.infer<typeof importLinksRequestSchema>;

// Quién compartió un link en un grupo: vive en `link-sharer.schema.ts` para que lo usen también los comentarios.
export { linkSharerSchema, type LinkSharer } from './link-sharer.schema';

/**
 * Link tal y como lo ven las listas y las respuestas de guardado. `normalizedUrl` es solo identidad: lo que el SPA abre
 * es `displayUrl`, la primera URL que escribió una persona (D2). `sharedBy` falta en la lista privada, donde no hay con
 * quién compartir; `sharedAt` lleva ahí la fecha de guardado, para que la lista del SPA sea la misma en ambas vistas.
 *
 * Lo del enriquecimiento va **opcional** (D11 de link-enrichment): un link recién guardado no tiene preview, ni
 * procedencia, ni motivo de fallo, y un link de antes de este change tampoco. `previewSources` sale con `by` ya resuelto
 * a `{ userId, displayName }`: la tarjeta dice "Escrito por Ana", no un identificador.
 *
 * `previewVersion` NO es opcional: todo link tiene una desde el alta, y es lo que permite a quien recibe un aviso por
 * el canal de eventos descartar el que llega tarde en vez de pintar un preview viejo encima de uno nuevo (D9).
 *
 * `previewRequestedAt` es cuándo se pidió leer la oferta, y es lo que le da sentido a un `pending` (D5): uno reciente es
 * "Leyendo la oferta…" y uno viejo, "Sin vista previa todavía". Es opcional porque los links guardados antes de este
 * change no lo tienen; al mapear se responde con `createdAt`, que es cuando se pidió su lectura por primera vez.
 */
export const jobLinkSummarySchema = z.strictObject({
  id: z.string().min(1),
  normalizedUrl: z.string().min(1),
  displayUrl: z.string().min(1),
  platform: platformSchema,
  previewStatus: previewStatusSchema,
  previewVersion: z.number().int().positive(),
  preview: storedPreviewSchema.optional(),
  previewSources: resolvedPreviewSourcesSchema.optional(),
  lastEnrichmentError: lastEnrichmentErrorSchema.optional(),
  previewRequestedAt: z.iso.datetime().optional(),
  sharedBy: linkSharerSchema.optional(),
  sharedAt: z.iso.datetime(),
  // Solo en el listado de un grupo (D7 de group-comments): la nota de quien lo compartió, si la tiene, y el resumen de
  // sus comentarios en ese grupo. La lista privada no los lleva nunca.
  note: shareNoteSchema.optional(),
  comments: commentsSummarySchema.optional(),
});
export type JobLinkSummary = z.infer<typeof jobLinkSummarySchema>;

/**
 * Respuesta de `PATCH /api/links/:id/preview`: el link con su preview ya actualizado, con la misma forma que trae en un
 * listado, para que el SPA pueda reemplazar la tarjeta sin volver a pedir la lista.
 */
export const updatePreviewResponseSchema = jobLinkSummarySchema;
export type UpdatePreviewResponse = JobLinkSummary;

/**
 * Respuesta de `POST /api/links/:id/enrich` (`202`): el link ya de vuelta en `pending`, sin el motivo del fallo
 * anterior y con la lectura recién pedida.
 */
export const enrichLinkResponseSchema = jobLinkSummarySchema;
export type EnrichLinkResponse = JobLinkSummary;

/** Resultado de compartir en el destino: `created` si la relación es nueva, `already_there` si ya estaba. */
export const shareOutcomeSchema = z.enum(['created', 'already_there']);
export type ShareOutcome = z.infer<typeof shareOutcomeSchema>;

/** Grupo propio donde el link ya estaba, distinto del destino. */
export const alreadyInGroupSchema = z.strictObject({
  id: z.string().min(1),
  name: groupNameSchema,
});
export type AlreadyInGroup = z.infer<typeof alreadyInGroupSchema>;

/**
 * Respuesta de `POST /api/links`. `created` dice si la vacante no existía en LinkVault; `shared`, si la relación con el
 * destino es nueva; `sharedBy` solo viaja cuando ya estaba y dice quién la compartió primero.
 */
export const saveLinkResponseSchema = z.strictObject({
  link: jobLinkSummarySchema,
  created: z.boolean(),
  shared: shareOutcomeSchema,
  sharedBy: linkSharerSchema.optional(),
  alreadyInGroups: z.array(alreadyInGroupSchema),
});
export type SaveLinkResponse = z.infer<typeof saveLinkResponseSchema>;

/**
 * Respuesta de `POST /api/links/import`: `created` nuevas, `existing` ya presentes en el destino, `unrecognized` las que
 * no se pudieron leer ni guardar (no superan la normalización o su guardado falló) y `skipped` las que quedaron fuera
 * del tope por llamada.
 */
export const importLinksResponseSchema = z.strictObject({
  created: z.number().int().nonnegative(),
  existing: z.number().int().nonnegative(),
  unrecognized: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  links: z.array(jobLinkSummarySchema),
});
export type ImportLinksResponse = z.infer<typeof importLinksResponseSchema>;

/**
 * Query de los listados paginados. `limit` llega como texto en la URL, así que se convierte; el `cursor` es opaco y aquí
 * solo se acota: uno manipulado lo rechaza el caso de uso con `400` nombrando `cursor`.
 */
export const listLinksQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LINK_PAGE_MAX_LIMIT)
    .default(LINK_PAGE_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(LINK_CURSOR_INPUT_MAX_LENGTH).optional(),
});
export type ListLinksQuery = z.infer<typeof listLinksQuerySchema>;

/**
 * Página de un listado de links. `total` es el número de links del listado entero y no depende del tamaño de página;
 * `nextCursor` solo viaja cuando hay más.
 */
export const linkPageSchema = z.strictObject({
  items: z.array(jobLinkSummarySchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).optional(),
});
export type LinkPage = z.infer<typeof linkPageSchema>;
