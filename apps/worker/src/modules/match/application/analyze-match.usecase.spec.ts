import type {
  AiResult,
  MatchCvInput,
  MatchCvOutput,
  RunContext,
  RunTaskFn,
} from '@linkvault/ai';
import { matchCvTask } from '@linkvault/ai';
import { beforeEach, describe, expect, it } from 'vitest';
import { AnalyzeMatchUseCase } from './analyze-match.usecase';
import {
  ANALYSIS_ID,
  CV_ID,
  InMemoryAiContextReader,
  InMemoryAnalysisRepository,
  InMemoryCvTextReader,
  InMemoryJobReader,
  LINK_ID,
  MovableClock,
  USER_ID,
  sampleDegradedReport,
  sampleJob,
  sampleReport,
  sampleRunningAnalysis,
} from './testing/match-test-doubles';

const PAYLOAD = {
  analysisId: ANALYSIS_ID,
  userId: USER_ID,
  linkId: LINK_ID,
  cvId: CV_ID,
} as const;

const CORE: MatchCvOutput = {
  score: 70,
  matchedSkills: ['TypeScript'],
  missingSkills: [{ name: 'NestJS', importance: 'must' }],
  suggestions: [
    {
      section: 'skills',
      after: 'Incluir NestJS.',
      reason: 'La vacante lo pide.',
      evidence: {
        jobRequirement: 'NestJS',
        importance: 'must',
        cvFragment: null,
      },
    },
  ],
};

interface RunTaskSpy {
  readonly fn: RunTaskFn;
  readonly calls: { input: MatchCvInput; ctx: RunContext }[];
  readonly externalSends: number;
  setResult: (result: AiResult<MatchCvOutput>) => void;
  setImpl: (
    impl: (
      input: MatchCvInput,
      ctx: RunContext,
    ) => Promise<AiResult<MatchCvOutput>>,
  ) => void;
}

function runTaskSpy(
  initial: AiResult<MatchCvOutput> = {
    status: 'success',
    output: CORE,
    providerId: 'mock',
    model: 'mock-model',
    promptVersion: 'v1',
    cached: false,
  },
): RunTaskSpy {
  const calls: { input: MatchCvInput; ctx: RunContext }[] = [];
  let externalSends = 0;
  let result = initial;
  let impl:
    | ((
        input: MatchCvInput,
        ctx: RunContext,
      ) => Promise<AiResult<MatchCvOutput>>)
    | null = null;

  const fn: RunTaskFn = (async (_task, input, ctx) => {
    calls.push({ input: input as MatchCvInput, ctx });
    if (impl !== null) {
      return await impl(input as MatchCvInput, ctx);
    }
    if (ctx.aiConsent.externalProviders && result.status === 'success') {
      if (result.providerId === 'openrouter') {
        externalSends += 1;
      }
    }
    return result;
  }) as RunTaskFn;

  return {
    get calls() {
      return calls;
    },
    get externalSends() {
      return externalSends;
    },
    get fn() {
      return fn;
    },
    setResult(next) {
      result = next;
    },
    setImpl(next) {
      impl = next;
    },
  };
}

let analyses: InMemoryAnalysisRepository;
let cvs: InMemoryCvTextReader;
let jobs: InMemoryJobReader;
let aiContext: InMemoryAiContextReader;
let clock: MovableClock;
let spy: RunTaskSpy;
let useCase: AnalyzeMatchUseCase;

beforeEach(() => {
  clock = new MovableClock();
  analyses = new InMemoryAnalysisRepository();
  analyses.clock = clock;
  analyses.maxAgeMs = 120_000;
  cvs = new InMemoryCvTextReader().with(CV_ID, USER_ID);
  jobs = new InMemoryJobReader().with(sampleJob());
  aiContext = new InMemoryAiContextReader();
  spy = runTaskSpy();
  useCase = new AnalyzeMatchUseCase(
    analyses,
    cvs,
    jobs,
    aiContext,
    spy.fn,
    clock,
    { timeoutMs: 60_000, maxAgeMs: 120_000 },
  );
  analyses.seed(
    sampleRunningAnalysis({
      id: ANALYSIS_ID,
      userId: USER_ID,
      linkId: LINK_ID,
      cvId: CV_ID,
      requestedAt: clock.now(),
    }),
  );
});

