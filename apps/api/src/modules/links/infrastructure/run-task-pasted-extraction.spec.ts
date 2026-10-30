import {
  FixtureMissing,
  type AiResult,
  type AiTask,
  type RunContext,
  type RunTaskFn,
} from '@linkvault/ai';
import type { ExtractJobOutput, JobPreview } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryLinkUserDirectory } from '../application/testing/links-test-doubles';
import { objectId } from '../application/testing/link-fixtures';
import { RunTaskPastedExtraction } from './run-task-pasted-extraction';

// Adaptador PASTED_EXTRACTION (tarea 5.2 de paste-job-description) con dobles de `RUN_TASK`: qué le llega a `runTask` y
// cómo se traduce cada resultado. Que el mock en `replay` responda con los fixtures del golden lo prueban los tests de
// integración del endpoint; que el enrutado de `libs/ai` descarte un proveedor externo sin consentimiento, los de la
// tarea en `libs/ai`.

const ANA = objectId(1);
const BETO = objectId(2);

const preview: JobPreview = {
  title: 'Arquitecta de Datos',
  company: 'Datos Andinos',
  location: null,
  modality: 'remote',
  seniority: 'senior',
  salary: null,
  skills: [],
  languages: [],
  summary: 'Diseñar el modelo de datos.',
  postedAt: null,
  expiresAt: null,
};

/** Una llamada a `runTask`, tal y como la recibió el doble. */
interface RecordedCall {
  readonly taskName: string;
  readonly dataSensitivity: string | undefined;
  readonly input: unknown;
  readonly ctx: RunContext;
}

/** `RUN_TASK` que apunta lo que recibe y responde lo que decida `answer`. */
function runTaskDouble(
  answer: (ctx: RunContext) => Promise<AiResult<ExtractJobOutput>>,
): { runTask: RunTaskFn; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const runTask = (<I, O>(
    task: AiTask<I, O>,
    input: I,
    ctx: RunContext,
  ): Promise<AiResult<O>> => {
    calls.push({
      taskName: task.name,
      dataSensitivity: task.dataSensitivity,
      input,
      ctx,
    });
    // El doble solo sirve a `extract-pasted-job`, cuya salida es `ExtractJobOutput`.
    return answer(ctx) as Promise<AiResult<O>>;
  }) as RunTaskFn;
  return { runTask, calls };
}

function success(output: ExtractJobOutput): AiResult<ExtractJobOutput> {
  return {
    status: 'success',
    output,
    providerId: 'mock',
    model: 'mock',
    promptVersion: 'v1',
    cached: false,
  };
}

let directory: InMemoryLinkUserDirectory;

beforeEach(() => {
  directory = new InMemoryLinkUserDirectory().withConsent(BETO);
});

