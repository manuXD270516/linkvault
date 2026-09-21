import { roadmapSchema } from '@linkvault/shared';
import type {
  BuildRoadmapInput,
  BuildRoadmapOutput,
} from '../../tasks/build-roadmap.task';
import type { CaseColumn, CaseResult, TaskMetric } from '../evaluable-task';
import { meanOfDefined } from '../metrics/name-set';

// Métricas mínimas de `build-roadmap` (study-roadmap 2.1): fracción de recursos verified honestos
// respecto al expected (mismo skill + misma url → misma marca).

export const buildRoadmapExpectedSchema = roadmapSchema;
export type BuildRoadmapExpected = BuildRoadmapOutput;

export type BuildRoadmapCaseResult = CaseResult<
  BuildRoadmapInput,
  BuildRoadmapOutput,
  BuildRoadmapExpected
>;

/** Fracción de recursos cuya marca `verified` coincide con el expected (por skill+url). */
export const verifiedMarkAccuracy: TaskMetric<
  BuildRoadmapInput,
  BuildRoadmapOutput,
  BuildRoadmapExpected
> = {
  name: 'verified_mark_accuracy',
  direction: 'higher',
  compute: (cases) =>
    meanOfDefined(
      cases.flatMap(({ goldenCase, result }) => {
        if (result.status !== 'success') return [];
        const expectedMarks = new Map<string, boolean>();
        for (const item of goldenCase.expected.items) {
          for (const resource of item.resources) {
            expectedMarks.set(
              `${item.skill}\0${resource.url ?? ''}\0${resource.title}`,
              resource.verified,
            );
          }
        }
        const marks: number[] = [];
        for (const item of result.output.items) {
          for (const resource of item.resources) {
            const key = `${item.skill}\0${resource.url ?? ''}\0${resource.title}`;
            const expected = expectedMarks.get(key);
            if (expected === undefined) continue;
            marks.push(resource.verified === expected ? 1 : 0);
          }
        }
        return marks.length === 0 ? [] : [meanOfDefined(marks) ?? 0];
      }),
    ),
};

export const BUILD_ROADMAP_METRICS = [verifiedMarkAccuracy] as const;

export const BUILD_ROADMAP_CASE_COLUMNS: readonly CaseColumn<
  BuildRoadmapInput,
  BuildRoadmapOutput,
  BuildRoadmapExpected
>[] = [
  {
    header: 'Ítems',
    value: ({ result }) =>
      result.status === 'success' ? String(result.output.items.length) : '',
  },
];
