import { z } from 'zod';
import { roadmapResourceTypeSchema } from '@linkvault/shared';
import seedJson from './resources.seed.json';

// Catálogo curado (study-roadmap, G3): `searchCatalog(skill)` sobre `resources.seed.json`.
// Sin búsqueda web. Los recursos del seed no llevan `verified`; el post-proceso lo fuerza.
// Import JSON (no `import.meta`/`readFileSync`): api/worker typecheck con `module: commonjs`.

/** Recurso del seed (sin `verified`). */
export const catalogResourceSchema = z.strictObject({
  type: roadmapResourceTypeSchema,
  title: z.string().min(1),
  url: z.string().url().nullable(),
  provider: z.string().min(1),
  free: z.boolean(),
});
export type CatalogResource = z.infer<typeof catalogResourceSchema>;

const seedFileSchema = z.record(
  z.string().min(1),
  z.array(catalogResourceSchema).min(1),
);

type SeedFile = z.infer<typeof seedFileSchema>;

/** Sinónimos / alias frecuentes → clave canónica del seed (minúsculas). */
const SYNONYMS: Readonly<Record<string, string>> = {
  ts: 'typescript',
  'type script': 'typescript',
  node: 'node.js',
  nodejs: 'node.js',
  'node js': 'node.js',
  nest: 'nestjs',
  nestjs: 'nestjs',
  postgres: 'postgresql',
  postgresql: 'postgresql',
  psql: 'postgresql',
  k8s: 'kubernetes',
  kube: 'kubernetes',
  golang: 'go',
  'go lang': 'go',
  reactjs: 'react',
  'react.js': 'react',
  react: 'react',
  angularjs: 'angular',
  'c sharp': 'c#',
  csharp: 'c#',
  dotnet: '.net',
  'dot net': '.net',
  'asp.net': '.net',
  amazon: 'aws',
  'amazon web services': 'aws',
  gcp: 'gcp',
  'google cloud': 'gcp',
  'google cloud platform': 'gcp',
  az: 'azure',
  'ms azure': 'azure',
  mongo: 'mongodb',
  mongoose: 'mongodb',
  'tailwind css': 'tailwind',
  tailwindcss: 'tailwind',
  'next js': 'next.js',
  nextjs: 'next.js',
  'c++': 'c/c++',
  cpp: 'c/c++',
  'c/c++': 'c/c++',
  fsharp: 'f#',
  'f sharp': 'f#',
};

const SEED: SeedFile = seedFileSchema.parse(seedJson);

/** Índice: forma normalizada → clave canónica del seed. */
const CANONICAL_BY_NORMALIZED = buildCanonicalIndex(SEED);

function buildCanonicalIndex(
  seed: SeedFile,
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const skill of Object.keys(seed)) {
    index.set(normalizeSkillKey(skill), skill);
  }
  for (const [alias, targetNormalized] of Object.entries(SYNONYMS)) {
    const canonical = index.get(normalizeSkillKey(targetNormalized));
    if (canonical !== undefined) {
      index.set(normalizeSkillKey(alias), canonical);
    }
  }
  return index;
}

/** Forma comparable: minúsculas, sin espacios sobrantes. Conserva `.` `#` `/` para claves como Node.js. */
export function normalizeSkillKey(skill: string): string {
  return skill.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Busca recursos curados para una habilidad. Case-insensitive y con sinónimos
 * (`ts` → TypeScript, `k8s` → Kubernetes, `nodejs` → Node.js). Sin hit → `[]`.
 */
export function searchCatalog(skill: string): readonly CatalogResource[] {
  const canonical = CANONICAL_BY_NORMALIZED.get(normalizeSkillKey(skill));
  if (canonical === undefined) return [];
  return SEED[canonical] ?? [];
}

/** Claves canónicas del seed (para tests / métricas de cobertura). */
export function catalogSkillNames(): readonly string[] {
  return Object.keys(SEED);
}

/**
 * Hit exacto de catálogo: mismo `type`, `title`, `provider`, `url` y `free` que una
 * entrada de `searchCatalog(skill)`.
 */
export function isCatalogHit(
  skill: string,
  resource: CatalogResource,
): boolean {
  return searchCatalog(skill).some(
    (entry) =>
      entry.type === resource.type &&
      entry.title === resource.title &&
      entry.url === resource.url &&
      entry.provider === resource.provider &&
      entry.free === resource.free,
  );
}