describe('AnalyzeMatchUseCase re-read (D12-bis)', () => {
  it('El mismo trabajo entregado tres veces', async () => {
    await useCase.execute(PAYLOAD);
    expect((await analyses.findById(ANALYSIS_ID))?.status).toBe('done');
    const sendsAfterFirst = spy.calls.length;

    await useCase.execute(PAYLOAD);
    await useCase.execute(PAYLOAD);

    expect(spy.calls.length).toBe(sendsAfterFirst);
    expect((await analyses.findById(ANALYSIS_ID))?.status).toBe('done');
  });

  it('Un fallo no multiplica los envíos', async () => {
    let sends = 0;
    spy.setImpl(async (_input, ctx) => {
      if (ctx.aiConsent.externalProviders) {
        sends += 1;
      }
      throw new Error('provider blew up');
    });
    aiContext.with(USER_ID, { aiConsent: { externalProviders: true } });

    await expect(useCase.execute(PAYLOAD)).rejects.toThrow('provider blew up');
    expect(sends).toBe(1);
    await useCase.markRetriesExhausted(PAYLOAD);
    expect((await analyses.findById(ANALYSIS_ID))?.status).toBe('failed');

    await useCase.execute(PAYLOAD);
    expect(sends).toBe(1);
  });

  it('abandons when the analysis was purged with the CV', async () => {
    analyses.purge(ANALYSIS_ID);
    expect(await useCase.execute(PAYLOAD)).toEqual({ kind: 'abandoned' });
    expect(spy.calls).toHaveLength(0);
  });

  it('abandons when the running analysis already expired', async () => {
    clock.advance(120_001);
    expect(await useCase.execute(PAYLOAD)).toEqual({ kind: 'abandoned' });
    expect(spy.calls).toHaveLength(0);
  });
});

describe('AnalyzeMatchUseCase happy path', () => {
  it('reads CV and job, passes fresh AI context into runTask, and stores the report', async () => {
    aiContext.with(USER_ID, {
      aiConsent: { externalProviders: false },
      outputLanguage: 'en',
      redactName: true,
      personName: 'Ana',
    });

    const result = await useCase.execute(PAYLOAD);

    expect(result).toEqual({ kind: 'done' });
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]?.ctx).toMatchObject({
      userId: USER_ID,
      aiConsent: { externalProviders: false },
      outputLanguage: 'en',
      redactName: true,
      personName: 'Ana',
    });
    expect(spy.calls[0]?.input.cv.text).toContain('TypeScript');
    const saved = await analyses.findById(ANALYSIS_ID);
    expect(saved).toMatchObject({
      status: 'done',
      step: 'done',
      provider: 'mock',
      wentExternal: false,
      consentRequired: false,
    });
    expect(saved?.report?.score).toBe(70);
    expect(saved?.finishedAt).toBeDefined();
    expect(saved?.durationMs).toBeDefined();
  });

  it('Con consentimiento hacia un proveedor externo', async () => {
    aiContext.with(USER_ID, { aiConsent: { externalProviders: true } });
    spy.setResult({
      status: 'success',
      output: CORE,
      providerId: 'openrouter',
      model: 'free-model',
      promptVersion: 'v1',
      cached: false,
    });

    await useCase.execute(PAYLOAD);

    expect(spy.calls[0]?.ctx.aiConsent.externalProviders).toBe(true);
    expect((await analyses.findById(ANALYSIS_ID))?.wentExternal).toBe(true);
  });
});

