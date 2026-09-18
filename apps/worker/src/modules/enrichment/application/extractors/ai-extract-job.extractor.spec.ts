import type { AiResult, AiTask, RunContext, RunTaskFn } from '@linkvault/ai';
import type { ExtractJobOutput, JobPreview } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import type { ExtractionContext } from '../../domain/extractors/extractor';
import {
  EMPTY_PAGE_CONTENT,
  type PageContent,
} from '../../domain/page-content';
import { AiExtractJobExtractor } from './ai-extract-job.extractor';

// Requisito "Extracción estructurada con IA" (specs/links/enrichment) y D7 de link-enrichment. `runTask` es un doble:
// la tarea de verdad y su mock determinista se prueban en `libs/ai`.

const CREATED_BY = '68c0f0f0f0f0f0f0f0f0f0f0';

const PREVIEW: JobPreview = {
  title: 'Full-Stack Developer Senior',
  company: 'Empresa Ejemplo',
  location: 'Remoto',
  modality: 'remote',
  seniority: 'senior',
  salary: null,
  skills: [{ name: 'TypeScript', required: true }],
  languages: [],
  summary: 'Trabajo remoto con TypeScript.',
  postedAt: null,
  expiresAt: null,
};

interface Call {
  task: AiTask<unknown, unknown>;
  input: unknown;
  ctx: RunContext;
}

