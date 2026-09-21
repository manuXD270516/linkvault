import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PiiRedactor } from '../../application/pii-redactor';
import type { AiTask } from '../../domain/task';
import { MOCK_PROVIDER_ID } from '../../domain/provider-ids';
import type { AnyEvaluableTask } from '../evaluable-task';
import { personalFixturePiiTypes } from './record-fixtures';

// Auditoría de fixtures ya grabados de tareas `personal` (6.16–6.17, specs/ai/deterministic-mock). Clasifica por la
// bandera `external` del proveedor que declara el `source`, no por handwritten vs recorded; y comprueba el contenido
// con el redactor externo.

/** `external` por id de proveedor conocido. Fuentes `handwritten` no son un proveedor. */
export const PROVIDER_EXTERNAL_BY_ID: Readonly<Record<string, boolean>> = {
  [MOCK_PROVIDER_ID]: false,
  ollama: false,
  openrouter: true,
};

export interface PersonalFixtureIssue {
  task: string;
  /** Nombre del archivo del fixture. */
  file: string;
  /** Motivo sin valores de PII. */
  message: string;
}

export interface PersonalFixtureAudit {
  checked: number;
  issues: readonly PersonalFixtureIssue[];
}

/**
 * Audita los fixtures en disco de las tareas `personal` del registro. Falla nombrando fixture y tarea mientras exista
 * uno con origen de proveedor externo o contenido que el redactor externo cambiaría.
 */
export async function auditPersonalFixtures(
  fixturesDir: string,
  registry: readonly AnyEvaluableTask[],
): Promise<PersonalFixtureAudit> {
  const personal = registry.filter((e) => e.task.dataSensitivity === 'personal');
  const issues: PersonalFixtureIssue[] = [];
  let checked = 0;
  const redactor = new PiiRedactor();

  for (const evaluable of personal) {
    const taskDir = join(fixturesDir, evaluable.task.name);
    let files: string[];
    try {
      files = (await readdir(taskDir)).filter((name) => name.endsWith('.json'));
    } catch {
      continue;
    }
    for (const file of files) {
      checked++;
      const raw = await readFile(join(taskDir, file), 'utf8');
      let parsed: { source?: unknown; text?: unknown };
      try {
        parsed = JSON.parse(raw) as { source?: unknown; text?: unknown };
      } catch {
        issues.push({
          task: evaluable.task.name,
          file,
          message: 'fixture is not valid JSON',
        });
        continue;
      }
      if (typeof parsed.source !== 'string') {
        issues.push({
          task: evaluable.task.name,
          file,
          message: 'fixture is missing source',
        });
        continue;
      }
      const originIssue = externalOriginIssue(parsed.source, evaluable.task);
      if (originIssue !== null) {
        issues.push({
          task: evaluable.task.name,
          file,
          message: originIssue,
        });
      }
      if (typeof parsed.text !== 'string') {
        issues.push({
          task: evaluable.task.name,
          file,
          message: 'fixture is missing text',
        });
        continue;
      }
      let output: unknown;
      try {
        output = JSON.parse(parsed.text);
      } catch {
        issues.push({
          task: evaluable.task.name,
          file,
          message: 'fixture text is not valid JSON',
        });
        continue;
      }
      const types = personalFixturePiiTypes(output, redactor);
      if (types.length > 0) {
        issues.push({
          task: evaluable.task.name,
          file,
          message: `personal fixture content retains pii type ${types[0] ?? 'unknown'}`,
        });
      }
    }
  }

  return { checked, issues };
}

/**
 * `handwritten` y `recorded:<local>:<model>` son válidos. Solo un proveedor con `external: true` invalida por origen.
 */
export function externalOriginIssue(
  source: string,
  task: Pick<AiTask<unknown, unknown>, 'name' | 'dataSensitivity'>,
): string | null {
  if (source === 'handwritten') return null;
  const recorded = /^recorded:([^:]+):/u.exec(source);
  if (recorded === null) {
    return `unrecognized fixture source for personal task ${task.name}`;
  }
  const providerId = recorded[1] ?? '';
  const external = PROVIDER_EXTERNAL_BY_ID[providerId];
  if (external === undefined) {
    return `unknown provider "${providerId}" in fixture source for personal task ${task.name}`;
  }
  if (external) {
    return `personal task ${task.name} fixture was recorded against external provider ${providerId}; replace with handwritten or mock/local recording`;
  }
  return null;
}
