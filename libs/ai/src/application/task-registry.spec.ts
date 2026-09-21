import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AiTask } from '../domain/task';
import { InvalidTaskRegistration, TaskRegistry } from './task-registry';
import { AI_TASKS } from '../ai.module';
import { dataSensitivityOf } from '../domain/task';

// Requisito "Punto de entrada único" (specs/ai/task-execution) y D2 de ai-gateway-core.

const inputSchema = z.object({ text: z.string().min(1) });
const outputSchema = z.object({ skills: z.array(z.string()) });

function task(
  overrides: Partial<
    AiTask<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>>
  > = {},
): AiTask<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> {
  return {
    name: 'classify-skills',
    promptVersion: 'v1',
    inputSchema,
    outputSchema,
    requires: { jsonMode: true },
    temperature: 0,
    budget: { maxTokens: 256, maxAttempts: 2 },
    dataSensitivity: 'personal',
    cacheable: false,
    sample: (input) => ({ skills: input.text.split(' ') }),
    ...overrides,
  };
}

describe('TaskRegistry', () => {
  it('registers a typed task and finds it by name', () => {
    const classify = task();
    const registry = new TaskRegistry();

    registry.register(classify);

    expect(registry.get('classify-skills')).toBe(classify);
    expect(registry.list()).toEqual([classify]);
  });

  it('registers the tasks given to the constructor', () => {
    const registry = new TaskRegistry([task(), task({ name: 'extract-job' })]);

    expect(registry.list().map((t) => t.name)).toEqual([
      'classify-skills',
      'extract-job',
    ]);
  });

  it('returns undefined for an unknown task', () => {
    expect(new TaskRegistry().get('build-roadmap')).toBeUndefined();
    expect(new TaskRegistry().get('not-a-task')).toBeUndefined();
  });

  it('rejects a duplicated task name', () => {
    const registry = new TaskRegistry([task()]);

    expect(() => registry.register(task({ promptVersion: 'v2' }))).toThrow(
      InvalidTaskRegistration,
    );
    expect(() => registry.register(task())).toThrow(/classify-skills/);
  });

  it.each([1, 2])('accepts maxAttempts %i', (maxAttempts) => {
    const registry = new TaskRegistry();

    registry.register(task({ budget: { maxTokens: 256, maxAttempts } }));

    expect(registry.get('classify-skills')?.budget.maxAttempts).toBe(
      maxAttempts,
    );
  });

  it('Presupuesto de intentos inválido', () => {
    const registry = new TaskRegistry();
    const register = () =>
      registry.register(task({ budget: { maxTokens: 256, maxAttempts: 3 } }));

    expect(register).toThrow(InvalidTaskRegistration);
    expect(register).toThrow(/classify-skills/);
    expect(registry.get('classify-skills')).toBeUndefined();
  });

  it.each([0, 1.5, Number.NaN])('rejects maxAttempts %s', (maxAttempts) => {
    expect(
      () =>
        new TaskRegistry([task({ budget: { maxTokens: 256, maxAttempts } })]),
    ).toThrow(InvalidTaskRegistration);
  });

  it('Tarea personal declarada cacheable', () => {
    const execute = vi.fn();
    expect(() =>
      new TaskRegistry([
        task({
          name: 'match-cv',
          dataSensitivity: 'personal',
          cacheable: true,
        }),
      ]),
    ).toThrow(/match-cv/);
    expect(() =>
      new TaskRegistry([
        task({
          name: 'match-cv',
          dataSensitivity: 'personal',
          cacheable: true,
        }),
      ]),
    ).toThrow(InvalidTaskRegistration);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a task that omits cacheable', () => {
    const incomplete = {
      ...task(),
      cacheable: undefined as unknown as boolean,
    };
    expect(() => new TaskRegistry([incomplete])).toThrow(
      /cacheable must be declared/,
    );
  });

  it('accepts a public cacheable task', () => {
    const registry = new TaskRegistry([
      task({
        name: 'extract-job',
        dataSensitivity: 'public',
        cacheable: true,
      }),
    ]);
    expect(registry.get('extract-job')?.cacheable).toBe(true);
  });

  it('every registered AI_TASKS entry declares cacheable explicitly', () => {
    // Arranque real: si alguna personal fuera cacheable, el constructor lanzaría.
    const registry = new TaskRegistry(AI_TASKS);
    for (const registered of registry.list()) {
      expect(typeof registered.cacheable).toBe('boolean');
      if (dataSensitivityOf(registered) === 'personal') {
        expect(registered.cacheable).toBe(false);
      }
    }
    expect(registry.get('extract-job')?.cacheable).toBe(true);
    expect(registry.get('classify-skills')?.cacheable).toBe(false);
    expect(registry.get('extract-pasted-job')?.cacheable).toBe(false);
    expect(registry.get('match-cv')?.cacheable).toBe(false);
    expect(registry.get('critique-suggestions')?.cacheable).toBe(false);
    expect(registry.get('build-roadmap')?.cacheable).toBe(false);
  });
});
