import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  matchCvTask,
  type MatchCvInput,
  type MatchCvOutput,
} from '../tasks/match-cv.task';
import type { EvaluableTask } from './evaluable-task';
import {
  ANONYMIZED_TAG,
  NAME_COLLISION_TAG,
  parseGolden,
  type GoldenIssue,
  type GoldenLoadResult,
} from './golden.schema';
import { matchCvExpectedSchema } from './match-cv/metrics';

// Tareas 6.1–6.5: anotaciones de redacción y validaciones del golden de CVs personales.

const personalEvaluable: EvaluableTask<
  MatchCvInput,
  MatchCvOutput,
  z.infer<typeof matchCvExpectedSchema>
> = {
  task: matchCvTask,
  expectedSchema: matchCvExpectedSchema,
  metrics: [],
  personalCvGolden: true,
};

function jsonl(...lines: unknown[]): string {
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

function baseInput(cvExtra = ''): MatchCvInput {
  return {
    job: {
      title: 'Dev',
      text: 'TypeScript.',
      skills: [{ name: 'TypeScript', importance: 'must' }],
    },
    cv: {
      text: `Perfil\nTypeScript y NestJS.\nContacto: ana@example.bo\n${cvExtra}`.trim(),
    },
  };
}

function issuesOf<I, E>(
  result: GoldenLoadResult<I, E>,
): readonly GoldenIssue[] {
  if (result.ok) throw new Error('expected an invalid golden set');
  return result.issues;
}

describe('golden redaction annotations (6.1–6.5)', () => {
  it('parsea una línea con pii, skills, knownGap y personName', () => {
    const input = baseInput('Ana Paz Flores\nLa Paz\nConstructora Flores S.R.L.');
    const result = parseGolden(
      personalEvaluable,
      jsonl({
        id: 'ok-01',
        input,
        expected: {
          matchedSkills: ['TypeScript'],
          missingSkills: [],
          score: 100,
        },
        tags: [ANONYMIZED_TAG, NAME_COLLISION_TAG],
        personName: 'Ana Paz Flores',
        pii: [
          { type: 'email', value: 'ana@example.bo' },
          {
            type: 'name',
            value: 'Ana Paz Flores',
            knownGap: 'unused-for-parse',
          },
        ],
        skills: ['La Paz', 'Constructora Flores S.R.L.', 'TypeScript'],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cases[0]?.pii).toHaveLength(2);
    expect(result.cases[0]?.skills).toContain('La Paz');
    expect(result.cases[0]?.personName).toBe('Ana Paz Flores');
  });

  it('rechaza un type inventado', () => {
    const issues = issuesOf(
      parseGolden(
        personalEvaluable,
        jsonl({
          id: 'bad-type',
          input: baseInput(),
          expected: {
            matchedSkills: ['TypeScript'],
            missingSkills: [],
            score: 100,
          },
          tags: [ANONYMIZED_TAG, NAME_COLLISION_TAG],
          personName: 'Ana',
          pii: [{ type: 'passport', value: 'X' }],
        }),
      ),
    );
    expect(issues[0]?.message).toContain('invalid case');
  });

  it('Caso sin la etiqueta de anonimizado', () => {
    const input = baseInput('Ana Paz Flores\nLa Paz\nConstructora Flores S.R.L.');
    const issues = issuesOf(
      parseGolden(
        personalEvaluable,
        jsonl({
          id: 'no-anon',
          input,
          expected: {
            matchedSkills: ['TypeScript'],
            missingSkills: [],
            score: 100,
          },
          tags: [NAME_COLLISION_TAG],
          personName: 'Ana Paz Flores',
          pii: [{ type: 'name', value: 'Ana Paz Flores' }],
          skills: ['La Paz', 'Constructora Flores S.R.L.'],
        }),
      ),
    );
    expect(issues[0]).toMatchObject({ line: 1, id: 'no-anon' });
    expect(issues[0]?.message).toContain(ANONYMIZED_TAG);
  });

  it('Anotación que no aparece en el input', () => {
    const issues = issuesOf(
      parseGolden(
        personalEvaluable,
        jsonl({
          id: 'missing-lit',
          input: baseInput('Ana Paz Flores\nLa Paz\nConstructora Flores S.R.L.'),
          expected: {
            matchedSkills: ['TypeScript'],
            missingSkills: [],
            score: 100,
          },
          tags: [ANONYMIZED_TAG, NAME_COLLISION_TAG],
          personName: 'Ana Paz Flores',
          pii: [
            { type: 'name', value: 'Ana Paz Flores' },
            { type: 'email', value: 'no-esta@example.bo' },
          ],
          skills: ['La Paz', 'Constructora Flores S.R.L.'],
        }),
      ),
    );
    const message = issues.map((i) => i.message).join('\n');
    expect(message).toContain('pii[1]');
    expect(message).toContain('email');
    expect(message).not.toContain('no-esta@example.bo');
  });

  it('Anotación de nombre sin el nombre declarado', () => {
    const issues = issuesOf(
      parseGolden(
        personalEvaluable,
        jsonl({
          id: 'no-person',
          input: baseInput('Ana Paz Flores\nLa Paz\nConstructora Flores S.R.L.'),
          expected: {
            matchedSkills: ['TypeScript'],
            missingSkills: [],
            score: 100,
          },
          tags: [ANONYMIZED_TAG, NAME_COLLISION_TAG],
          pii: [{ type: 'name', value: 'Ana Paz Flores' }],
          skills: ['La Paz', 'Constructora Flores S.R.L.'],
        }),
      ),
    );
    expect(issues.some((i) => i.id === 'no-person')).toBe(true);
    expect(issues.map((i) => i.message).join('\n')).not.toContain(
      'Ana Paz Flores',
    );
  });

  it('Golden sin caso de colisión de nombre', () => {
    const issues = issuesOf(
      parseGolden(
        personalEvaluable,
        jsonl({
          id: 'plain',
          input: baseInput(),
          expected: {
            matchedSkills: ['TypeScript'],
            missingSkills: [],
            score: 100,
          },
          tags: [ANONYMIZED_TAG],
          pii: [{ type: 'email', value: 'ana@example.bo' }],
          skills: ['TypeScript'],
        }),
      ),
    );
    expect(issues[0]?.message).toContain(NAME_COLLISION_TAG);
    expect(issues[0]?.message).toContain('match-cv');
  });

  it('Caso de colisión de nombre completo', () => {
    const result = parseGolden(
      personalEvaluable,
      jsonl({
        id: 'collision',
        input: baseInput('Ana Paz Flores\nLa Paz\nConstructora Flores S.R.L.'),
        expected: {
          matchedSkills: ['TypeScript'],
          missingSkills: [],
          score: 100,
        },
        tags: [ANONYMIZED_TAG, NAME_COLLISION_TAG],
        personName: 'Ana Paz Flores',
        pii: [{ type: 'name', value: 'Ana Paz Flores' }],
        skills: ['La Paz', 'Constructora Flores S.R.L.'],
      }),
    );
    expect(result.ok).toBe(true);
  });
});