/** `runTask` de mentira: devuelve lo que se le diga y anota con qué se le llamó. */
function runTaskOf(
  answer: AiResult<ExtractJobOutput> | (() => never),
): RunTaskFn & { calls: Call[] } {
  const calls: Call[] = [];
  const runTask = (<I, O>(
    task: AiTask<I, O>,
    input: I,
    ctx: RunContext,
  ): Promise<AiResult<O>> => {
    calls.push({ task: task as AiTask<unknown, unknown>, input, ctx });
    if (typeof answer === 'function') answer();
    return Promise.resolve(answer as unknown as AiResult<O>);
  }) as RunTaskFn;
  return Object.assign(runTask, { calls });
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

function contextOf(
  page: Partial<PageContent> = { text: 'Texto limpio del aviso' },
  remainingMs = 30_000,
): ExtractionContext {
  return {
    page: { ...EMPTY_PAGE_CONTENT, ...page },
    createdBy: CREATED_BY,
    remainingMs,
  };
}

describe('Salida validada', () => {
  it('puts the fields the task returns into the merge, with auto provenance', async () => {
    const runTask = runTaskOf(
      success({ isJobPosting: true, preview: PREVIEW }),
    );

    const { draft, isJobPosting } = await new AiExtractJobExtractor(
      runTask,
    ).extract(contextOf());

    expect(isJobPosting).toBe(true);
    expect(draft.title).toEqual({
      value: 'Full-Stack Developer Senior',
      extractor: 'ai:extract-job',
    });
    expect(draft.company?.value).toBe('Empresa Ejemplo');
    expect(draft.skills?.value).toEqual([
      { name: 'TypeScript', required: true },
    ]);
    // `salary: null` y `postedAt: null` son "la página no lo dice": no son una propuesta.
    expect(draft.salary).toBeUndefined();
    expect(draft.postedAt).toBeUndefined();
  });

  it('sends the clean page text to the task', async () => {
    const runTask = runTaskOf(
      success({ isJobPosting: true, preview: PREVIEW }),
    );

    await new AiExtractJobExtractor(runTask).extract(
      contextOf({ text: 'Texto limpio del aviso' }),
    );

    expect(runTask.calls[0].task.name).toBe('extract-job');
    expect(runTask.calls[0].input).toEqual({ text: 'Texto limpio del aviso' });
  });

  it('always asks for the answer in Spanish', async () => {
    // El `JobLink` es canónico y compartido: su preview no puede depender del idioma de quien lo guardó.
    const runTask = runTaskOf(
      success({ isJobPosting: true, preview: PREVIEW }),
    );

    await new AiExtractJobExtractor(runTask).extract(contextOf());

    expect(runTask.calls[0].ctx.outputLanguage).toBe('es');
  });
});

describe('La ejecución se atribuye a quien guardó el link', () => {
  it('runs with the saver as the user of the execution', async () => {
    const runTask = runTaskOf(
      success({ isJobPosting: true, preview: PREVIEW }),
    );

    await new AiExtractJobExtractor(runTask).extract(contextOf());

    expect(runTask.calls[0].ctx.userId).toBe(CREATED_BY);
  });
});

describe('La IA dice que no es una vacante', () => {
  it('lets no field of that page into the preview', async () => {
    const runTask = runTaskOf(success({ isJobPosting: false, preview: null }));

    expect(
      await new AiExtractJobExtractor(runTask).extract(contextOf()),
    ).toEqual({
      draft: {},
      isJobPosting: false,
    });
  });

  it('ignores a preview that comes with a no', async () => {
    const runTask = runTaskOf(
      success({ isJobPosting: false, preview: PREVIEW }),
    );

    expect(
      await new AiExtractJobExtractor(runTask).extract(contextOf()),
    ).toEqual({
      draft: {},
      isJobPosting: false,
    });
  });

  it('says yes with no fields when it recognises a posting it cannot read', async () => {
    // Es el otro camino a `no_data`: la IA reconoce la vacante y aun así no le saca campos.
    const runTask = runTaskOf(success({ isJobPosting: true, preview: null }));

    expect(
      await new AiExtractJobExtractor(runTask).extract(contextOf()),
    ).toEqual({
      draft: {},
      isJobPosting: true,
    });
  });
});

describe('IA degradada', () => {
  it('does not fail the job when the provider chain degrades', async () => {
    const runTask = runTaskOf({
      status: 'degraded',
      reason: 'providers_failed',
    });

    expect(
      await new AiExtractJobExtractor(runTask).extract(contextOf()),
    ).toEqual({
      draft: {},
    });
  });

  it('does not fail the job when there is no provider at all', async () => {
    const runTask = runTaskOf({ status: 'degraded', reason: 'no_providers' });

    expect(
      await new AiExtractJobExtractor(runTask).extract(contextOf()),
    ).toEqual({
      draft: {},
    });
  });

  it('does not fail the job when runTask throws', async () => {
    const runTask = runTaskOf(() => {
      throw new Error('el proveedor reventó');
    });

    expect(
      await new AiExtractJobExtractor(runTask).extract(contextOf()),
    ).toEqual({
      draft: {},
    });
  });

  it('does not pronounce on what the page is when it could not read it', async () => {
    // Una degradación no es un "no es una vacante": el motivo sería `no_data`, no `not_a_job`.
    const runTask = runTaskOf({ status: 'degraded', reason: 'quota_exceeded' });

    const outcome = await new AiExtractJobExtractor(runTask).extract(
      contextOf(),
    );

    expect(outcome.isJobPosting).toBeUndefined();
  });
});

describe('Plazo agotado', () => {
  it('does not run when there is no deadline left', async () => {
    const runTask = runTaskOf(
      success({ isJobPosting: true, preview: PREVIEW }),
    );

    expect(
      await new AiExtractJobExtractor(runTask).extract(contextOf(undefined, 0)),
    ).toEqual({ draft: {} });
    expect(runTask.calls).toEqual([]);
  });

  it('gives the execution what is left of the link deadline', async () => {
    const runTask = runTaskOf(
      success({ isJobPosting: true, preview: PREVIEW }),
    );

    await new AiExtractJobExtractor(runTask).extract(
      contextOf(undefined, 5_000),
    );

    expect(runTask.calls[0].ctx.signal?.aborted).toBe(false);
  });

  it('aborts the execution when the link deadline is already gone', async () => {
    const runTask = runTaskOf(
      success({ isJobPosting: true, preview: PREVIEW }),
    );
    const context = { ...contextOf(), signal: AbortSignal.abort() };

    await new AiExtractJobExtractor(runTask).extract(context);

    expect(runTask.calls[0].ctx.signal?.aborted).toBe(true);
  });
});

describe('Cuándo tiene sentido ejecutar la etapa', () => {
  it('needs text to read', () => {
    const extractor = new AiExtractJobExtractor(
      runTaskOf(success({ isJobPosting: true, preview: PREVIEW })),
    );

    expect(extractor.supports({ ...EMPTY_PAGE_CONTENT, text: 'Algo' })).toBe(
      true,
    );
    expect(extractor.supports({ ...EMPTY_PAGE_CONTENT, text: '   ' })).toBe(
      false,
    );
    expect(extractor.supports(EMPTY_PAGE_CONTENT)).toBe(false);
  });
});
