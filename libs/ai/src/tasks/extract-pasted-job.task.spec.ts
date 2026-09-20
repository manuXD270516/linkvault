import { join } from 'node:path';
import { extractJobOutputSchema, scrubContactDetails } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { executionKey } from '../application/execution-key';
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
import { extractJobTask } from './extract-job.task';
import {
  extractPastedJobInputSchema,
  extractPastedJobTask,
  sampleExtractPastedJob,
} from './extract-pasted-job.task';

// D2 de paste-job-description y requisito "El texto pegado es un dato personal" (links/pasted-description): lo pegado
// se lee con una tarea propia, `personal`, con la misma salida que `extract-job` y el título y la empresa escritos
// aparte como contexto.

/** Directorio real de prompts: `nx test ai` ejecuta Vitest con cwd = libs/ai. */
const PROMPTS_DIR = join(import.meta.dirname, '../infrastructure/prompts');

const NO_CONSENT: RunContext = { aiConsent: { externalProviders: false } };
const CONSENT: RunContext = { aiConsent: { externalProviders: true } };

/** Cuerpo copiado de la app, ya limpio: en una sola línea y sin cabecera. */
const PASTED_TEXT = scrubContactDetails(
  [
    'Solicitud sencilla',
    'hace 2 semanas · 37 solicitantes',
    'Acerca del empleo',
    'Buscamos a alguien que mantenga nuestras APIs de pagos con TypeScript sobre NestJS y PostgreSQL.',
    'Requisitos: 5 años de experiencia y control de versiones con Git. Modalidad remota.',
    'Deseable: experiencia con Kubernetes.',
  ].join('\n'),
);

const CHAT_TEXT = scrubContactDetails(
  'Hola! ¿Vienes el sábado al cumple de Rocío? Sí, llevo la torta. Genial, nos vemos a las 8.',
);

const VALID_OUTPUT = {
  isJobPosting: true,
  preview: {
    title: 'Desarrollador Backend',
    company: 'Acme Bolivia',
    location: null,
    modality: 'remote',
    seniority: 'unknown',
    salary: null,
    skills: [{ name: 'TypeScript', required: true }],
    languages: [],
    summary: 'Mantiene las APIs de pagos.',
    postedAt: null,
    expiresAt: null,
  },
};

function harness(
  providers: readonly FakeLlmProvider[],
  prompts = new InMemoryPromptRegistry(),
): RunTask {
  return new RunTask({
    providers: [...providers],
    prompts,
    cache: new InMemoryResultCache(),
    ledger: new InMemoryUsageLedger(),
    quota: new InMemoryQuotaPolicy(),
    breaker: new RecordingNullCircuitBreaker(),
    clock: new ManualClock(),
    logger: new InMemoryAiLogger(),
  });
}

function keyOf(input: unknown): string {
  return executionKey({
    taskName: extractPastedJobTask.name,
    promptVersion: extractPastedJobTask.promptVersion,
    outputLanguage: 'es',
    input: extractPastedJobInputSchema.parse(input),
  });
}

