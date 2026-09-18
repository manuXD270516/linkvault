import { describe, expect, it } from 'vitest';
import type { ClassifySkillsOutput } from '../../tasks/classify-skills.task';
import {
  classifySkillsEvaluable,
  EVALUABLE_TASKS,
  evaluableTaskNames,
  findEvaluableTask,
} from '../evaluable-tasks';
import { computeMetrics } from '../metrics/aggregate';
import {
  degraded,
  success,
  testCaseResult,
} from '../metrics/test-cases.spec-helper';
import {
  classifySkillsExpectedSchema,
  compareSkills,
  normalizeSkillName,
  skillsPrecision,
  skillsRecall,
  type ClassifySkillsExpected,
} from './metrics';

// Tarea 2.2 (specs/ai/eval-harness, requisitos "Métricas" y "Tareas evaluables"; D4 y D5 de ai-eval-harness).

function output(...names: string[]): ClassifySkillsOutput {
  return { skills: names.map((name) => ({ name, category: 'other' })) };
}

function skillsCase(
  expected: string[],
  result: ReturnType<typeof success<ClassifySkillsOutput>>,
) {
  const expectedValue: ClassifySkillsExpected = { skills: expected };
  return testCaseResult({
    id: expected.join('-') || 'none',
    input: { text: 'placeholder' },
    expected: expectedValue,
    result,
  });
}

describe('classify-skills metrics', () => {
  it('Recall y precision de classify-skills', () => {
    const cases = [
      skillsCase(
        ['TypeScript', 'NestJS', 'Docker'],
        success(output('typescript', 'NestJS', 'Kafka')),
      ),
    ];

    expect(skillsRecall.compute(cases)).toBeCloseTo(2 / 3, 12);
    expect(skillsPrecision.compute(cases)).toBeCloseTo(2 / 3, 12);
    expect(
      compareSkills(
        { skills: ['TypeScript', 'NestJS', 'Docker'] },
        output('typescript', 'NestJS', 'Kafka'),
      ),
    ).toMatchObject({ missing: ['docker'], extra: ['kafka'] });
  });

  it('normalizes case, inner spaces and final punctuation only', () => {
    expect(normalizeSkillName('  Trabajo   en\tEquipo. ')).toBe(
      'trabajo en equipo',
    );
    expect(normalizeSkillName('Docker!?')).toBe('docker');
    expect(normalizeSkillName('Node.js')).toBe('node.js');
    expect(normalizeSkillName('C#')).toBe('c#');
    expect(normalizeSkillName('C++')).toBe('c++');
  });

  it('ignores repeated names in expected and output', () => {
    const comparison = compareSkills(
      { skills: ['Docker', 'docker'] },
      output('Docker', 'DOCKER.', 'Git'),
    );
    expect(comparison).toEqual({
      missing: [],
      extra: ['git'],
      recall: 1,
      precision: 0.5,
    });
  });

  it('averages only success cases', () => {
    const cases = [
      skillsCase(['TypeScript'], success(output('TypeScript'))),
      skillsCase(['TypeScript', 'Docker'], success(output('TypeScript'))),
      skillsCase(['Python'], degraded()),
    ];

    expect(skillsRecall.compute(cases)).toBe(0.75);
    expect(skillsPrecision.compute(cases)).toBe(1);
  });

  it('does not count a case without expected skills in recall', () => {
    const cases = [
      skillsCase([], success(output('Kafka'))),
      skillsCase(['Docker'], success(output('Docker'))),
    ];

    expect(skillsRecall.compute(cases)).toBe(1);
    expect(skillsPrecision.compute(cases)).toBe(0.5);
  });

  it('does not count a case whose output has no skills in precision', () => {
    const cases = [
      skillsCase(['Docker'], success(output())),
      skillsCase(['Git'], success(output('Git'))),
    ];

    expect(skillsRecall.compute(cases)).toBe(0.5);
    expect(skillsPrecision.compute(cases)).toBe(1);
  });

  it('returns 0 when no case contributes', () => {
    const cases = [skillsCase(['Docker'], degraded())];
    expect(skillsRecall.compute(cases)).toBe(0);
    expect(skillsPrecision.compute(cases)).toBe(0);
  });

  it('validates expected as a list of skill names', () => {
    expect(
      classifySkillsExpectedSchema.safeParse({ skills: ['TypeScript'] })
        .success,
    ).toBe(true);
    expect(
      classifySkillsExpectedSchema.safeParse({
        skills: [{ name: 'TypeScript' }],
      }).success,
    ).toBe(false);
    expect(
      classifySkillsExpectedSchema.safeParse({ skills: [''] }).success,
    ).toBe(false);
  });
});

describe('evaluable task registry', () => {
  it('registers classify-skills with its expected schema and blocking metrics', () => {
    expect(evaluableTaskNames()).toEqual([
      'classify-skills',
      'extract-job',
      'extract-pasted-job',
    ]);
    expect(findEvaluableTask('classify-skills')).toBe(EVALUABLE_TASKS[0]);
    expect(findEvaluableTask('no-existe')).toBeUndefined();
    expect(classifySkillsEvaluable.expectedSchema).toBe(
      classifySkillsExpectedSchema,
    );

    const metrics = computeMetrics(classifySkillsEvaluable, [
      skillsCase(['Docker'], success(output('Docker'))),
    ]);
    expect(
      metrics
        .filter((metric) => metric.kind === 'blocking')
        .map(({ name, value }) => ({ name, value })),
    ).toEqual([
      { name: 'schema_validity_rate', value: 1 },
      { name: 'degraded_rate', value: 0 },
      { name: 'skills_recall', value: 1 },
      { name: 'skills_precision', value: 1 },
    ]);
  });
});
