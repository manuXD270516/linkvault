import { z } from 'zod';
import { platformSchema, previewStatusSchema } from './link.schema';

// Contratos HTTP del módulo `applications` (D10 de applications-tracking). Los identificadores que llegan en el cuerpo o
// en la query solo se acotan: su formato lo juzga el dominio, para que uno mal formado responda el mismo `404` que uno
// ajeno o inexistente (`link_not_found`, `application_not_found`), y en una lista de `linkIds` simplemente no aporte
// nada.

/**
 * Estados canónicos de ADR-004, en minúsculas y `snake_case`. Las transiciones son libres (ADR-024 §1): este contrato
 * valida que el estado exista, nunca el par origen → destino. El dominio de `applications` repite la lista y un test
 * comprueba que coinciden.
 */
export const APPLICATION_STATUSES = [
  'saved',
  'interested',
  'applied',
  'in_process',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
  'expired',
] as const;

/** Cierres: `accepted` no lo es. Desde un cierre se puede reabrir o corregir (ADR-024 §1). */
export const CLOSED_STATUSES = ['rejected', 'withdrawn', 'expired'] as const;

/**
 * Estados "de postulada": los únicos que admiten `appliedAt` en la petición (D3, ADR-024 §3). Con cualquier otro
 * destino, enviar `appliedAt` es un `400` que nombra el campo.
 */
export const APPLIED_AT_STATUSES = [
  'applied',
  'in_process',
  'offer',
  'accepted',
] as const;

/** El único estado que admite una etapa libre. */
export const STAGE_STATUS = 'in_process';

/** Longitud máxima de la etapa libre tras eliminar espacios exteriores. */
export const STAGE_LABEL_MAX_LENGTH = 60;

/** Longitud máxima de las notas privadas de una postulación. */
export const APPLICATION_NOTES_MAX_LENGTH = 2000;

/** Máximo de `linkIds` por consulta (tablero por página y estados compartidos de un grupo). */
export const APPLICATION_LINK_IDS_MAX = 50;

/** Cota de cordura de la lista de `linkIds` recibida en la query, antes de partirla. */
export const APPLICATION_LINK_IDS_INPUT_MAX_LENGTH = 4096;

/** Cota de cordura de un identificador recibido en el cuerpo: su formato lo juzga el dominio (404 uniforme). */
const IDENTIFIER_INPUT_MAX_LENGTH = 64;

export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

export type ClosedApplicationStatus = (typeof CLOSED_STATUSES)[number];
export type AppliedAtStatus = (typeof APPLIED_AT_STATUSES)[number];

/** `private` por defecto (ADR-015); `group` es el único interruptor para compartir el estado (ADR-024 §7). */
export const applicationVisibilitySchema = z.enum(['private', 'group']);
export type ApplicationVisibility = z.infer<typeof applicationVisibilitySchema>;

/** Etapa libre: de 1 a 60 caracteres tras eliminar espacios exteriores. */
export const stageLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(STAGE_LABEL_MAX_LENGTH);

/** Notas privadas: hasta 2000 caracteres; la cadena vacía las borra. Se guardan tal y como se escriben. */
export const applicationNotesSchema = z
  .string()
  .max(APPLICATION_NOTES_MAX_LENGTH);

/** `true` si el estado admite `appliedAt` en la petición. */
export function acceptsAppliedAt(status: ApplicationStatus): boolean {
  return (APPLIED_AT_STATUSES as readonly string[]).includes(status);
}

/** `true` si el estado es un cierre. */
export function isClosedStatus(status: ApplicationStatus): boolean {
  return (CLOSED_STATUSES as readonly string[]).includes(status);
}

const identifierInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(IDENTIFIER_INPUT_MAX_LENGTH);

/**
 * Fecha de postulación enviada por el SPA: ISO 8601 con zona (`Z` o desplazamiento). "Hoy" no viaja: el SPA omite el
 * campo y manda el reloj del servidor; otro día viaja como la medianoche local de ese día (D3). Que no sea futura lo
 * juzga el dominio con su reloj (`now + 24 h`), no este contrato.
 */
export const appliedAtInputSchema = z.iso.datetime({ offset: true });

/** Etapa en la petición: texto, `null` (sin etapa) u omitida (en `in_process` → `in_process`, se conserva). */
const stageLabelInputSchema = stageLabelSchema.nullable().optional();

interface StatusRuleInput {
  readonly status?: unknown;
  readonly stageLabel?: unknown;
  readonly appliedAt?: unknown;
}

