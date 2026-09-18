import { z } from 'zod';

// Contratos del preview de una vacante (D11 de link-enrichment). La forma del preview y la de su procedencia por campo
// se definen aquí UNA sola vez: los schemas de Mongoose de `api` y del worker se derivan de esta definición, porque dos
// formas paralelas con `strict: true` descartarían campos en silencio.
//
// Hay dos formas del preview y la diferencia es de fondo:
// - `jobPreviewSchema` (design-v0.2 §4.7) es **estricto**: es la salida de `extract-job`, donde un campo que falta es un
//   error del modelo que dispara el prompt de reparación.
// - `storedPreviewSchema` es su `.partial()`: es lo que se guarda y lo que sale por la API, donde una vacante de la que
//   solo se pudo leer el título es un resultado legítimo (`partial`), no un fallo de validación.
//
// Ninguna cadena del preview es vacía: la ausencia de un dato se dice con `null` (o con la ausencia del campo en lo
// guardado), nunca con `''`. Un `title: ''` que validara haría `enriched` a un link sin título.

/** Máximo de habilidades de un preview (design-v0.2 §4.7). */
export const PREVIEW_SKILLS_MAX = 40;

/** Máximo de caracteres del resumen de un preview (design-v0.2 §4.7). */
export const PREVIEW_SUMMARY_MAX_LENGTH = 600;

/** Modalidad de trabajo. `unknown` es una respuesta válida: la página puede no decirlo. */
export const jobModalitySchema = z.enum([
  'remote',
  'hybrid',
  'onsite',
  'unknown',
]);
export type JobModality = z.infer<typeof jobModalitySchema>;

/** Nivel de experiencia pedido. `unknown` es una respuesta válida: la página puede no decirlo. */
export const jobSenioritySchema = z.enum([
  'intern',
  'junior',
  'mid',
  'senior',
  'lead',
  'unknown',
]);
export type JobSeniority = z.infer<typeof jobSenioritySchema>;

/** Periodo del salario publicado. */
export const salaryPeriodSchema = z.enum(['month', 'year', 'hour']);
export type SalaryPeriod = z.infer<typeof salaryPeriodSchema>;

/** Salario publicado. Cada parte es `null` por separado: hay ofertas que solo dicen el mínimo o solo la moneda. */
export const jobSalarySchema = z.strictObject({
  min: z.number().nullable(),
  max: z.number().nullable(),
  currency: z.string().min(1).nullable(),
  period: salaryPeriodSchema.nullable(),
});
export type JobSalary = z.infer<typeof jobSalarySchema>;

/** Habilidad pedida por la vacante y si es obligatoria. */
export const jobSkillSchema = z.strictObject({
  name: z.string().min(1),
  required: z.boolean(),
});
export type JobSkill = z.infer<typeof jobSkillSchema>;

/** Idioma pedido por la vacante y el nivel que exige, cuando lo dice. */
export const jobLanguageSchema = z.strictObject({
  name: z.string().min(1),
  level: z.string().min(1).nullable(),
});
export type JobLanguage = z.infer<typeof jobLanguageSchema>;

/**
 * Preview completo de una vacante (design-v0.2 §4.7), **estricto en las dos direcciones**: exige todos los campos y
 * rechaza los que no conoce. Es el contrato de salida de `extract-job`, no el de lo guardado: una salida a la que le
 * falta un campo o que inventa uno nuevo va al prompt de reparación en vez de entrar en la base de datos.
 *
 * `postedAt` y `expiresAt` son fechas sin hora: lo que publica una bolsa es un día, no un instante.
 */
export const jobPreviewSchema = z.strictObject({
  title: z.string().min(1),
  company: z.string().min(1).nullable(),
  location: z.string().min(1).nullable(),
  modality: jobModalitySchema,
  seniority: jobSenioritySchema,
  salary: jobSalarySchema.nullable(),
  skills: z.array(jobSkillSchema).max(PREVIEW_SKILLS_MAX),
  languages: z.array(jobLanguageSchema),
  summary: z.string().max(PREVIEW_SUMMARY_MAX_LENGTH),
  postedAt: z.iso.date().nullable(),
  expiresAt: z.iso.date().nullable(),
});
export type JobPreview = z.infer<typeof jobPreviewSchema>;

