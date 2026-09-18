import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65_535);
const positiveInt = z.coerce.number().int();

/**
 * Configuración de `worker` (D8 de bootstrap-monorepo). Igual que la de `api` salvo el puerto: el worker
 * solo escucha en `WORKER_HEALTH_PORT` para exponer su salud (D9). Todas obligatorias salvo `APP_VERSION`.
 * El worker es quien lee las `S3_*` que usa (las del snapshot, D12 de link-enrichment); `S3_BUCKET`, el de los CVs,
 * sigue solo en `.env.example` hasta que el módulo `cv` lo lea.
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
    // `deploy-prod` cambiar de proveedor sin tocar código. `S3_BUCKET` (CVs) no se valida: nadie lo lee todavía.
    S3_ENDPOINT: z.string().regex(/^https?:\/\/\S+$/),
    // MinIO la ignora, pero la firma de la petición la exige.
    S3_REGION: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    // Bucket de las copias comprimidas de la página descargada, con expiración a 30 días (la crea `minio-init`).
    S3_SNAPSHOTS_BUCKET: z.string().min(1),
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
