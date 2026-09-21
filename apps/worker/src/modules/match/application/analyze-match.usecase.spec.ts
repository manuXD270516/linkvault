import type {
  AiResult,
  AiTask,
  CritiqueSuggestionsOutput,
  MatchCvInput,
  MatchCvOutput,
  RunContext,
  RunTaskFn,
} from '@linkvault/ai';
import { matchCvTask } from '@linkvault/ai';
import type { AnalysisStepEvent } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { AnalyzeMatchUseCase } from './analyze-match.usecase';
import type { AnalysisStepNotifier } from './ports/analysis-step-notifier.port';
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

const CRITIQUE_ACCEPT: AiResult<CritiqueSuggestionsOutput> = {
  status: 'success',
  output: { score: 0.85, issues: [] },
  providerId: 'mock',
  model: 'judge-model',
  promptVersion: 'v1',
  cached: false,
};

const CRITIQUE_REJECT: AiResult<CritiqueSuggestionsOutput> = {
  status: 'success',
  output: { score: 0.4, issues: ['Sugerencias genéricas.'] },
  providerId: 'openrouter',
  model: 'judge-other',
  promptVersion: 'v1',
  cached: false,
};

interface RunTaskCall {
  readonly taskName: string;
  readonly input: unknown;
  readonly ctx: RunContext;
}

