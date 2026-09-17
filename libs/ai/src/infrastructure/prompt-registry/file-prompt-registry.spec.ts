import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import Mustache from 'mustache';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FilePromptRegistry, InvalidPrompt } from './file-prompt-registry';

// Requisito "Prompts versionados" (specs/ai/task-execution) y D7 de ai-gateway-core.
// Prompts de prueba en un directorio temporal; el prompt real de classify-skills se prueba en la tarea 4.2.

const classifyV1 = {
  taskName: 'classify-skills',
  promptVersion: 'v1',
} as const;

let promptsDir: string;

async function writePrompt(fileName: string, content: string): Promise<void> {
  await writeFile(join(promptsDir, fileName), content, 'utf8');
}

beforeAll(async () => {
  promptsDir = await mkdtemp(join(tmpdir(), 'lv-prompts-'));
  await writePrompt(
    'classify-skills.v1.md',
    [
      '---',
      'task: classify-skills',
      'version: v1',
      '---',
      '# system',
      'Clasifica skills. Responde en {{outputLanguage}}.',
      '',
      '# user',
      'Texto:',
      '{{input.text}}',
      '',
    ].join('\n'),
  );
  await writePrompt(
    'classify-skills.v2.md',
    '---\ntask: classify-skills\nversion: v1\n---\n# system\ns\n# user\nu\n',
  );
  await writePrompt(
    'extract-job.v1.md',
    '---\ntask: classify-skills\nversion: v1\n---\n# system\ns\n# user\nu\n',
  );
  await writePrompt(
    'match-cv.v1.md',
    '---\r\ntask: match-cv\r\nversion: v1\r\n---\r\n# system\r\nSistema\r\n\r\n# user\r\nCV: {{input.text}}\r\n',
  );
  await writePrompt(
    'build-roadmap.v1.md',
    '---\ntask: build-roadmap\nversion: v1\n---\n# user\nsolo usuario\n',
  );
  await writePrompt(
    'critique-suggestions.v1.md',
    '---\ntask: critique-suggestions\nversion: v1\n---\n# system\n{{#input}}\n# user\nu\n',
  );
});

afterAll(async () => {
  await rm(promptsDir, { recursive: true, force: true });
});

describe('FilePromptRegistry', () => {
  it('Prompt renderizado con el input', async () => {
    const registry = new FilePromptRegistry({ promptsDir });
    const text = 'I+D & "calidad" <TypeScript> {{no es plantilla}}';

    const prompt = await registry.render(classifyV1, {
      input: { text },
      outputLanguage: 'es',
    });

    expect(prompt.system).toBe('Clasifica skills. Responde en es.');
    expect(prompt.user).toBe(`Texto:\n${text}`);
    expect(prompt.user).not.toMatch(/&amp;|&quot;|&lt;|&#/);
  });

  it('does not change the global Mustache escape', async () => {
    const registry = new FilePromptRegistry({ promptsDir });
    await registry.render(classifyV1, {
      input: { text: '&' },
      outputLanguage: 'es',
    });

    expect(Mustache.render('{{v}}', { v: '&' })).toBe('&amp;');
  });

  it('Versión de prompt inexistente', async () => {
    const registry = new FilePromptRegistry({ promptsDir });
    const ensure = registry.ensure({
      taskName: 'classify-skills',
      promptVersion: 'v9',
    });

    await expect(ensure).rejects.toThrow(InvalidPrompt);
    await expect(ensure).rejects.toThrow(/classify-skills.*v9/);
  });

  it('accepts an existing prompt whose front-matter matches', async () => {
    const registry = new FilePromptRegistry({ promptsDir });

    await expect(registry.ensure(classifyV1)).resolves.toBeUndefined();
  });

  it.each([
    ['version', { taskName: 'classify-skills', promptVersion: 'v2' }],
    ['task', { taskName: 'extract-job', promptVersion: 'v1' }],
  ] as const)(
    'rejects a front-matter whose %s does not match',
    async (field, ref) => {
      const registry = new FilePromptRegistry({ promptsDir });

      await expect(registry.ensure(ref)).rejects.toThrow(
        new RegExp(`front-matter ${field}`),
      );
    },
  );

  it('normalizes a prompt file with CRLF line endings', async () => {
    const registry = new FilePromptRegistry({ promptsDir });

    const prompt = await registry.render(
      { taskName: 'match-cv', promptVersion: 'v1' },
      { input: { text: 'línea' }, outputLanguage: 'en' },
    );

    expect(prompt).toEqual({ system: 'Sistema', user: 'CV: línea' });
  });

  it('rejects a prompt without both sections', async () => {
    const registry = new FilePromptRegistry({ promptsDir });

    await expect(
      registry.ensure({ taskName: 'build-roadmap', promptVersion: 'v1' }),
    ).rejects.toThrow(/# system.*# user/);
  });

  it('rejects an invalid Mustache template when ensuring', async () => {
    const registry = new FilePromptRegistry({ promptsDir });

    await expect(
      registry.ensure({
        taskName: 'critique-suggestions',
        promptVersion: 'v1',
      }),
    ).rejects.toThrow(/Mustache/);
  });

  it('resolves a relative directory against process.cwd()', async () => {
    const registry = new FilePromptRegistry({
      promptsDir: relative(process.cwd(), promptsDir),
    });

    await expect(registry.ensure(classifyV1)).resolves.toBeUndefined();
  });
});