/**
 * Salida de la tarea `extract-job` (D7): el discriminador va **antes** que los campos. Con un schema que exige `title`,
 * un modelo a temperatura 0 inventa un título para un vídeo de YouTube; pudiendo decir que eso no es una vacante,
 * el motivo `not_a_job` tiene de dónde salir.
 *
 * `preview` puede ser `null` con `isJobPosting: true`: la IA reconoce una vacante y aun así no consigue sacarle campos,
 * que es uno de los casos de `no_data` (D5). Cuando `isJobPosting` es `false`, el preview se ignora aunque venga.
 */
export const extractJobOutputSchema = z.strictObject({
  isJobPosting: z.boolean(),
  preview: jobPreviewSchema.nullable(),
});
export type ExtractJobOutput = z.infer<typeof extractJobOutputSchema>;

/**
 * Preview tal y como se guarda y tal y como sale por la API: todos los campos opcionales, porque la extracción casi
 * nunca los consigue todos. Sigue rechazando los campos que no conoce.
 */
export const storedPreviewSchema = jobPreviewSchema.partial();
export type StoredPreview = z.infer<typeof storedPreviewSchema>;

/**
 * Nombres de los campos del preview, en el orden en que se declaran. Es la lista de la que se derivan la procedencia por
 * campo y los schemas de Mongoose; un test comprueba que no se separa de `jobPreviewSchema`.
 */
export const PREVIEW_FIELD_NAMES = [
  'title',
  'company',
  'location',
  'modality',
  'seniority',
  'salary',
  'skills',
  'languages',
  'summary',
  'postedAt',
  'expiresAt',
] as const;
export type PreviewFieldName = (typeof PREVIEW_FIELD_NAMES)[number];

/** Si ese nombre es un campo del preview. Lo usa la edición manual para responder `preview_field_unknown`. */
export function isPreviewFieldName(name: string): name is PreviewFieldName {
  return (PREVIEW_FIELD_NAMES as readonly string[]).includes(name);
}

/**
 * Identificador del extractor que produjo un valor automático (`json-ld`, `metadata`, `ai:extract-job`…). Es una cadena
 * libre y no un enum a propósito: la cadena de D3 tiene un punto de extensión (el eslabón headless) y un enum obligaría
 * a migrar lo guardado para añadir un extractor.
 */
export const previewExtractorIdSchema = z.string().min(1).max(64);

/** Quién escribió un campo a mano, tal y como se guarda: solo su identificador. */
export const previewAuthorIdSchema = z.string().min(1);

/**
 * Quién escribió un campo a mano, tal y como sale por la API: la tarjeta dice "Escrito por Ana", no un identificador.
 * `api` resuelve el nombre con `LINK_USER_DIRECTORY`; el worker nunca lo necesita.
 */
export const previewAuthorSchema = z.strictObject({
  userId: z.string().min(1),
  displayName: z.string().min(1),
});
export type PreviewAuthor = z.infer<typeof previewAuthorSchema>;

/**
 * Claves de una entrada de procedencia, para el test tabular que compara los dos schemas de Mongoose (D11). `extractor`
 * y `by` no conviven nunca: cuál de las dos está lo decide `source`.
 */
export const PREVIEW_SOURCE_ENTRY_KEYS = [
  'value',
  'source',
  'extractor',
  'by',
  'at',
  'replaced',
] as const;

/**
 * Procedencia de un campo (D4 de link-enrichment, ADR-010 sin `confidence`). Unión discriminada por `source` en vez de
 * campos opcionales sueltos: un valor automático lleva siempre su extractor y nunca un autor, uno manual al revés, y
 * `replaced` —el valor automático que desplazó la edición, lo que permite "Volver a lo extraído"— solo existe en el
 * manual. El orden total de la cadena (D3) decide los empates, así que no hay confianza numérica que guardar.
 */