describe('RunTaskPastedExtraction', () => {
  it('reads the text with extract-pasted-job, as whoever pastes, in Spanish', async () => {
    const { runTask, calls } = runTaskDouble(() =>
      Promise.resolve(success({ isJobPosting: true, preview })),
    );
    const adapter = new RunTaskPastedExtraction(runTask, directory, 20_000);

    const result = await adapter.extract({
      userId: ANA,
      text: 'Arquitecta de Datos en Datos Andinos, remoto.',
      knownTitle: 'Arquitecta de Datos',
    });

    expect(result).toEqual({ outcome: 'extracted', fields: preview });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      taskName: 'extract-pasted-job',
      dataSensitivity: 'personal',
      input: {
        text: 'Arquitecta de Datos en Datos Andinos, remoto.',
        knownTitle: 'Arquitecta de Datos',
      },
      ctx: { userId: ANA, outputLanguage: 'es' },
    });
    expect(calls[0]?.input).not.toHaveProperty('knownCompany');
  });

  it('takes emails and phones out before the text reaches the AI', async () => {
    const { runTask, calls } = runTaskDouble(() =>
      Promise.resolve(success({ isJobPosting: true, preview })),
    );
    const adapter = new RunTaskPastedExtraction(runTask, directory, 20_000);

    await adapter.extract({
      userId: ANA,
      text: 'Arquitecta de Datos.\nEscribe a rrhh@datosandinos.bo o al +591 71234567.',
    });

    const input = JSON.stringify(calls[0]?.input);
    expect(input).not.toContain('rrhh@datosandinos.bo');
    expect(input).not.toContain('71234567');
  });

  it('does not call the AI when nothing is left after taking out the contact details', async () => {
    const { runTask, calls } = runTaskDouble(() =>
      Promise.resolve(success({ isJobPosting: true, preview })),
    );
    const adapter = new RunTaskPastedExtraction(runTask, directory, 20_000);

    expect(
      await adapter.extract({ userId: ANA, text: '+591 71234567' }),
    ).toEqual({ outcome: 'not_a_job_posting' });
    expect(calls).toHaveLength(0);
  });

  it('answers that it is not a job posting when the AI says so', async () => {
    const { runTask } = runTaskDouble(() =>
      Promise.resolve(success({ isJobPosting: false, preview: null })),
    );
    const adapter = new RunTaskPastedExtraction(runTask, directory, 20_000);

    expect(
      await adapter.extract({ userId: ANA, text: 'hola, ¿cómo estás?' }),
    ).toEqual({ outcome: 'not_a_job_posting' });
  });

  it('a job posting without fields is still a job posting, with nothing to write', async () => {
    const { runTask } = runTaskDouble(() =>
      Promise.resolve(success({ isJobPosting: true, preview: null })),
    );
    const adapter = new RunTaskPastedExtraction(runTask, directory, 20_000);

    expect(await adapter.extract({ userId: ANA, text: 'Oferta.' })).toEqual({
      outcome: 'extracted',
      fields: {},
    });
  });

  /** Un degradado de `runTask`, con la condición del proveedor si la hay. */
  function degraded(
    reason: 'providers_failed' | 'no_providers' | 'consent_required',
    kind?: 'consent_missing' | 'unavailable' | 'rate_limited' | 'rejected',
  ): AiResult<ExtractJobOutput> {
    return {
      status: 'degraded',
      reason,
      ...(kind === undefined ? {} : { providerCondition: { kind } }),
    };
  }

  it.each([
    [
      'consent_required is consent_required',
      degraded('consent_required'),
      'consent_required',
    ],
    [
      'no_providers with consent_missing condition is consent_required',
      degraded('no_providers', 'consent_missing'),
      'consent_required',
    ],
    [
      'rate_limited is capacity_exhausted',
      degraded('providers_failed', 'rate_limited'),
      'capacity_exhausted',
    ],
    [
      'rate_limited with the circuit open is capacity_exhausted',
      degraded('no_providers', 'rate_limited'),
      'capacity_exhausted',
    ],
    [
      'rejected is disabled',
      degraded('providers_failed', 'rejected'),
      'disabled',
    ],
    [
      'no_providers without condition is disabled',
      degraded('no_providers'),
      'disabled',
    ],
    [
      'unavailable condition is unavailable',
      degraded('providers_failed', 'unavailable'),
      'unavailable',
    ],
    [
      'providers_failed without condition is unavailable',
      degraded('providers_failed'),
      'unavailable',
    ],
  ] as const)('%s', async (_title, answer, outcome) => {
    const { runTask } = runTaskDouble(() => Promise.resolve(answer));
    const adapter = new RunTaskPastedExtraction(runTask, directory, 20_000);

    expect(await adapter.extract({ userId: ANA, text: 'Oferta.' })).toEqual({
      outcome,
    });
  });

  it('quota_exceeded carries aiQuotaRetryAt', async () => {
    const { runTask } = runTaskDouble(() =>
      Promise.resolve({
        status: 'degraded',
        reason: 'quota_exceeded',
        aiQuotaRetryAt: '2026-10-30T13:00:00.000Z',
      }),
    );
    const adapter = new RunTaskPastedExtraction(runTask, directory, 20_000);

    expect(await adapter.extract({ userId: ANA, text: 'Oferta.' })).toEqual({
      outcome: 'quota_exceeded',
      retryAt: new Date('2026-10-30T13:00:00.000Z'),
    });
  });

  it('quota_exceeded without an instant has no retryAt', async () => {
    const { runTask } = runTaskDouble(() =>
      Promise.resolve({ status: 'degraded', reason: 'quota_exceeded' }),
    );
    const adapter = new RunTaskPastedExtraction(runTask, directory, 20_000);

    expect(await adapter.extract({ userId: ANA, text: 'Oferta.' })).toEqual({
      outcome: 'quota_exceeded',
    });
  });

  it('gives up when the deadline passes, as unavailable', async () => {
    // Como `runTask`: espera al proveedor hasta que la señal se aborta, y entonces degrada.
    const { runTask, calls } = runTaskDouble(
      (ctx) =>
        new Promise((resolve) => {
          ctx.signal?.addEventListener('abort', () =>
            resolve({ status: 'degraded', reason: 'providers_failed' }),
          );
        }),
    );
    const adapter = new RunTaskPastedExtraction(runTask, directory, 20);

    expect(await adapter.extract({ userId: ANA, text: 'Oferta.' })).toEqual({
      outcome: 'unavailable',
    });
    expect(calls[0]?.ctx.signal?.aborted).toBe(true);
  });

  it('stops reading when the client closes the connection', async () => {
    const clientClosed = new AbortController();
    const { runTask, calls } = runTaskDouble(
      (ctx) =>
        new Promise((resolve) => {
          ctx.signal?.addEventListener('abort', () =>
            resolve({ status: 'degraded', reason: 'providers_failed' }),
          );
          clientClosed.abort();
        }),
    );
    const adapter = new RunTaskPastedExtraction(runTask, directory, 20_000);

    const result = await adapter.extract({
      userId: ANA,
      text: 'Oferta.',
      signal: clientClosed.signal,
    });

    expect(result).toEqual({ outcome: 'unavailable' });
    expect(calls[0]?.ctx.signal?.aborted).toBe(true);
  });

  it('answers unavailable without calling the AI when the consent cannot be read', async () => {
    const { runTask, calls } = runTaskDouble(() =>
      Promise.resolve(success({ isJobPosting: true, preview })),
    );
    const warnings: string[] = [];
    const adapter = new RunTaskPastedExtraction(
      runTask,
      directory.failConsent(),
      20_000,
      { warn: (message) => warnings.push(message) },
    );

    expect(await adapter.extract({ userId: ANA, text: 'Oferta.' })).toEqual({
      outcome: 'unavailable',
    });
    expect(calls).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain(ANA);
  });

  it('lets a programming error through, so the test that causes it fails', async () => {
    const { runTask } = runTaskDouble(() =>
      Promise.reject(new FixtureMissing('abc')),
    );
    const adapter = new RunTaskPastedExtraction(runTask, directory, 20_000);

    await expect(
      adapter.extract({ userId: ANA, text: 'Oferta.' }),
    ).rejects.toBeInstanceOf(FixtureMissing);
  });
});