describe('AnalyzeMatchUseCase steps', () => {
  it('records progress steps for the three outcomes', async () => {
    await useCase.execute(PAYLOAD);
    expect((await analyses.findById(ANALYSIS_ID))?.step).toBe('done');

    analyses.seed(
      sampleRunningAnalysis({
        id: '66e9a0000000000000000b02',
        userId: USER_ID,
        linkId: LINK_ID,
        cvId: CV_ID,
        requestedAt: clock.now(),
      }),
    );
    spy.setResult({
      status: 'degraded',
      reason: 'no_providers',
      output: {
        score: 40,
        matchedSkills: [],
        missingSkills: [],
        suggestions: [],
      },
    });
    await useCase.execute({
      ...PAYLOAD,
      analysisId: '66e9a0000000000000000b02',
    });
    expect(
      (await analyses.findById('66e9a0000000000000000b02'))?.step,
    ).toBe('done-degraded');
  });

  it('keeps completing when recordStep throws', async () => {
    analyses.recordStepError = new Error('step store down');
    const result = await useCase.execute(PAYLOAD);
    expect(result).toEqual({ kind: 'done' });
    expect((await analyses.findById(ANALYSIS_ID))?.status).toBe('done');
  });
});

describe('AnalyzeMatchUseCase degradation', () => {
  it.each([
    ['Toda la cadena falló', 'providers_failed' as const],
    ['Sin IA configurada', 'no_providers' as const],
    ['Faltar el permiso', 'consent_required' as const],
  ])('%s', async (_name, reason) => {
    spy.setResult({
      status: 'degraded',
      reason,
      output: {
        score: 30,
        matchedSkills: ['TypeScript'],
        missingSkills: [],
        suggestions: [],
      },
    });

    await useCase.execute(PAYLOAD);

    const saved = await analyses.findById(ANALYSIS_ID);
    expect(saved?.status).toBe('done');
    expect(saved?.degraded).toBe(true);
    expect(saved?.degradedReason).toBe(reason);
    expect(saved?.report?.suggestions).toEqual([]);
    expect(saved?.consentRequired).toBe(reason === 'consent_required');
  });

  it('La cuota de IA agotada dice cuándo volver', async () => {
    const retryAt = new Date('2026-09-20T18:00:00.000Z');
    spy.setResult({
      status: 'degraded',
      reason: 'quota_exceeded',
      aiQuotaRetryAt: retryAt.toISOString(),
      output: {
        score: 20,
        matchedSkills: [],
        missingSkills: [],
        suggestions: [],
      },
    });

    await useCase.execute(PAYLOAD);

    const saved = await analyses.findById(ANALYSIS_ID);
    expect(saved?.aiQuotaRetryAt?.toISOString()).toBe(retryAt.toISOString());
    expect(saved?.report?.aiQuotaRetryAt).toBe(retryAt.toISOString());
  });

  it('Un degradado con sugerencias no se guarda', async () => {
    spy.setResult({
      status: 'degraded',
      reason: 'no_providers',
      output: CORE,
    });

    await useCase.execute(PAYLOAD);

    const saved = await analyses.findById(ANALYSIS_ID);
    expect(saved?.status).toBe('failed');
    expect(saved?.failureCode).toBe('internal_error');
    expect(saved?.report).toBeUndefined();
  });

  it('El motivo distingue los cuatro casos', async () => {
    const reasons = [
      'consent_required',
      'providers_failed',
      'no_providers',
      'quota_exceeded',
    ] as const;
    const seen = new Set<string>();
    for (const [index, reason] of reasons.entries()) {
      const id = `66e9a0000000000000000b1${String(index)}`;
      analyses.seed(
        sampleRunningAnalysis({
          id,
          userId: USER_ID,
          linkId: LINK_ID,
          cvId: CV_ID,
          requestedAt: clock.now(),
        }),
      );
      spy.setResult({
        status: 'degraded',
        reason,
        ...(reason === 'quota_exceeded'
          ? { aiQuotaRetryAt: clock.now().toISOString() }
          : {}),
        output: {
          score: 10,
          matchedSkills: [],
          missingSkills: [],
          suggestions: [],
        },
      });
      await useCase.execute({ ...PAYLOAD, analysisId: id });
      seen.add((await analyses.findById(id))?.degradedReason ?? '');
    }
    expect(seen.size).toBe(4);
  });
});

