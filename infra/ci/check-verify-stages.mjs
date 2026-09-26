#!/usr/bin/env node
// =====================================================================================================================
// Los tres jobs `verify` (ci, cd-staging, cd-prod) ejecutan las mismas etapas en el mismo orden.
// =====================================================================================================================
// Paso 4 de infra/revision-despliegue.md; requirement «El CD verifica con las mismas etapas que la integración
// continua» de platform/ci-pipeline (ADR-050). El YAML está copiado en tres sitios y lo copiado diverge: esto lo
// detecta hasta que la fila 35c (verify-reusable-workflow) lo sustituya por un workflow reutilizable, y entonces este
// script sobra. Solo compara las etapas de verificación, no los pasos de preparación ni cómo se acota cada una
// (affected en ci/cd-staging, run-many --all en cd-prod, y eso es correcto).
// =====================================================================================================================
import { readFileSync } from 'node:fs';

const STAGES = ['Repo checks', 'Lint', 'Validate OpenSpec specs', 'Typecheck', 'Test', 'i18n catalog', 'Eval (replay)', 'Build'];
const WORKFLOWS = ['ci', 'cd-staging', 'cd-prod'];

let ok = true;
for (const workflow of WORKFLOWS) {
  const yaml = readFileSync(`.github/workflows/${workflow}.yml`, 'utf8');
  const start = yaml.indexOf('\n  verify:');
  const next = yaml.slice(start + 1).search(/\n {2}[a-z][\w-]*:\s*\n/);
  const job = next < 0 ? yaml.slice(start) : yaml.slice(start, start + 1 + next);
  const stages = [...job.matchAll(/- name: (.+)/g)].map((match) => match[1].trim()).filter((name) => STAGES.includes(name));
  const same = stages.join('\u0000') === STAGES.join('\u0000');
  ok &&= same;
  process.stdout.write(`${same ? 'PASS' : 'FAIL'}  ${workflow}: ${stages.join(' -> ')}\n`);
}
process.stdout.write(ok ? '\nsame stages, same order\n' : `\nexpected: ${STAGES.join(' -> ')}\n`);
process.exitCode = ok ? 0 : 1;
