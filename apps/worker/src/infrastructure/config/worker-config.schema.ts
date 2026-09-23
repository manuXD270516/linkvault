import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65_535);
const positiveInt = z.coerce.number().int();

/**
 * Configuración de `worker` (D8 de bootstrap-monorepo). Igual que la de `api` salvo el puerto: el worker
 * solo escucha en `WORKER_HEALTH_PORT` para exponer su salud (D9). Todas obligatorias salvo `APP_VERSION`.
 * El worker lee **todas** las `S3_*`: las del snapshot del enriquecimiento (D12 de link-enrichment) y `S3_BUCKET`,
 * el de los CV, desde que el módulo `cv` lee el archivo para extraer su texto y lo borra (ADR-028 §7 y §8).
 */
export const workerConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    WORKER_HEALTH_PORT: port,
    MONGO_URI: z.string().regex(/^mongodb(\+srv)?:\/\/\S+$/),
    REDIS_URL: z.string().regex(/^rediss?:\/\/\S+$/),
    // `none` o lista ordenada de proveedores de IA (design-v0.2 §4.4). Aquí solo se valida la forma: los identificadores
    // conocidos, `AI_MOCK_MODE` (exigido solo si la cadena incluye `mock`) y el resto de reglas viven en `parseAiConfig`
    // de `@linkvault/ai` (D12 de ai-gateway-core, ADR-018 §2).
    AI_CHAIN: z.union([
      z.literal('none'),
      z.string().regex(/^[a-z0-9-]+(,[a-z0-9-]+)*$/),
    ]),
    FEATURE_HEADLESS_EXTRACTION: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true'),
    FEATURE_SEARCH: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    FEATURE_LINK_FRESHNESS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    LINK_FRESHNESS_INTERVAL_DAYS: positiveInt.min(1).max(90).default(7),
    LINK_FRESHNESS_BATCH_LIMIT: positiveInt.min(1).max(500).default(50),
    MEILI_HOST: z
      .string()
      .default('')
      .refine((value) => value === '' || /^https?:\/\/\S+$/.test(value), {
        message: 'MEILI_HOST must be empty or an http(s) URL',
      }),
    MEILI_MASTER_KEY: z.string().default(''),
    MEILI_INDEX: z.string().min(1).default('lv_content'),
    SEARCH_SEMANTIC_RATIO: z.coerce.number().min(0).max(1).default(0.5),
    SEARCH_BACKFILL_RATE: z.coerce.number().int().min(1).max(1_000).default(5),
    LOG_LEVEL: z.enum([
      'fatal',
      'error',
      'warn',
      'info',
      'debug',
      'trace',
      'silent',
    ]),
    APP_VERSION: z.string().min(1).optional(),
    // --- Enriquecimiento de links (D6 y D7 de link-enrichment, ADR-003, ADR-022) ---
    // Plazo de una descarga. También es lo que dura la exclusión del host mientras se descarga (D6), así que
    // subirlo retiene el host más tiempo; por encima de un minuto ninguna página de una bolsa de empleo es
    // razonable y el plazo total del link (`ENRICH_DEADLINE_MS`) se comería entero en la etapa 2.
    ENRICH_FETCH_TIMEOUT_MS: positiveInt.min(1_000).max(60_000),
    // Tamaño máximo del HTML, cortando el flujo al superarlo (D6). La página más grande que medimos pesaba 287 KB;
    // el margen cubre sitios peores sin dejar que una descarga infinita llene la memoria del worker.
    ENRICH_MAX_BYTES: positiveInt.min(65_536).max(33_554_432),
    // Espera mínima entre dos peticiones al mismo host. La espera efectiva es el máximo entre esta y el
    // `Crawl-delay` del grupo aplicable del `robots.txt` (D6): el sitio puede pedir más, nunca menos. Sin un
    // mínimo real dejaría de ser cortesía, que es lo que ADR-003 exige.
    ENRICH_DOMAIN_DELAY_MS: positiveInt.min(250).max(300_000),
    // Plazo total por link, repartido entre las etapas de la cadena: lo que queda al llegar a la IA es lo que
    // recibe su `ctx.signal`, y si no queda nada la etapa se salta (D7).
    ENRICH_DEADLINE_MS: positiveInt.min(5_000).max(300_000),
    // Vida de la caché de `robots.txt` por host en Redis, incluida la respuesta que prohíbe (D6): releerlo en
    // cada link sería una petición extra por descarga al mismo sitio al que estamos pidiendo cortesía.
    ENRICH_ROBOTS_TTL_SECONDS: positiveInt.min(60).max(604_800),
    // Agente identificable con URL de contacto (ADR-003): es lo que permite a un sitio reconocernos, escribirnos
    // o escribir una regla para nosotros en su `robots.txt`, y es el agente contra el que se resuelve el grupo
    // aplicable de ese fichero.
    ENRICH_USER_AGENT: z.string().min(1),
    // Jobs de enriquecimiento en curso en el proceso. Es un tope global, no por host: la exclusión por host la
    // hace el mutex de Redis (D6).
    ENRICH_CONCURRENCY: positiveInt.min(1).max(64),
    // Veces que un job puede volver a aplazarse por encontrar su host ocupado antes de darse por fallido
    // transitorio (`host_busy`, D5). El valor holgado es deliberado: un job aplazado no consume nada mientras
    // está `delayed`, y cincuenta links de un mismo host rebotan cientos de veces antes de que les llegue su
    // turno. El tope solo existe para que un host que nunca se libera no rebote para siempre.
    ENRICH_MAX_DEFERRALS: positiveInt.min(1).max(10_000),
    // --- Almacenamiento de objetos (D12 de link-enrichment, ADR-022) ---
    // Endpoint compatible con S3: MinIO en local y cualquier proveedor S3 en producción, que es lo que permite a
    // `deploy-prod` cambiar de proveedor sin tocar código.
    S3_ENDPOINT: z.string().regex(/^https?:\/\/\S+$/),
    // MinIO la ignora, pero la firma de la petición la exige.
    S3_REGION: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    // Bucket de las copias comprimidas de la página descargada, con expiración a 30 días (la crea `minio-init`).
    S3_SNAPSHOTS_BUCKET: z.string().min(1),
    // Bucket de los CV, privado y sin expiración. El worker es el **único** lector de esos bytes (ADR-028 §5) y
    // quien los borra desde `delete-cv-file`. S3 exige de 3 a 63 caracteres en el nombre.
    S3_BUCKET: z.string().min(3).max(63),
    // --- Lectura del CV (D9 de cv-upload-extract, ADR-028 §7) ---
    // Plazo de la extracción entera: un PDF malformado puede tener a un parser dando vueltas. Vencido, el CV queda
    // en `failed` con `unreadable_file`. Por debajo de un segundo ningún PDF real da tiempo a abrirse; por encima de
    // dos minutos el `lockDuration` del consumidor pasaría de lo razonable y un CV "en lectura" duraría demasiado.
    CV_EXTRACTION_TIMEOUT_MS: positiveInt.min(1_000).max(120_000),
    // Extracciones a la vez. El parseo es trabajo de CPU en el hilo principal: con 1, un PDF pesado retrasa al
    // siguiente CV y no a todo el worker. El tope de 4 existe para que subirlo sea una decisión y no un descuido.
    CV_EXTRACT_CONCURRENCY: positiveInt.min(1).max(4),
    // --- Análisis de encaje (cv-match-suggestions, ADR-030) ---
    // Plazo de una ejecución de `match-cv` en el worker, en milisegundos. Es el `ctx.signal` de `runTask` y el
    // tope del job; vencido, el análisis queda `failed` con `internal_error`.
    MATCH_ANALYSIS_TIMEOUT_MS: positiveInt.min(1_000).max(300_000),
    // Análisis a la vez en el proceso. El tope de 4 existe para que subirlo sea una decisión y no un descuido.
    MATCH_ANALYSIS_CONCURRENCY: positiveInt.min(1).max(4),
    // Plazo tras el cual un `running` se considera vencido al escribir el resultado. **Ha de ser el mismo valor
    // que recibe `api`**: la escritura condicionada a "no vencido" vive aquí, no en la API. Quien comprueba la
    // pareja con `MATCH_ANALYSIS_TIMEOUT_MS` es `assertAnalysisDeadlines` en el arranque de cada proceso.
    MATCH_ANALYSIS_MAX_AGE_MS: positiveInt.min(1_000).max(600_000),
    // --- Notificaciones de producto (ADR-035) ---
    WEB_BASE_URL: z
      .string()
      .regex(/^https?:\/\/[^\s/]+(\/[^\s?#]*[^\s/?#])?$/),
    MAIL_PROVIDER: z.enum(['smtp', 'resend', 'capture']),
    MAIL_FROM: z.string().min(1),
    MAIL_SMTP_HOST: z.string().min(1).optional(),
    MAIL_SMTP_PORT: port.optional(),
    RESEND_API_KEY: z.string().optional(),
    VAPID_PUBLIC_KEY: z.string().optional().default(''),
    VAPID_PRIVATE_KEY: z.string().optional().default(''),
    VAPID_SUBJECT: z.string().optional().default(''),
  })
  // Cada issue lleva `path` con la variable: `parseEnv` descarta los issues que no nombran ninguna.
  .superRefine((config, ctx) => {
    if (config.ENRICH_DEADLINE_MS < config.ENRICH_FETCH_TIMEOUT_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['ENRICH_DEADLINE_MS'],
        message: 'ENRICH_DEADLINE_MS must be >= ENRICH_FETCH_TIMEOUT_MS',
      });
    }
  });

export type WorkerConfig = z.output<typeof workerConfigSchema>;
