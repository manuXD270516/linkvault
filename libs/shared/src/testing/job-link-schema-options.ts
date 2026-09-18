// Opciones con las que se declara `job_links` en Mongoose, como tabla de datos (D11 de link-enrichment).
//
// La colección la declaran **dos** schemas: el de `api`, que crea los documentos, y la vista parcial del worker, que
// solo lee y escribe el preview. Nada obliga a que los dos se declaren igual, y `minimize` o `strict` distintos a cada
// lado significan documentos distintos según quién escriba: un `preview` vacío que uno guarda y el otro borra, o un
// campo que uno acepta y el otro descarta en silencio.
//
// Por eso la expectativa vive aquí y no en cada test: el test tabular de cada lado la compara con su schema, igual que
// compara sus claves con `PREVIEW_FIELD_NAMES`. Esto es una tabla de expectativas, no la configuración: cada schema
// sigue declarando sus opciones donde se leen, en su propio `infrastructure/`.

/** Opciones de la raíz de `job_links`, las mismas en los dos schemas. */
export const JOB_LINK_SCHEMA_OPTIONS = {
  /** Sin conexión, una operación falla enseguida en vez de quedarse en cola. */
  bufferCommands: false,
  versionKey: false,
  /** Lo que no está declarado no se escribe. */
  strict: true,
  /** Un objeto vacío es un dato: "se leyó y no había nada" no es lo mismo que "nadie lo leyó". */
  minimize: false,
  collection: 'job_links',
} as const;

/** Opciones del subdocumento `lastEnrichmentError`, las mismas en los dos schemas. */
export const LAST_ENRICHMENT_ERROR_SCHEMA_OPTIONS = {
  /** Un subdocumento del link no es una entidad aparte y no lleva identificador propio. */
  _id: false,
  versionKey: false,
  strict: true,
  minimize: false,
} as const;