describe('AnalyzeMatchUseCase consentRequired', () => {
  it('Sin consentimiento y con proveedor local', async () => {
    aiContext.with(USER_ID, { aiConsent: { externalProviders: false } });
    spy.setResult({
      status: 'success',
      output: CORE,
      providerId: 'ollama',
      model: 'llama',
      promptVersion: 'v1',
      cached: false,
    });
    await useCase.execute(PAYLOAD);
    expect((await analyses.findById(ANALYSIS_ID))?.consentRequired).toBe(false);
    expect((await analyses.findById(ANALYSIS_ID))?.wentExternal).toBe(false);
  });

  it('Sin consentimiento y sin proveedor local', async () => {
    aiContext.with(USER_ID, { aiConsent: { externalProviders: false } });
    spy.setResult({
      status: 'degraded',
      reason: 'consent_required',
      output: {
        score: 10,
        matchedSkills: [],
        missingSkills: [],
        suggestions: [],
      },
    });
    await useCase.execute(PAYLOAD);
    expect((await analyses.findById(ANALYSIS_ID))?.consentRequired).toBe(true);
  });

  it('Faltar el permiso no explica una avería ajena', async () => {
    aiContext.with(USER_ID, { aiConsent: { externalProviders: false } });
    spy.setResult({
      status: 'degraded',
      reason: 'no_providers',
      output: {
        score: 10,
        matchedSkills: [],
        missingSkills: [],
        suggestions: [],
      },
    });
    await useCase.execute(PAYLOAD);
    expect((await analyses.findById(ANALYSIS_ID))?.consentRequired).toBe(false);
    expect((await analyses.findById(ANALYSIS_ID))?.degradedReason).toBe(
      'no_providers',
    );
  });

  it('El consentimiento es el de quien pide', async () => {
    const beto = '66e9a0000000000000000a02';
    aiContext.with(USER_ID, { aiConsent: { externalProviders: true } });
    aiContext.with(beto, { aiConsent: { externalProviders: false } });
    analyses.seed(
      sampleRunningAnalysis({
        id: ANALYSIS_ID,
        userId: beto,
        linkId: LINK_ID,
        cvId: CV_ID,
        requestedAt: clock.now(),
      }),
    );
    cvs.with(CV_ID, beto);
    spy.setImpl(async (_input, ctx) => {
      expect(ctx.userId).toBe(beto);
      expect(ctx.aiConsent.externalProviders).toBe(false);
      return {
        status: 'degraded',
        reason: 'consent_required',
        output: {
          score: 5,
          matchedSkills: [],
          missingSkills: [],
          suggestions: [],
        },
      };
    });
    await useCase.execute({ ...PAYLOAD, userId: beto });
    expect((await analyses.findById(ANALYSIS_ID))?.consentRequired).toBe(true);
  });
});

describe('AnalyzeMatchUseCase consent revocation window', () => {
  it('Consentimiento retirado entre la petición y la ejecución', async () => {
    aiContext.with(USER_ID, { aiConsent: { externalProviders: false } });
    let externalHits = 0;
    spy.setImpl(async (_input, ctx) => {
      if (ctx.aiConsent.externalProviders) {
        externalHits += 1;
        return {
          status: 'success',
          output: CORE,
          providerId: 'openrouter',
          model: 'x',
          promptVersion: 'v1',
          cached: false,
        };
      }
      return {
        status: 'degraded',
        reason: 'consent_required',
        output: {
          score: 5,
          matchedSkills: [],
          missingSkills: [],
          suggestions: [],
        },
      };
    });

    await useCase.execute(PAYLOAD);

    expect(externalHits).toBe(0);
    expect((await analyses.findById(ANALYSIS_ID))?.consentRequired).toBe(true);
  });

  it('Revocar corta lo que aún no salió', async () => {
    aiContext.with(USER_ID, { aiConsent: { externalProviders: false } });
    await useCase.execute(PAYLOAD);
    expect(spy.externalSends).toBe(0);
  });

  it('Revocación con una ejecución ya enviada', async () => {
    aiContext.with(USER_ID, { aiConsent: { externalProviders: true } });
    spy.setResult({
      status: 'success',
      output: CORE,
      providerId: 'openrouter',
      model: 'x',
      promptVersion: 'v1',
      cached: false,
    });
    await useCase.execute(PAYLOAD);
    expect((await analyses.findById(ANALYSIS_ID))?.status).toBe('done');
    expect((await analyses.findById(ANALYSIS_ID))?.wentExternal).toBe(true);
  });
});

