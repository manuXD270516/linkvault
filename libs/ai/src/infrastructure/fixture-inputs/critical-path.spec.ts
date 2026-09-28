import { BUILD_ROADMAP_TITLE_MAX_LENGTH } from '@linkvault/shared';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { executionKey } from '../../application/execution-key';
import type { OutputLanguage } from '../../domain/run-context';
import type { AiTask } from '../../domain/task';
import {
  buildRoadmapFromCatalogOnly,
  buildRoadmapTask,
} from '../../tasks/build-roadmap.task';
import {
  critiqueSuggestionsTask,
  toCritiqueSuggestionsInput,
} from '../../tasks/critique-suggestions.task';
import { matchCvTask, type MatchCvOutput } from '../../tasks/match-cv.task';

// Fixtures del camino crítico de la suite end-to-end (change `e2e-suite`, design D7, tarea 5.6). El recorrido no siembra
// nada: su análisis de encaje entra en `runTask` con la oferta y el CV de la entrada versionada, y en local y en CI el
// mock está en `replay`. Esta prueba calcula, con la definición **actual** de cada tarea, la clave de esa entrada y
// exige sus fixtures: cambiar un prompt, su versión o el esquema de entrada la rompe en el mismo commit, no la suite
// días después.
//
// Qué se pide (analyze-match.usecase.ts): `match-cv` siempre; tras un `match-cv` no degradado, `critique-suggestions`
// **siempre** (también con `missingSkills: []`), con el informe del fixture de `match-cv` como parte de su entrada; y
// `build-roadmap` solo si ese informe tiene `missingSkills` que el catálogo no cubre entero. La clave de `match-cv` se
// midió ejecutando el recorrido (5.5a); las otras se calculan aquí a partir del fixture de `match-cv` (decisión del
// usuario del 2026-09-28).

const FIXTURES_DIR = join(import.meta.dirname, '../fixtures');
const ENTRY_PATH = join(import.meta.dirname, 'critical-path.json');

const entrySchema = z.object({
  job: z.strictObject({
    title: z.string().min(1),
    company: z.string().min(1),
    text: z.string().min(1),
    skills: z.array(z.strictObject({ name: z.string().min(1), importance: z.enum(['must', 'nice']) })),
  }),
  outputLanguage: z.enum(['es', 'en']),
  cv: z.object({
    lines: z.array(z.string().min(1)).min(1),
    /** Texto tal como lo extrae el worker del PDF generado con `lines` (medido en 5.5a). */
    text: z.string().min(1),
  }),
  /**
   * Clave de `match-cv` de esta entrada, la que se midió (5.5a). La prueba end-to-end la usa para leer el informe del
   * fixture que afirma en el paso 7 con `replay-report` (tarea 5.7); aquí se exige que sea la calculada.
   */
  replayKeys: z.strictObject({ 'match-cv': z.string().regex(/^[0-9a-f]{64}$/) }),
});

/** Formato de un fixture del mock (`MockDeterministicProvider`). */
const fixtureSchema = z.strictObject({
  source: z.string().min(1),
  text: z.string(),
  model: z.string().min(1),
  usage: z.strictObject({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
});

const entry = entrySchema.parse(JSON.parse(readFileSync(ENTRY_PATH, 'utf8')));

function keyOf<I, O>(task: AiTask<I, O>, input: unknown, outputLanguage: OutputLanguage): string {
  return executionKey({
    taskName: task.name,
    promptVersion: task.promptVersion,
    outputLanguage,
    input: task.inputSchema.parse(input),
  });
}

/**
 * Salida del fixture de `task` para `key`, validada con el esquema de salida de la tarea. Si no existe, falla nombrando
 * la tarea y la clave.
 */
function fixtureOutput<I, O>(task: AiTask<I, O>, key: string): O {
  const path = join(FIXTURES_DIR, task.name, `${key}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `critical path: no replay fixture for task ${task.name} and key ${key} (${task.name}/${key}.json, prompt ${task.promptVersion})`,
    );
  }
  const fixture = fixtureSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  expect(fixture.source, `${task.name}/${key}.json`).toBe('handwritten');
  return task.outputSchema.parse(JSON.parse(fixture.text));
}

const job = { title: entry.job.title, text: entry.job.text, skills: entry.job.skills };
/** Entrada de `match-cv` tal como la arma el worker (analyze-match.usecase.ts), sin parsear: la parsea `runTask`. */
const matchInput = { job, cv: { text: entry.cv.text } };

describe('critical path replay fixtures (e2e-suite, design D7)', () => {
  it('has the match-cv fixture for the versioned entry', () => {
    fixtureOutput(matchCvTask, keyOf(matchCvTask, matchInput, entry.outputLanguage));
  });

  it('records in the entry the match-cv key that the current definition computes', () => {
    const key = keyOf(matchCvTask, matchInput, entry.outputLanguage);
    expect(
      entry.replayKeys['match-cv'],
      `critical path: replayKeys["match-cv"] in critical-path.json is not the key of task match-cv (${key}, prompt ${matchCvTask.promptVersion})`,
    ).toBe(key);
  });

  it('has the critique-suggestions fixture computed from the match-cv fixture', () => {
    const report: MatchCvOutput = fixtureOutput(matchCvTask, keyOf(matchCvTask, matchInput, entry.outputLanguage));
    // Como el worker: la oferta tal como la leyó, no la parseada.
    const critiqueInput = toCritiqueSuggestionsInput(job, report);
    fixtureOutput(critiqueSuggestionsTask, keyOf(critiqueSuggestionsTask, critiqueInput, entry.outputLanguage));
  });

  it('has the build-roadmap fixture when the report asks for one, or no missing skills', () => {
    const report: MatchCvOutput = fixtureOutput(matchCvTask, keyOf(matchCvTask, matchInput, entry.outputLanguage));
    if (report.missingSkills.length === 0) {
      // Sin habilidades que falten, el worker no encola `build-roadmap` (maybeEnqueueRoadmap).
      return;
    }
    const roadmapInput = buildRoadmapTask.inputSchema.parse({
      missingSkills: report.missingSkills.map((skill) => ({ name: skill.name, importance: skill.importance })),
      job: {
        title: job.title.slice(0, BUILD_ROADMAP_TITLE_MAX_LENGTH) || 'Job',
        skills: job.skills.map((skill) => ({ name: skill.name, importance: skill.importance })),
      },
    });
    if (buildRoadmapFromCatalogOnly(roadmapInput) !== null) {
      // El catálogo cubre todas: el worker no llama a `runTask`.
      return;
    }
    fixtureOutput(buildRoadmapTask, keyOf(buildRoadmapTask, roadmapInput, entry.outputLanguage));
  });
});