function previewFieldSchema<Value extends z.ZodType, By extends z.ZodType>(
  value: Value,
  by: By,
) {
  return z.discriminatedUnion('source', [
    z.strictObject({
      value,
      source: z.literal('auto'),
      extractor: previewExtractorIdSchema,
      at: z.iso.datetime(),
    }),
    z.strictObject({
      value,
      source: z.literal('manual'),
      by,
      at: z.iso.datetime(),
      replaced: z
        .strictObject({ value, extractor: previewExtractorIdSchema })
        .optional(),
    }),
  ]);
}

/**
 * Procedencia de cada campo del preview. Un campo sin entrada es un campo que nadie ha escrito todavía; las entradas
 * siguen la forma de `PREVIEW_FIELD_NAMES` y el tipo de su valor es el del campo en `jobPreviewSchema`.
 */
function previewSourcesSchemaWith<By extends z.ZodType>(by: By) {
  return z.strictObject({
    title: previewFieldSchema(jobPreviewSchema.shape.title, by).optional(),
    company: previewFieldSchema(jobPreviewSchema.shape.company, by).optional(),
    location: previewFieldSchema(
      jobPreviewSchema.shape.location,
      by,
    ).optional(),
    modality: previewFieldSchema(
      jobPreviewSchema.shape.modality,
      by,
    ).optional(),
    seniority: previewFieldSchema(
      jobPreviewSchema.shape.seniority,
      by,
    ).optional(),
    salary: previewFieldSchema(jobPreviewSchema.shape.salary, by).optional(),
    skills: previewFieldSchema(jobPreviewSchema.shape.skills, by).optional(),
    languages: previewFieldSchema(
      jobPreviewSchema.shape.languages,
      by,
    ).optional(),
    summary: previewFieldSchema(jobPreviewSchema.shape.summary, by).optional(),
    postedAt: previewFieldSchema(
      jobPreviewSchema.shape.postedAt,
      by,
    ).optional(),
    expiresAt: previewFieldSchema(
      jobPreviewSchema.shape.expiresAt,
      by,
    ).optional(),
  });
}

/** Procedencia tal y como se guarda: `by` es el identificador de quien escribió el campo. */
export const previewSourcesSchema = previewSourcesSchemaWith(
  previewAuthorIdSchema,
);
export type PreviewSources = z.infer<typeof previewSourcesSchema>;

/** Procedencia tal y como sale por la API: `by` ya resuelto a `{ userId, displayName }`. */
export const resolvedPreviewSourcesSchema =
  previewSourcesSchemaWith(previewAuthorSchema);
export type ResolvedPreviewSources = z.infer<
  typeof resolvedPreviewSourcesSchema
>;

/** Cota de cordura del nombre de un campo recibido en la edición: si no es uno del preview, lo juzga el dominio. */
export const PREVIEW_FIELD_NAME_INPUT_MAX_LENGTH = 64;

/**
 * Cuerpo de `PATCH /api/links/:id/preview`: `fields` son los valores que la persona escribe a mano y `revert` los campos
 * que vuelven a su valor automático anterior ("Volver a lo extraído").
 *
 * `fields` acepta campos que no conoce **a propósito**, igual que la URL demasiado larga de `links` no se rechaza aquí:
 * un campo desconocido tiene que salir como `preview_field_unknown` (400) nombrándolo, y no como el `validation_error`
 * genérico del pipe, que el SPA no sabría explicar. Lo que sí se valida aquí es el tipo de los campos que sí existen.
 * Los nombres de `revert` viajan como cadenas por la misma razón.
 */
export const updatePreviewRequestSchema = z.strictObject({
  fields: storedPreviewSchema.loose().optional(),
  revert: z
    .array(z.string().trim().min(1).max(PREVIEW_FIELD_NAME_INPUT_MAX_LENGTH))
    // Repetir un campo en el mismo cuerpo no aporta nada; más entradas que campos tiene el preview es ruido.
    .max(PREVIEW_FIELD_NAMES.length)
    .optional(),
});
export type UpdatePreviewRequest = z.infer<typeof updatePreviewRequestSchema>;