describe('extract-pasted-job schemas', () => {
  it.each([
    ['empty text', { text: '' }],
    ['whitespace-only text', { text: '   \n ' }],
    ['missing text', {}],
    ['non-string text', { text: 42 }],
    ['non-string known title', { text: 'Oferta', knownTitle: 7 }],
  ])('rejects input with %s', (_label, input) => {
    expect(extractPastedJobInputSchema.safeParse(input).success).toBe(false);
  });

  it('keeps the known title and company, trimmed, and drops unknown keys', () => {
    expect(
      extractPastedJobInputSchema.parse({
        text: ' Oferta ',
        knownTitle: '  Analista Contable ',
        knownCompany: 'Acme',
        extra: true,
      }),
    ).toEqual({
      text: 'Oferta',
      knownTitle: 'Analista Contable',
      knownCompany: 'Acme',
    });
  });

  it('treats an empty known title or company as not written, with the same key', () => {
    const parsed = extractPastedJobInputSchema.parse({
      text: 'Oferta',
      knownTitle: '  ',
      knownCompany: '',
    });

    expect(parsed).toEqual({ text: 'Oferta' });
    expect(Object.keys(parsed)).toEqual(['text']);
    expect(keyOf({ text: 'Oferta', knownTitle: '', knownCompany: ' ' })).toBe(
      keyOf({ text: 'Oferta' }),
    );
    expect(keyOf({ text: 'Oferta', knownTitle: undefined })).toBe(
      keyOf({ text: 'Oferta' }),
    );
  });

  it('the known title is part of the deterministic key', () => {
    expect(keyOf({ text: 'Oferta', knownTitle: 'Analista' })).not.toBe(
      keyOf({ text: 'Oferta' }),
    );
  });

  it('does not share keys with extract-job for the same text', () => {
    const pageKey = executionKey({
      taskName: extractJobTask.name,
      promptVersion: extractJobTask.promptVersion,
      outputLanguage: 'es',
      input: { text: 'Oferta' },
    });

    expect(keyOf({ text: 'Oferta' })).not.toBe(pageKey);
  });

  it('trims the text to the pasted maximum instead of rejecting it', () => {
    const parsed = extractPastedJobInputSchema.parse({
      text: 'a'.repeat(20_500),
    });

    expect(parsed.text).toHaveLength(20_000);
  });

  it('declares the task contract of D2', () => {
    expect(extractPastedJobTask).toMatchObject({
      name: 'extract-pasted-job',
      promptVersion: 'v1',
      temperature: 0,
      dataSensitivity: 'personal',
      cacheable: false,
      requires: { jsonMode: true },
      budget: { maxAttempts: 2 },
    });
    // La misma salida que `extract-job`: `api` la mezcla en el preview igual que el worker lo leído de la página.
    expect(extractPastedJobTask.outputSchema).toBe(extractJobOutputSchema);
    expect(extractPastedJobTask.degrade).toBeUndefined();
  });
});

describe('extract-pasted-job prompt v1', () => {
  const prompts = new FilePromptRegistry({ promptsDir: PROMPTS_DIR });
  const ref = {
    taskName: extractPastedJobTask.name,
    promptVersion: extractPastedJobTask.promptVersion,
  };

  it('renders the known title and company as context when they were written', async () => {
    const rendered = await prompts.render(ref, {
      input: {
        text: PASTED_TEXT,
        knownTitle: 'Desarrollador Backend',
        knownCompany: 'Acme Bolivia',
      },
      outputLanguage: 'es',
    });

    expect(rendered.user).toContain(
      '<titulo_escrito>Desarrollador Backend</titulo_escrito>',
    );
    expect(rendered.user).toContain(
      '<empresa_escrita>Acme Bolivia</empresa_escrita>',
    );
    expect(rendered.user).toContain(PASTED_TEXT);
    expect(rendered.system).not.toContain('{{');
    expect(rendered.user).not.toContain('{{');
  });

  it('leaves them out when they were not written', async () => {
    const rendered = await prompts.render(ref, {
      input: { text: PASTED_TEXT },
      outputLanguage: 'es',
    });

    expect(rendered.user).not.toContain('titulo_escrito');
    expect(rendered.user).not.toContain('empresa_escrita');
    expect(rendered.user).toMatch(/^<texto_pegado>/u);
  });

  it('forbids reproducing names of people in summary', async () => {
    const rendered = await prompts.render(ref, {
      input: { text: PASTED_TEXT },
      outputLanguage: 'es',
    });

    expect(rendered.system).toContain(
      'Nunca escribas en `summary` el nombre de una persona',
    );
    expect(rendered.system).toContain('isJobPosting');
  });
});

