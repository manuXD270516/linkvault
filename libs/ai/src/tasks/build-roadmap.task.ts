import {
  buildRoadmapInputSchema,
  enforceRoadmapVerified,
  roadmapSchema,
  type BuildRoadmapInput,
  type Roadmap,
  type RoadmapItem,
  type RoadmapResource,
} from '@linkvault/shared';
import type { AiTask, Rng } from '../domain/task';
import {
  isCatalogHit,
  searchCatalog,
  type CatalogResource,
} from '../infrastructure/catalog/search-catalog';

// Tarea `build-roadmap` (study-roadmap): plan de estudio desde missingSkills + catálogo curado.
// `personal` y no cacheable. Sin `degrade`: salida inválida no inventa roadmap verificado.
// Tras parsear la salida del modelo se fuerza `verified` con hits de `searchCatalog`.

export type { BuildRoadmapInput } from '@linkvault/shared';

/** Salida validada + post-proceso `verified` (el modelo no puede mentir la marca). */
export const buildRoadmapOutputSchema = roadmapSchema.transform((roadmap) =>
  enforceRoadmapVerified(roadmap, isCatalogHit),
);
export type BuildRoadmapOutput = Roadmap;

function catalogToResource(entry: CatalogResource): RoadmapResource {
  return { ...entry, verified: true };
}

function priorityFor(
  importance: 'must' | 'nice',
  indexAmongSame: number,
): number {
  // must → 1–2; nice → 3–5. Acotado al contrato 1–5.
  if (importance === 'must') {
    return Math.min(1 + indexAmongSame, 2);
  }
  return Math.min(3 + indexAmongSame, 5);
}

/**
 * Camino solo-catálogo: si **todas** las missingSkills tienen ≥1 recurso en el seed, construye el
 * roadmap sin LLM. Si alguna falta, devuelve `null` (hay que llamar a `runTask`).
 */
export function buildRoadmapFromCatalogOnly(
  input: BuildRoadmapInput,
): Roadmap | null {
  const must = input.missingSkills.filter((s) => s.importance === 'must');
  const nice = input.missingSkills.filter((s) => s.importance === 'nice');
  const ordered = [...must, ...nice];

  const items: RoadmapItem[] = [];
  let mustIndex = 0;
  let niceIndex = 0;

  for (const missing of ordered) {
    const catalog = searchCatalog(missing.name);
    if (catalog.length === 0) return null;
    const index =
      missing.importance === 'must' ? mustIndex++ : niceIndex++;
    items.push({
      skill: missing.name,
      priority: priorityFor(missing.importance, index),
      estimatedWeeks: missing.importance === 'must' ? 2 : 1.5,
      resources: catalog.map(catalogToResource),
    });
  }

  return enforceRoadmapVerified({ items }, isCatalogHit);
}

/**
 * Muestra determinista para `synth`: catálogo primero; si no hay hit, un recurso inventado
 * `verified: false` (el transform lo refuerza).
 */
export function sampleBuildRoadmap(
  input: BuildRoadmapInput,
  rng: Rng,
): BuildRoadmapOutput {
  rng();
  const must = input.missingSkills.filter((s) => s.importance === 'must');
  const nice = input.missingSkills.filter((s) => s.importance === 'nice');
  const ordered = [...must, ...nice];

  let mustIndex = 0;
  let niceIndex = 0;
  const items: RoadmapItem[] = ordered.map((missing) => {
    const catalog = searchCatalog(missing.name);
    const index =
      missing.importance === 'must' ? mustIndex++ : niceIndex++;
    const resources: RoadmapResource[] =
      catalog.length > 0
        ? catalog.map(catalogToResource)
        : [
            {
              type: 'doc',
              title: `Guía de estudio: ${missing.name}`,
              url: null,
              provider: 'linkvault-synth',
              free: true,
              verified: false,
            },
          ];
    return {
      skill: missing.name,
      priority: priorityFor(missing.importance, index),
      estimatedWeeks: missing.importance === 'must' ? 2 : 1.5,
      resources,
    };
  });

  return enforceRoadmapVerified({ items }, isCatalogHit);
}

export const buildRoadmapTask: AiTask<BuildRoadmapInput, BuildRoadmapOutput> = {
  name: 'build-roadmap',
  promptVersion: 'v1',
  inputSchema: buildRoadmapInputSchema,
  outputSchema: buildRoadmapOutputSchema,
  requires: { jsonMode: true, maxContextTokens: 8_000 },
  temperature: 0,
  budget: { maxTokens: 2_048, maxAttempts: 2 },
  dataSensitivity: 'personal',
  cacheable: false,
  sample: sampleBuildRoadmap,
};