/**
 * Motivos de fallo del enriquecimiento (D5), lista cerrada. Los tres primeros no son errores nuestros y se cuentan
 * aparte: `robots_disallowed` es el sitio prohibiéndonos la lectura, `blocked` el sitio negándosela a nuestra petición
 * (`401`/`403`) y `rate_limited` el sitio pidiendo que volvamos más tarde (`429`). `host_busy` es nuestro turno que no
 * llegó a tiempo: el sitio no dijo nada, así que no es un bloqueo. `not_a_job` es lo compartido que no era una oferta,
 * distinto de `no_data`, que es la página leída de la que no salió ningún campo: una lleva a "quítalo" y la otra a
 * "reintenta o complétalo". El motivo nunca lleva el cuerpo de la respuesta ni la URL del usuario.
 */
export const enrichmentFailureReasonSchema = z.enum([
  'robots_disallowed',
  'blocked',
  'rate_limited',
  'host_busy',
  'not_a_job',
  'not_html',
  'too_large',
  'timeout',
  'http_error',
  'no_data',
  'retries_exhausted',
]);
export type EnrichmentFailureReason = z.infer<
  typeof enrichmentFailureReasonSchema
>;

/**
 * Motivos que no se reintentan: volver a pedir la página no cambiaría nada, porque no se nos permite leerla o porque lo
 * que hay no es una oferta. Todos los demás son transitorios, incluidos `rate_limited` y `host_busy`.
 */
export const NON_RETRYABLE_ENRICHMENT_REASONS = [
  'robots_disallowed',
  'blocked',
  'not_a_job',
] as const satisfies readonly EnrichmentFailureReason[];

/** Si merece la pena volver a pedir la lectura de un link que falló por ese motivo. */
export function isRetryableEnrichmentReason(
  reason: EnrichmentFailureReason,
): boolean {
  return !(
    NON_RETRYABLE_ENRICHMENT_REASONS as readonly EnrichmentFailureReason[]
  ).includes(reason);
}

/** Último fallo del enriquecimiento guardado en el link: su motivo y cuándo ocurrió, nada más. */
export const lastEnrichmentErrorSchema = z.strictObject({
  reason: enrichmentFailureReasonSchema,
  at: z.iso.datetime(),
});
export type LastEnrichmentError = z.infer<typeof lastEnrichmentErrorSchema>;

/**
 * Formas que sabe tomar el valor guardado de un campo del preview. No es un detalle de Mongo: es la lista cerrada de
 * tipos que produce `jobPreviewSchema`, escrita **sin framework** para que los dos schemas de Mongoose —el de `api` y
 * el del worker— la traduzcan cada uno a lo suyo sin poder separarse (D11). Añadir una forma nueva rompe la traducción
 * de los dos a la vez, porque cada una es un `Record` completo sobre este tipo.
 */
export type PreviewStoredType =
  | 'string'
  | 'date'
  | 'modality'
  | 'seniority'
  | 'salary'
  | 'skills'
  | 'languages';

/**
 * Forma guardada de cada campo del preview: la **única** definición de la que se derivan los dos schemas de Mongoose.
 * Añadir un campo aquí lo añade en los dos a la vez; quitarlo de uno solo rompe su test tabular de claves.
 *
 * `satisfies Record<PreviewFieldName, …>` es lo que impide olvidarse de un campo: un campo nuevo en `jobPreviewSchema`
 * sin entrada aquí no compila.
 */
export const PREVIEW_FIELD_STORED_TYPES = {
  title: 'string',
  company: 'string',
  location: 'string',
  modality: 'modality',
  seniority: 'seniority',
  salary: 'salary',
  skills: 'skills',
  languages: 'languages',
  summary: 'string',
  postedAt: 'date',
  expiresAt: 'date',
} as const satisfies Readonly<Record<PreviewFieldName, PreviewStoredType>>;

/** Claves de `salary` tal y como se guardan, para que los dos schemas declaren las mismas. */
export const PREVIEW_SALARY_KEYS = ['min', 'max', 'currency', 'period'] as const;

/** Claves de una habilidad guardada. */
export const PREVIEW_SKILL_KEYS = ['name', 'required'] as const;

/** Claves de un idioma guardado. */
export const PREVIEW_LANGUAGE_KEYS = ['name', 'level'] as const;

/** Claves de `replaced`, el valor automático que desplazó una edición manual. */
export const PREVIEW_REPLACED_KEYS = ['value', 'extractor'] as const;
