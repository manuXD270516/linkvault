import {
  type AiTask,
  FixtureMissing,
  type LlmProvider,
  matchCvTask,
  type ProviderCapabilities,
} from '@linkvault/ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Verificación de la tarea 8.2: los contratos de libs/ai son importables por su alias desde worker.
const mockCapabilities: ProviderCapabilities = {
  jsonMode: true,
  toolUse: false,
  maxContextTokens: 32000,
  external: false,
  costPer1kIn: 0,
  costPer1kOut: 0,
};

const mockProvider: LlmProvider = {
  id: 'mock',
  capabilities: mockCapabilities,
  complete: async (req) => ({
    text: req.user,
    usage: { inputTokens: 0, outputTokens: 0 },
    model: 'mock',
    latencyMs: 0,
  }),
  healthy: async () => true,
};

const classifySkillsInput = z.object({ text: z.string() });
const classifySkillsOutput = z.object({ skills: z.array(z.string()) });

const classifySkills: AiTask<
  z.infer<typeof classifySkillsInput>,
  z.infer<typeof classifySkillsOutput>
> = {
  name: 'classify-skills',
  promptVersion: 'v1',
  inputSchema: classifySkillsInput,
  outputSchema: classifySkillsOutput,
  requires: { jsonMode: true },
  temperature: 0,
  budget: { maxTokens: 512, maxAttempts: 2 },
  dataSensitivity: 'personal',
  cacheable: false,
};

describe('@linkvault/ai contracts', () => {
  it('accepts an AiTask whose zod schemas type its input and output', () => {
    expect(classifySkills.name).toBe('classify-skills');
    expect(
      classifySkills.inputSchema.parse({ text: 'TypeScript, NestJS' }),
    ).toEqual({ text: 'TypeScript, NestJS' });
    expect(classifySkills.outputSchema.safeParse({ skills: [1] }).success).toBe(
      false,
    );
  });

  it('exports matchCvTask as a personal non-cacheable task', () => {
    expect(matchCvTask.name).toBe('match-cv');
    expect(matchCvTask.dataSensitivity).toBe('personal');
    expect(matchCvTask.cacheable).toBe(false);
    expect(matchCvTask.promptVersion).toBe('v1');
  });

  it('accepts an object that satisfies LlmProvider with mock capabilities', async () => {
    expect(mockProvider.capabilities.external).toBe(false);
    await expect(mockProvider.healthy()).resolves.toBe(true);
    await expect(
      mockProvider.complete({ system: 's', user: 'u' }),
    ).resolves.toMatchObject({ text: 'u' });
  });

  it('exposes FixtureMissing as a typed error with its name and key', () => {
    const error = new FixtureMissing('abc123');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('FixtureMissing');
    expect(error.key).toBe('abc123');
  });
});