interface RunTaskSpy {
  readonly fn: RunTaskFn;
  readonly calls: RunTaskCall[];
  readonly externalSends: number;
  setResult: (result: AiResult<MatchCvOutput>) => void;
  setCritiqueResult: (result: AiResult<CritiqueSuggestionsOutput>) => void;
  setImpl: (
    impl: (
      task: AiTask<unknown, unknown>,
      input: unknown,
      ctx: RunContext,
    ) => Promise<AiResult<unknown>>,
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
  const calls: RunTaskCall[] = [];
  let externalSends = 0;
  let matchResult = initial;
  let critiqueResult: AiResult<CritiqueSuggestionsOutput> = CRITIQUE_ACCEPT;
  let impl:
    | ((
        task: AiTask<unknown, unknown>,
        input: unknown,
        ctx: RunContext,
      ) => Promise<AiResult<unknown>>)
    | null = null;

  const fn: RunTaskFn = (async (task, input, ctx) => {
    calls.push({ taskName: task.name, input, ctx });
    if (impl !== null) {
      return await impl(task, input, ctx);
    }
    if (task.name === 'critique-suggestions') {
      return critiqueResult;
    }
    if (ctx.aiConsent.externalProviders && matchResult.status === 'success') {
      if (matchResult.providerId === 'openrouter') {
        externalSends += 1;
      }
    }
    return matchResult;
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
      matchResult = next;
    },
    setCritiqueResult(next) {
      critiqueResult = next;
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
let steps: RecordingStepNotifier;
let useCase: AnalyzeMatchUseCase;

/** Doble del publicador: apunta qué se avisó y puede fallar a propósito. */
class RecordingStepNotifier implements AnalysisStepNotifier {
  readonly published: AnalysisStepEvent[] = [];
  failWith: Error | null = null;

  publish(event: AnalysisStepEvent): Promise<void> {
    if (this.failWith !== null) {
      return Promise.reject(this.failWith);
    }
    this.published.push(event);
    return Promise.resolve();
  }
}

function buildUseCase(
  overrides: {
    cvs?: InMemoryCvTextReader;
    options?: { timeoutMs: number; maxAgeMs: number };
  } = {},
): AnalyzeMatchUseCase {
  return new AnalyzeMatchUseCase(
    analyses,
    overrides.cvs ?? cvs,
    jobs,
    aiContext,
    spy.fn,
    clock,
    overrides.options ?? { timeoutMs: 60_000, maxAgeMs: 120_000 },
    steps,
  );
}

beforeEach(() => {
  clock = new MovableClock();
  analyses = new InMemoryAnalysisRepository();
  analyses.clock = clock;
  analyses.maxAgeMs = 120_000;
  cvs = new InMemoryCvTextReader().with(CV_ID, USER_ID);
  jobs = new InMemoryJobReader().with(sampleJob());
  aiContext = new InMemoryAiContextReader();
  spy = runTaskSpy();
  steps = new RecordingStepNotifier();
  useCase = buildUseCase();
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
    spy.setImpl(async (task, _input, ctx) => {
      if (task.name === 'match-cv' && ctx.aiConsent.externalProviders) {
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
    expect(spy.calls.map((c) => c.taskName)).toEqual([
      'match-cv',
      'critique-suggestions',
    ]);
    expect(spy.calls[0]?.ctx).toMatchObject({
      userId: USER_ID,
      aiConsent: { externalProviders: false },
      outputLanguage: 'en',
      redactName: true,
      personName: 'Ana',
    });
    expect((spy.calls[0]?.input as MatchCvInput).cv.text).toContain(
      'TypeScript',
    );
    const saved = await analyses.findById(ANALYSIS_ID);
    expect(saved).toMatchObject({
      status: 'done',
      step: 'done',
      provider: 'mock',
      wentExternal: false,
      consentRequired: false,
    });
    expect(saved?.report?.score).toBe(70);
    expect(saved?.report?.judgeScore).toBe(0.85);
    expect(saved?.report?.judgeModel).toBe('judge-model');
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
    expect(spy.calls[1]?.ctx.excludeProviderIds).toEqual(['openrouter']);
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

  it('publishes a closed analysis.step payload on every step change', async () => {
    spy.setCritiqueResult(CRITIQUE_REJECT);
    spy.setImpl(async (task) => {
      if (task.name === 'critique-suggestions') {
        return CRITIQUE_REJECT;
      }
      return {
        status: 'success',
        output: { ...CORE, score: 72 },
        providerId: 'mock',
        model: 'mock-model',
        promptVersion: 'v1',
        cached: false,
      };
    });

    await useCase.execute(PAYLOAD);

    const stepNames = steps.published.map((e) => e.payload.step);
    expect(stepNames).toEqual(
      expect.arrayContaining([
        'reading-job',
        'comparing-cv',
        'drafting-suggestions',
        'critiquing-suggestions',
        'revising-suggestions',
        'done',
      ]),
    );
    for (const event of steps.published) {
      expect(event.type).toBe('AnalysisStep.v1');
      expect(Object.keys(event.payload).sort()).toEqual([
        'analysisId',
        'linkId',
        'step',
        'userId',
      ]);
      expect(event.payload).toMatchObject({
        analysisId: ANALYSIS_ID,
        linkId: LINK_ID,
        userId: USER_ID,
      });
      const raw = JSON.stringify(event);
      expect(raw).not.toContain('Incluir NestJS');
      expect(raw).not.toContain('cvFragment');
      expect(raw).not.toContain('judgeScore');
      expect(raw).not.toMatch(/"suggestions"/);
    }
  });

  it('keeps completing when the step notifier throws', async () => {
    steps.failWith = new Error('redis down');
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
    spy.setImpl(async (_task, _input, ctx) => {
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
    spy.setImpl(async (_task, _input, ctx) => {
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
    useCase = buildUseCase({ cvs });
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
    useCase = buildUseCase({ options: { timeoutMs: 1, maxAgeMs: 120_000 } });
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

describe('AnalyzeMatchUseCase judge loop', () => {
  it('Se para al llegar al umbral', async () => {
    spy.setCritiqueResult(CRITIQUE_ACCEPT);

    await useCase.execute(PAYLOAD);

    expect(spy.calls.map((c) => c.taskName)).toEqual([
      'match-cv',
      'critique-suggestions',
    ]);
    const saved = await analyses.findById(ANALYSIS_ID);
    expect(saved?.status).toBe('done');
    expect(saved?.report?.judgeScore).toBe(0.85);
    expect(saved?.report?.judgeModel).toBe('judge-model');
    expect(saved?.step).toBe('done');
  });

  it('Se guarda el mejor, no el último', async () => {
    spy.setCritiqueResult(CRITIQUE_REJECT);
    let matchCalls = 0;
    spy.setImpl(async (task, input, ctx) => {
      if (task.name === 'critique-suggestions') {
        expect(JSON.stringify(input)).not.toContain('cvFragment');
        expect(ctx.excludeProviderIds).toEqual(['mock']);
        return CRITIQUE_REJECT;
      }
      matchCalls += 1;
      if (matchCalls === 1) {
        return {
          status: 'success',
          output: { ...CORE, score: 70 },
          providerId: 'mock',
          model: 'gen-1',
          promptVersion: 'v1',
          cached: false,
        };
      }
      return {
        status: 'success',
        output: { ...CORE, score: 60 },
        providerId: 'mock',
        model: 'gen-2',
        promptVersion: 'v1',
        cached: false,
      };
    });

    await useCase.execute(PAYLOAD);

    expect(matchCalls).toBe(2);
    const saved = await analyses.findById(ANALYSIS_ID);
    expect(saved?.report?.score).toBe(70);
    expect(saved?.report?.judgeScore).toBe(0.4);
    expect(saved?.report?.judgeModel).toBe('judge-other');
    expect(saved?.model).toBe('gen-1');
  });

  it('El juez no ve fragmentos del CV', async () => {
    const withFragment: MatchCvOutput = {
      ...CORE,
      suggestions: [
        {
          section: 'skills',
          after: 'Incluir NestJS. Escribir a [EMAIL_1].',
          reason: 'La vacante lo pide.',
          evidence: {
            jobRequirement: 'NestJS',
            importance: 'must',
            cvFragment: 'ana@example.com — Nest',
          },
        },
      ],
    };
    spy.setImpl(async (task, input) => {
      if (task.name === 'critique-suggestions') {
        const serialized = JSON.stringify(input);
        expect(serialized).not.toContain('ana@example.com');
        expect(serialized).not.toContain('cvFragment');
        expect(serialized).toContain('[EMAIL_1]');
        return CRITIQUE_ACCEPT;
      }
      return {
        status: 'success',
        output: withFragment,
        providerId: 'mock',
        model: 'm',
        promptVersion: 'v1',
        cached: false,
      };
    });

    await useCase.execute(PAYLOAD);
    expect((await analyses.findById(ANALYSIS_ID))?.status).toBe('done');
  });

  it('Informe con email reinyectado en after no lo envía al juez', async () => {
    const email = 'ana@example.com';
    const marked: MatchCvOutput = {
      ...CORE,
      suggestions: [
        {
          section: 'skills',
          after: 'Incluir NestJS. Escribir a [EMAIL_1].',
          reason: 'La vacante lo pide.',
          evidence: {
            jobRequirement: 'NestJS',
            importance: 'must',
            cvFragment: `${email} — Nest`,
          },
        },
      ],
    };
    const reinjected: MatchCvOutput = {
      ...marked,
      suggestions: [
        {
          ...marked.suggestions[0]!,
          after: `Incluir NestJS. Escribir a ${email}.`,
        },
      ],
    };

    spy.setImpl(async (task, input, ctx) => {
      if (task.name === 'critique-suggestions') {
        const serialized = JSON.stringify(input);
        expect(serialized).not.toContain(email);
        expect(serialized).toContain('[EMAIL_1]');
        return CRITIQUE_ACCEPT;
      }
      expect(ctx.deferPiiReinjection).toBe(true);
      return {
        status: 'success',
        output: marked,
        reinjectedOutput: reinjected,
        providerId: 'openrouter',
        model: 'ext-model',
        promptVersion: 'v1',
        cached: false,
      };
    });

    await useCase.execute(PAYLOAD);

    const saved = await analyses.findById(ANALYSIS_ID);
    expect(saved?.status).toBe('done');
    expect(saved?.report?.suggestions[0]?.after).toContain(email);
    expect(saved?.report?.suggestions[0]?.after).not.toContain('[EMAIL_1]');
  });

  it('Dos proveedores: el juez excluye al generador', async () => {
    spy.setResult({
      status: 'success',
      output: CORE,
      providerId: 'ollama',
      model: 'llama',
      promptVersion: 'v1',
      cached: false,
    });
    spy.setCritiqueResult({
      ...CRITIQUE_ACCEPT,
      providerId: 'openrouter',
      model: 'other',
    });

    await useCase.execute(PAYLOAD);

    const critiqueCall = spy.calls.find(
      (c) => c.taskName === 'critique-suggestions',
    );
    expect(critiqueCall?.ctx.excludeProviderIds).toEqual(['ollama']);
  });

  it('El juez no está', async () => {
    spy.setCritiqueResult({
      status: 'degraded',
      reason: 'providers_failed',
    });

    await useCase.execute(PAYLOAD);

    const saved = await analyses.findById(ANALYSIS_ID);
    expect(saved?.status).toBe('done');
    expect(saved?.report?.score).toBe(70);
    expect(saved?.report?.judgeScore).toBeUndefined();
    expect(saved?.report?.judgeModel).toBeUndefined();
    expect(spy.calls.map((c) => c.taskName)).toEqual([
      'match-cv',
      'critique-suggestions',
    ]);
  });

  it('quota_exceeded mid-loop keeps the best report done', async () => {
    spy.setCritiqueResult({
      status: 'degraded',
      reason: 'quota_exceeded',
      aiQuotaRetryAt: '2026-09-21T12:00:00.000Z',
    });

    await useCase.execute(PAYLOAD);

    const saved = await analyses.findById(ANALYSIS_ID);
    expect(saved?.status).toBe('done');
    expect(saved?.degraded).toBe(false);
    expect(saved?.report?.judgeScore).toBeUndefined();
    expect(saved?.step).not.toBe('running' as never);
  });

  it('quota_exceeded on revision keeps generator report with judgeScore', async () => {
    spy.setCritiqueResult(CRITIQUE_REJECT);
    let matchCalls = 0;
    spy.setImpl(async (task) => {
      if (task.name === 'critique-suggestions') {
        return CRITIQUE_REJECT;
      }
      matchCalls += 1;
      if (matchCalls === 1) {
        return {
          status: 'success',
          output: CORE,
          providerId: 'mock',
          model: 'gen',
          promptVersion: 'v1',
          cached: false,
        };
      }
      return {
        status: 'degraded',
        reason: 'quota_exceeded',
        aiQuotaRetryAt: '2026-09-21T12:00:00.000Z',
        output: {
          score: 10,
          matchedSkills: [],
          missingSkills: [],
          suggestions: [],
        },
      };
    });

    await useCase.execute(PAYLOAD);

    const saved = await analyses.findById(ANALYSIS_ID);
    expect(saved?.status).toBe('done');
    expect(saved?.report?.score).toBe(70);
    expect(saved?.report?.judgeScore).toBe(0.4);
  });

  it('revises when judge score is below threshold and keeps improved report', async () => {
    spy.setCritiqueResult(CRITIQUE_REJECT);
    let matchCalls = 0;
    spy.setImpl(async (task) => {
      if (task.name === 'critique-suggestions') {
        return CRITIQUE_REJECT;
      }
      matchCalls += 1;
      if (matchCalls === 1) {
        return {
          status: 'success',
          output: { ...CORE, score: 70 },
          providerId: 'mock',
          model: 'gen-1',
          promptVersion: 'v1',
          cached: false,
        };
      }
      return {
        status: 'success',
        output: { ...CORE, score: 72 },
        providerId: 'mock',
        model: 'gen-2',
        promptVersion: 'v1',
        cached: false,
      };
    });

    await useCase.execute(PAYLOAD);

    const saved = await analyses.findById(ANALYSIS_ID);
    expect(matchCalls).toBe(2);
    expect(saved?.report?.score).toBe(72);
    expect(saved?.report?.judgeScore).toBeUndefined();
    expect(saved?.model).toBe('gen-2');
  });

  it('skips judge loop for degraded first reports', async () => {
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

    await useCase.execute(PAYLOAD);

    expect(spy.calls.map((c) => c.taskName)).toEqual(['match-cv']);
    expect((await analyses.findById(ANALYSIS_ID))?.step).toBe('done-degraded');
  });

  it('Las revisiones no pasan de dos envíos del CV', async () => {
    aiContext.with(USER_ID, { aiConsent: { externalProviders: true } });
    spy.setCritiqueResult(CRITIQUE_REJECT);
    let externalMatchSends = 0;
    spy.setImpl(async (task, _input, ctx) => {
      if (task.name === 'critique-suggestions') {
        return CRITIQUE_REJECT;
      }
      if (ctx.aiConsent.externalProviders) {
        externalMatchSends += 1;
      }
      return {
        status: 'success',
        output: { ...CORE, score: externalMatchSends === 1 ? 70 : 71 },
        providerId: 'openrouter',
        model: 'x',
        promptVersion: 'v1',
        cached: false,
      };
    });

    await useCase.execute(PAYLOAD);

    expect(externalMatchSends).toBe(2);
    expect(
      spy.calls.filter((c) => c.taskName === 'critique-suggestions'),
    ).toHaveLength(1);
  });
});

describe('sample helpers', () => {
  it('builds reports used by other suites', () => {
    expect(sampleReport().degraded).toBe(false);
    expect(sampleDegradedReport('no_providers').suggestions).toEqual([]);
    expect(matchCvTask.name).toBe('match-cv');
  });
});