/**
 * Reglas que cruzan campos, comunes al alta y al cambio de estado: una etapa con texto solo acompaña a `in_process`
 * (`null` se admite con cualquier estado y equivale a "sin etapa"), y `appliedAt` solo acompaña a los cuatro estados de
 * postulada. Cada violación nombra su campo.
 */
function checkStatusRules(body: StatusRuleInput, ctx: z.RefinementCtx): void {
  const status = applicationStatusSchema.safeParse(body.status);
  if (!status.success) return;
  if (typeof body.stageLabel === 'string' && status.data !== STAGE_STATUS) {
    ctx.addIssue({
      code: 'custom',
      path: ['stageLabel'],
      message: 'A stage is only allowed with in_process',
    });
  }
  if (body.appliedAt !== undefined && !acceptsAppliedAt(status.data)) {
    ctx.addIssue({
      code: 'custom',
      path: ['appliedAt'],
      message:
        'appliedAt is only allowed with applied, in_process, offer or accepted',
    });
  }
}

/** Cuerpo de `POST /api/applications`: seguir un link con el primer gesto. */
export const trackLinkRequestSchema = z
  .object({
    linkId: identifierInputSchema,
    status: applicationStatusSchema,
    stageLabel: stageLabelInputSchema,
    appliedAt: appliedAtInputSchema.optional(),
  })
  .superRefine(checkStatusRules);
export type TrackLinkRequest = z.infer<typeof trackLinkRequestSchema>;

/**
 * Cuerpo de `PATCH /api/applications/:id/status`. `version` es la que pintó quien pide: protege el estado y la etapa
 * frente a otra pestaña (ADR-024 §4). Pedir el mismo estado y la misma etapa responde `200` sin mirarla.
 * `groupId` opcional: contexto UI de un grupo que acota el fan-out de aviso (change notifications, D8).
 */
export const changeApplicationStatusRequestSchema = z
  .object({
    status: applicationStatusSchema,
    stageLabel: stageLabelInputSchema,
    appliedAt: appliedAtInputSchema.optional(),
    version: z.number().int().positive(),
    groupId: identifierInputSchema.optional(),
  })
  .superRefine(checkStatusRules);
export type ChangeApplicationStatusRequest = z.infer<
  typeof changeApplicationStatusRequestSchema
>;

/**
 * Cuerpo de `PATCH /api/applications/:id`: notas y visibilidad, con última escritura gana y sin tocar `version` ni
 * `statusChangedAt`. Hace falta al menos uno de los dos; un cuerpo sin ninguno es un `400` sin campos.
 */
export const updateApplicationRequestSchema = z
  .object({
    notes: applicationNotesSchema.optional(),
    visibility: applicationVisibilitySchema.optional(),
  })
  .refine((body) => body.notes !== undefined || body.visibility !== undefined, {
    message: 'Send notes, visibility or both',
  });
export type UpdateApplicationRequest = z.infer<
  typeof updateApplicationRequestSchema
>;

/**
 * `linkIds` en la query: identificadores separados por comas, sin espacios exteriores ni vacíos, sin repetir, de 1 a
 * 50. Cualquier fallo nombra `linkIds`. Un identificador mal formado no es un error: simplemente no aporta nada.
 */
export const linkIdListSchema = z
  .string()
  .max(APPLICATION_LINK_IDS_INPUT_MAX_LENGTH)
  .transform((value) => [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  ])
  .refine((ids) => ids.length >= 1 && ids.length <= APPLICATION_LINK_IDS_MAX, {
    message: `Between 1 and ${APPLICATION_LINK_IDS_MAX} link ids`,
  });

/** Query de `GET /api/applications`: sin `linkIds`, todas las postulaciones de quien pide. */
export const applicationListQuerySchema = z.object({
  linkIds: linkIdListSchema.optional(),
});
export type ApplicationListQuery = z.infer<typeof applicationListQuerySchema>;

/** Query de `GET /api/groups/:id/applications`: `linkIds` es obligatoria. */
export const groupTrackersQuerySchema = z.object({
  linkIds: linkIdListSchema,
});
export type GroupTrackersQuery = z.infer<typeof groupTrackersQuerySchema>;

/**
 * Ficha del link de una postulación, sin contexto de grupo (ADR-024 §5): basta para pintar la tarjeta del tablero y
 * abrir la oferta. Título y empresa faltan si el link no tiene preview.
 */
export const applicationLinkCardSchema = z.strictObject({
  id: z.string().min(1),
  displayUrl: z.string().min(1),
  platform: platformSchema,
  previewStatus: previewStatusSchema,
  title: z.string().min(1).optional(),
  company: z.string().min(1).optional(),
});
export type ApplicationLinkCard = z.infer<typeof applicationLinkCardSchema>;

