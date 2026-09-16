import { createProjectGraphAsync, type ProjectGraph } from '@nx/devkit';
import { beforeAll, describe, expect, it } from 'vitest';

// Escenario "Proyectos de producto y sus targets" (spec platform/workspace), comprobado sobre el grafo real de
// Nx. Que el código de producción no importe proyectos type:test-util ni type:tooling no se comprueba aquí:
// el grafo no distingue imports de test y de producción; lo cubre el lint (filas de workspace-rules.spec.ts).

const BASE_TARGETS = ['lint', 'typecheck', 'test'] as const;

const PRODUCT_PROJECTS: Readonly<Record<string, readonly string[]>> = {
  api: [...BASE_TARGETS, 'build'],
  worker: [...BASE_TARGETS, 'build'],
  web: [...BASE_TARGETS, 'build'],
  shared: BASE_TARGETS,
  ai: BASE_TARGETS,
};

describe('workspace product projects', () => {
  let graph: ProjectGraph;

  beforeAll(async () => {
    // NX_DAEMON=false llega desde vitest.config.mts: dentro de Vitest la salida va por pipes y el daemon
    // heredaría el handle (ver README, "Problemas conocidos en Windows").
    graph = await createProjectGraphAsync({ exitOnError: false });
  }, 120_000);

  it.each(Object.entries(PRODUCT_PROJECTS))(
    '%s exists and declares %j',
    (project, targets) => {
      const node = graph.nodes[project];

      expect(
        node,
        `project ${project} is missing from the graph`,
      ).toBeDefined();
      expect(Object.keys(node?.data.targets ?? {})).toEqual(
        expect.arrayContaining([...targets]),
      );
    },
  );
});
