import { join } from 'node:path';
import { extractJobOutputSchema } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { RunTask } from '../application/run-task.usecase';
import { FakeLlmProvider } from '../application/testing/fake-llm-provider';
import {
  InMemoryAiLogger,
  InMemoryPromptRegistry,
  InMemoryQuotaPolicy,
  InMemoryResultCache,
  InMemoryUsageLedger,
  ManualClock,
  RecordingNullCircuitBreaker,
} from '../application/testing/in-memory-ports';
import type { RunContext } from '../domain/run-context';
import { FilePromptRegistry } from '../infrastructure/prompt-registry/file-prompt-registry';
import { mulberry32 } from '../infrastructure/providers/mock-deterministic.provider';
import {
  EXTRACT_JOB_TEXT_MAX_LENGTH,
  extractJobInputSchema,
  extractJobTask,
  sampleExtractJob,
} from './extract-job.task';

// D7 de link-enrichment y requisito "Extracción estructurada con IA" (links/enrichment): la tarea dice si lo leído es
// una vacante antes de decir qué campos tiene, y su entrada se recorta sola.

/** Directorio real de prompts: `nx test ai` ejecuta Vitest con cwd = libs/ai. */
const PROMPTS_DIR = join(import.meta.dirname, '../infrastructure/prompts');

const CTX: RunContext = { aiConsent: { externalProviders: false } };

const JOB_TEXT = [
  'Desarrollador/a Backend Senior',
  'Empresa: Acme Bolivia',
  'Ubicación: La Paz, Bolivia',
  'Modalidad: 100% remoto desde cualquier ciudad del país.',
  'Buscamos a alguien que mantenga nuestras APIs de pagos con TypeScript sobre NestJS y PostgreSQL.',
  'Requisitos: 5 años de experiencia y control de versiones con Git.',
  'Deseable: experiencia con Kubernetes y con Docker.',
  'Se valora inglés técnico para leer documentación.',
].join('\n');

const LISTING_TEXT = [
  'Empleos en Bolivia',
  'Encuentra tu próximo trabajo entre miles de anuncios.',
  'Categorías: tecnología, ventas, salud, educación.',
].join('\n');

const VALID_OUTPUT = {
  isJobPosting: true,
  preview: {
    title: 'Desarrollador/a Backend Senior',
    company: 'Acme Bolivia',
    location: 'La Paz, Bolivia',
    modality: 'remote',
    seniority: 'senior',
    salary: null,
    skills: [{ name: 'TypeScript', required: true }],
    languages: [{ name: 'Inglés', level: null }],
    summary: 'Mantiene las APIs de pagos.',
    postedAt: null,
    expiresAt: null,
  },
};

const NOT_A_JOB_OUTPUT = { isJobPosting: false, preview: null };

function runTaskWith(replies: readonly string[]): {
  runTask: RunTask;
  provider: FakeLlmProvider;
} {
  const provider = new FakeLlmProvider('ollama', replies, {
    model: 'qwen2.5:7b',
  });
  const runTask = new RunTask({
    providers: [provider],
    prompts: new InMemoryPromptRegistry(),
    cache: new InMemoryResultCache(),
    ledger: new InMemoryUsageLedger(),
    quota: new InMemoryQuotaPolicy(),
    breaker: new RecordingNullCircuitBreaker(),
    clock: new ManualClock(),
    logger: new InMemoryAiLogger(),
  });
  return { runTask, provider };
}