describe('AnalyzeMatchUseCase failure cuts', () => {
  it('análisis inexistente abandons without writing', async () => {
    analyses.purge(ANALYSIS_ID);
    expect(await useCase.execute(PAYLOAD)).toEqual({ kind: 'abandoned' });
  });

  it('carrera perdida marks failed when still running after a missed complete', async () => {
    const original = analyses.complete.bind(analyses);
    analyses.complete = async () => false;
    // Keep findById returning running so afterUnwrittenComplete fails it.
    const result = await useCase.execute(PAYLOAD);
    expect(result).toEqual({ kind: 'failed' });
    analyses.complete = original;
  });

  it('CV borrado antes de leerse', async () => {
    cvs = new InMemoryCvTextReader();
    useCase = new AnalyzeMatchUseCase(
      analyses,
      cvs,
      jobs,
      aiContext,
      spy.fn,
      clock,
      { timeoutMs: 60_000, maxAgeMs: 120_000 },
    );
    await useCase.execute(PAYLOAD);
    const saved = await analyses.findById(ANALYSIS_ID);
    expect(saved?.status).toBe('failed');
    expect(saved?.failureCode).toBe('internal_error');
  });

  it('texto del CV ilegible en el almacén', async () => {
    cvs.with(CV_ID, USER_ID, { kind: 'unreadable' });
    await useCase.execute(PAYLOAD);
    expect((await analyses.findById(ANALYSIS_ID))?.failureCode).toBe(
      'internal_error',
    );
  });

  it('MATCH_ANALYSIS_TIMEOUT_MS leaves failed with internal_error', async () => {
    useCase = new AnalyzeMatchUseCase(
      analyses,
      cvs,
      jobs,
      aiContext,
      spy.fn,
      clock,
      { timeoutMs: 1, maxAgeMs: 120_000 },
    );
    spy.setImpl(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return {
        status: 'success',
        output: CORE,
        providerId: 'mock',
        model: 'm',
        promptVersion: 'v1',
        cached: false,
      };
    });
    await useCase.execute(PAYLOAD);
    const saved = await analyses.findById(ANALYSIS_ID);
    expect(saved?.status).toBe('failed');
    expect(saved?.failureCode).toBe('internal_error');
  });

  it('Lo guardado dice por qué falló', async () => {
    cvs.with(CV_ID, USER_ID, { kind: 'unreadable' });
    await useCase.execute(PAYLOAD);
    const saved = await analyses.findById(ANALYSIS_ID);
    expect(saved?.failureCode).toBe('internal_error');
    expect(saved?.report).toBeUndefined();
  });

  it('none leaves the analysis running or restarts on its own', async () => {
    cvs.with(CV_ID, USER_ID, { kind: 'missing' });
    await useCase.execute(PAYLOAD);
    expect((await analyses.findById(ANALYSIS_ID))?.status).not.toBe('running');
    const calls = spy.calls.length;
    await useCase.execute(PAYLOAD);
    expect(spy.calls.length).toBe(calls);
  });
});

describe('sample helpers', () => {
  it('builds reports used by other suites', () => {
    expect(sampleReport().degraded).toBe(false);
    expect(sampleDegradedReport('no_providers').suggestions).toEqual([]);
    expect(matchCvTask.name).toBe('match-cv');
  });
});