describe('consent of whoever pastes', () => {
  /**
   * `RUN_TASK` con una cadena de un proveedor externo antes que uno local, que aplica la regla de ADR-018 §11: una tarea
   * `personal` solo va al externo con el consentimiento del contexto. El enrutado real lo prueba `libs/ai`; aquí se
   * prueba que el consentimiento que llega es el del perfil de quien pega.
   */
  function chainWithExternalFirst() {
    const chosen: string[] = [];
    const { runTask, calls } = runTaskDouble((ctx) => {
      const external =
        calls.at(-1)?.dataSensitivity === 'public' ||
        ctx.aiConsent.externalProviders;
      chosen.push(external ? 'openrouter' : 'ollama');
      return Promise.resolve(success({ isJobPosting: true, preview }));
    });
    return { runTask, calls, chosen };
  }

  it('Con consentimiento, el proveedor externo es elegible', async () => {
    const { runTask, calls, chosen } = chainWithExternalFirst();
    const adapter = new RunTaskPastedExtraction(runTask, directory, 20_000);

    await adapter.extract({ userId: BETO, text: 'Oferta.' });

    expect(calls[0]?.ctx.aiConsent).toEqual({ externalProviders: true });
    expect(chosen).toEqual(['openrouter']);
  });

  it('Sin consentimiento, sin proveedor externo', async () => {
    const { runTask, calls, chosen } = chainWithExternalFirst();
    const adapter = new RunTaskPastedExtraction(runTask, directory, 20_000);

    await adapter.extract({ userId: ANA, text: 'Oferta.' });

    expect(calls[0]?.ctx.aiConsent).toEqual({ externalProviders: false });
    expect(chosen).toEqual(['ollama']);
  });
});