describe('extract-pasted-job con runTask', () => {
  it('Salida validada: una vacante con sus campos', async () => {
    const local = new FakeLlmProvider('ollama', [JSON.stringify(VALID_OUTPUT)]);

    const result = await harness([local]).execute(
      extractPastedJobTask,
      { text: PASTED_TEXT, knownCompany: 'Acme Bolivia' },
      NO_CONSENT,
    );

    expect(result).toMatchObject({ status: 'success', output: VALID_OUTPUT });
  });

  it('Sin consentimiento, sin proveedor externo', async () => {
    const external = new FakeLlmProvider(
      'openrouter',
      [JSON.stringify(VALID_OUTPUT)],
      { capabilities: { external: true } },
    );
    const local = new FakeLlmProvider('ollama', [JSON.stringify(VALID_OUTPUT)]);

    const result = await harness([external, local]).execute(
      extractPastedJobTask,
      { text: PASTED_TEXT },
      NO_CONSENT,
    );

    expect(result).toMatchObject({ status: 'success', providerId: 'ollama' });
    expect(external.calls).toBe(0);
    expect(local.calls).toBe(1);
  });

  it('Con consentimiento, el proveedor externo es elegible', async () => {
    const external = new FakeLlmProvider(
      'openrouter',
      [JSON.stringify(VALID_OUTPUT)],
      { capabilities: { external: true } },
    );
    // Con costes iguales el routing prefiere lo local (ADR-018 §8): se cae para que la lectura llegue al externo.
    const local = new FakeLlmProvider('ollama', [new Error('down')]);
    const prompts = new InMemoryPromptRegistry();

    const result = await harness([external, local], prompts).execute(
      extractPastedJobTask,
      { text: `${PASTED_TEXT} Escribe a laura.rios@example.com` },
      CONSENT,
    );

    expect(result).toMatchObject({
      status: 'success',
      providerId: 'openrouter',
    });
    expect(external.calls).toBe(1);
    // `personal` hacia un proveedor externo: la entrada va redactada.
    const sent = external.requests[0]?.user ?? '';
    expect(sent).not.toContain('laura.rios@example.com');
    expect(sent).toContain('[EMAIL_1]');
  });

  it('La IA dice que no es una vacante', async () => {
    const local = new FakeLlmProvider('ollama', [
      JSON.stringify({ isJobPosting: false, preview: null }),
    ]);

    const result = await harness([local]).execute(
      extractPastedJobTask,
      { text: CHAT_TEXT },
      NO_CONSENT,
    );

    expect(result).toMatchObject({
      status: 'success',
      output: { isJobPosting: false, preview: null },
    });
  });
});

describe('sampleExtractPastedJob', () => {
  it('produce una salida válida y determinista para la misma semilla', () => {
    const input = extractPastedJobInputSchema.parse({ text: PASTED_TEXT });
    const first = sampleExtractPastedJob(input, mulberry32(7));
    const second = sampleExtractPastedJob(input, mulberry32(7));

    expect(extractJobOutputSchema.safeParse(first).success).toBe(true);
    expect(first).toEqual(second);
  });

  it('usa el título y la empresa escritos aparte y no copia el texto en summary', () => {
    const output = sampleExtractPastedJob(
      extractPastedJobInputSchema.parse({
        text: `${PASTED_TEXT} Contacto: Mariela Quispe, reclutadora.`,
        knownTitle: 'Desarrollador Backend',
        knownCompany: 'Acme Bolivia',
      }),
      mulberry32(1),
    );

    expect(output).toMatchObject({
      isJobPosting: true,
      preview: {
        title: 'Desarrollador Backend',
        company: 'Acme Bolivia',
        modality: 'remote',
        summary: '',
      },
    });
    expect(JSON.stringify(output)).not.toContain('Mariela');
  });

  it('sin nada escrito aparte, no inventa la empresa', () => {
    const output = sampleExtractPastedJob(
      extractPastedJobInputSchema.parse({ text: PASTED_TEXT }),
      mulberry32(1),
    );

    expect(output.isJobPosting).toBe(true);
    expect(output.preview?.company).toBeNull();
    expect(output.preview?.title.length).toBeGreaterThan(0);
  });

  it('dice que una conversación no es una vacante', () => {
    const output = sampleExtractPastedJob(
      extractPastedJobInputSchema.parse({ text: CHAT_TEXT }),
      mulberry32(1),
    );

    expect(output).toEqual({ isJobPosting: false, preview: null });
  });
});