describe('extract-job schemas', () => {
  it.each([
    ['empty text', { text: '' }],
    ['missing text', {}],
    ['non-string text', { text: 42 }],
  ])('rejects input with %s', (_label, input) => {
    expect(extractJobInputSchema.safeParse(input).success).toBe(false);
  });

  it('recorta la entrada a 24 000 caracteres en vez de rechazarla', () => {
    const parsed = extractJobInputSchema.parse({
      text: 'a'.repeat(EXTRACT_JOB_TEXT_MAX_LENGTH + 500),
      extra: true,
    });

    expect(parsed).toEqual({
      text: 'a'.repeat(EXTRACT_JOB_TEXT_MAX_LENGTH),
    });
  });

  it('declares the task contract of D7', () => {
    expect(extractJobTask).toMatchObject({
      name: 'extract-job',
      promptVersion: 'v1',
      temperature: 0,
      dataSensitivity: 'public',
      requires: { jsonMode: true },
      budget: { maxAttempts: 2 },
    });
    expect(extractJobTask.outputSchema).toBe(extractJobOutputSchema);
    expect(extractJobTask.degrade).toBeUndefined();
  });

  it('renderiza su prompt v1 con el texto de la página', async () => {
    const prompts = new FilePromptRegistry({ promptsDir: PROMPTS_DIR });

    const rendered = await prompts.render(
      {
        taskName: extractJobTask.name,
        promptVersion: extractJobTask.promptVersion,
      },
      { input: { text: JOB_TEXT }, outputLanguage: 'es' },
    );

    expect(rendered.user).toContain('Desarrollador/a Backend Senior');
    expect(rendered.system).toContain('isJobPosting');
    // El idioma de salida es fijo `es` (D7): el prompt no lo interpola y no queda ningún marcador sin sustituir.
    expect(rendered.system).not.toContain('{{');
    expect(rendered.user).not.toContain('{{');
  });
});

describe('extract-job con runTask', () => {
  it('Salida validada: una vacante con sus campos', async () => {
    const { runTask } = runTaskWith([JSON.stringify(VALID_OUTPUT)]);

    const result = await runTask.execute(
      extractJobTask,
      { text: JOB_TEXT },
      CTX,
    );

    expect(result).toMatchObject({ status: 'success', output: VALID_OUTPUT });
  });

  it('La IA dice que no es una vacante', async () => {
    const { runTask } = runTaskWith([JSON.stringify(NOT_A_JOB_OUTPUT)]);

    const result = await runTask.execute(
      extractJobTask,
      { text: LISTING_TEXT },
      CTX,
    );

    expect(result).toMatchObject({
      status: 'success',
      output: NOT_A_JOB_OUTPUT,
    });
  });

  it('una salida sin el discriminador se repara en el mismo proveedor', async () => {
    // Un preview a secas, sin `isJobPosting`: es justo lo que el schema propio de la tarea existe para rechazar.
    const { runTask, provider } = runTaskWith([
      JSON.stringify(VALID_OUTPUT.preview),
      JSON.stringify(VALID_OUTPUT),
    ]);

    const result = await runTask.execute(
      extractJobTask,
      { text: JOB_TEXT },
      CTX,
    );

    expect(result).toMatchObject({ status: 'success', output: VALID_OUTPUT });
    expect(provider.calls).toBe(2);
  });
});

describe('sampleExtractJob', () => {
  it('produce una salida válida y determinista para la misma semilla', () => {
    const first = sampleExtractJob({ text: JOB_TEXT }, mulberry32(7));
    const second = sampleExtractJob({ text: JOB_TEXT }, mulberry32(7));

    expect(extractJobOutputSchema.safeParse(first).success).toBe(true);
    expect(first).toEqual(second);
  });

  it('lee del texto el título, la empresa, la modalidad y el nivel', () => {
    const output = sampleExtractJob({ text: JOB_TEXT }, mulberry32(1));

    expect(output).toMatchObject({
      isJobPosting: true,
      preview: {
        title: 'Desarrollador/a Backend Senior',
        company: 'Acme Bolivia',
        location: 'La Paz, Bolivia',
        modality: 'remote',
        seniority: 'senior',
        languages: [{ name: 'Inglés', level: null }],
      },
    });
  });

  it('marca como no obligatorias las tecnologías del bloque deseable', () => {
    const { preview } = sampleExtractJob({ text: JOB_TEXT }, mulberry32(1));

    expect(preview?.skills).toEqual([
      { name: 'TypeScript', required: true },
      { name: 'NestJS', required: true },
      { name: 'PostgreSQL', required: true },
      { name: 'Git', required: true },
      { name: 'Kubernetes', required: false },
      { name: 'Docker', required: false },
    ]);
  });

  it('dice que un listado no es una vacante y no inventa preview', () => {
    const output = sampleExtractJob({ text: LISTING_TEXT }, mulberry32(1));

    expect(output).toEqual({ isJobPosting: false, preview: null });
  });
});