/**
 * Postulación propia tal y como la ve su dueño en todas las respuestas (alta, cambios, tablero), con la ficha de su
 * link. `fitScore` / `fitScoreDegraded` se **derivan al leer** del último análisis `done` (D11): nadie los persiste en
 * la postulación. `fitScore` nunca viaja sin la marca, y nunca junto a `fitScoreDegraded: true` —un análisis básico
 * entrega la marca y ningún número—. La ausencia es campo ausente, nunca `0`.
 * `updatedAt` cambia con todo y ordena el tablero; `statusChangedAt` solo con el estado o la etapa.
 */
export const applicationSchema = z
  .strictObject({
    id: z.string().min(1),
    linkId: z.string().min(1),
    status: applicationStatusSchema,
    stageLabel: stageLabelSchema.optional(),
    visibility: applicationVisibilitySchema,
    notes: applicationNotesSchema,
    appliedAt: z.iso.datetime().optional(),
    statusChangedAt: z.iso.datetime(),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    link: applicationLinkCardSchema,
    fitScore: z.number().int().min(0).max(100).optional(),
    fitScoreDegraded: z.boolean().optional(),
  })
  .superRefine((application, ctx) => {
    if (
      application.fitScore !== undefined &&
      application.fitScoreDegraded === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['fitScoreDegraded'],
        message: 'fitScore never travels without fitScoreDegraded',
      });
    }
    if (
      application.fitScore !== undefined &&
      application.fitScoreDegraded === true
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['fitScore'],
        message: 'A degraded analysis publishes the flag and no score',
      });
    }
  });
export type Application = z.infer<typeof applicationSchema>;

/** Respuesta de `POST /api/applications` (`201`): `created` `false` si ya la seguía, con la postulación intacta. */
export const trackLinkResponseSchema = z.strictObject({
  application: applicationSchema,
  created: z.boolean(),
});
export type TrackLinkResponse = z.infer<typeof trackLinkResponseSchema>;

/** Respuesta de `GET /api/applications`: de la cambiada más recientemente a la más antigua. */
export const applicationListResponseSchema = z.strictObject({
  items: z.array(applicationSchema),
});
export type ApplicationListResponse = z.infer<
  typeof applicationListResponseSchema
>;

/**
 * Evento del historial. `from` falta en el primero; `fromStageLabel` y `stageLabel` son las etapas de origen y destino
 * si las había. El tipo de gesto ("avanzó", "corrigió", "cerró", "reabrió") se deriva al pintar (ADR-024 §1).
 */
export const applicationEventSchema = z.strictObject({
  id: z.string().min(1),
  from: applicationStatusSchema.optional(),
  to: applicationStatusSchema,
  fromStageLabel: stageLabelSchema.optional(),
  stageLabel: stageLabelSchema.optional(),
  at: z.iso.datetime(),
});
export type ApplicationEvent = z.infer<typeof applicationEventSchema>;

/** Respuesta de `GET /api/applications/:id/events`: del más antiguo al más reciente. */
export const applicationTimelineResponseSchema = z.strictObject({
  items: z.array(applicationEventSchema),
});
export type ApplicationTimelineResponse = z.infer<
  typeof applicationTimelineResponseSchema
>;

/**
 * Quien comparte su estado en la tarjeta de un grupo. Estricto a propósito: el grupo ve el nombre y el estado canónico,
 * nunca la etapa, las notas, el historial, `appliedAt`, `version` ni el identificador de la postulación (D6).
 */
export const groupTrackerSchema = z.strictObject({
  userId: z.string().min(1),
  displayName: z.string().min(1),
  status: applicationStatusSchema,
});
export type GroupTracker = z.infer<typeof groupTrackerSchema>;

/** Estados compartidos de un link del grupo, del último cambio de estado o de etapa más reciente al más antiguo. */
export const groupLinkTrackersSchema = z.strictObject({
  linkId: z.string().min(1),
  trackers: z.array(groupTrackerSchema),
});
export type GroupLinkTrackers = z.infer<typeof groupLinkTrackersSchema>;

/**
 * Respuesta de `GET /api/groups/:id/applications`: un elemento por cada link pedido que está compartido en el grupo,
 * también sin nadie que lo comparta (`trackers` vacío), para que el SPA sustituya lo que tenía de esos links.
 */
export const groupTrackersResponseSchema = z.strictObject({
  items: z.array(groupLinkTrackersSchema),
});
export type GroupTrackersResponse = z.infer<typeof groupTrackersResponseSchema>;
