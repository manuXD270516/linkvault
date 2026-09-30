import { matchAnalysisResponseSchema } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { CvNotFound } from '../../cv/domain/errors';
import { LinkNotFound } from '../../links/domain/errors';
import type { MatchAnalysis } from '../domain/analysis';
import {
  AnalysisNotFound,
  CvNotReadable,
  CvNotReady,
  JobNotReady,
  NoCv,
  TooManyAnalysisAttempts,
} from '../domain/errors';
import { GetMatchAnalysis } from './get-match-analysis.usecase';
import { RequestMatchAnalysis } from './request-match-analysis.usecase';
import {
  InMemoryAnalysisRepository,
  InMemoryMatchCvReader,
  InMemoryMatchJobReader,
  MovableMatchClock,
  StubMatchAiConsent,
  StubProviderEligibility,
  TEST_MATCH_SETTINGS,
  sampleDegradedReport,
  sampleReport,
} from './testing/match-test-doubles';
import type { MatchAnalysisSettings } from './ports/match-settings.port';
import type { AnalysisRepository } from './ports/analysis-repository.port';

// Casos de uso del análisis (tareas 9.1–9.10) sobre dobles: sin HTTP, sin Mongo, sin almacén de objetos.

const ANA = '66e9a0000000000000000a01';
const BETO = '66e9a0000000000000000d01';
const LINK = '66e9a0000000000000000b01';
const CV_DEFAULT = '66e9a0000000000000000c01';
const CV_OTHER = '66e9a0000000000000000c02';
const FOREIGN_CV = '66e9a0000000000000000c99';

let clock: MovableMatchClock;
let jobs: InMemoryMatchJobReader;
let cvs: InMemoryMatchCvReader;
let analyses: InMemoryAnalysisRepository;
let eligibility: StubProviderEligibility;
let consent: StubMatchAiConsent;
let settings: MatchAnalysisSettings;
let request: RequestMatchAnalysis;
let getAnalysis: GetMatchAnalysis;

beforeEach(() => {
  clock = new MovableMatchClock();
  jobs = new InMemoryMatchJobReader();
  cvs = new InMemoryMatchCvReader();
  analyses = new InMemoryAnalysisRepository();
  eligibility = new StubProviderEligibility();
  consent = new StubMatchAiConsent(false);
  settings = { ...TEST_MATCH_SETTINGS };
  wire();
  seedHappyPath();
});

function wire(): void {
  request = new RequestMatchAnalysis(
    jobs,
    cvs,
    analyses,
    eligibility,
    consent,
    clock,
    settings,
  );
  getAnalysis = new GetMatchAnalysis(jobs, cvs, analyses, clock, settings);
}

function seedHappyPath(): void {
  jobs.allow(ANA, LINK);
  jobs.seed({
    id: LINK,
    previewVersion: 2,
    title: 'Backend Engineer',
    description: 'TypeScript and NestJS',
  });
  cvs.seed(ANA, [
    {
      id: CV_DEFAULT,
      extractionStatus: 'extracted',
      isDefault: true,
    },
    {
      id: CV_OTHER,
      extractionStatus: 'extracted',
      isDefault: false,
    },
  ]);
}

function seedDone(overrides: Partial<MatchAnalysis> = {}): MatchAnalysis {
  const finishedAt = new Date(clock.now().getTime() - 5_000);
  const analysis: MatchAnalysis = {
    id: analyses.nextId(),
    userId: ANA,
    linkId: LINK,
    cvId: CV_DEFAULT,
    status: 'done',
    step: 'done',
    previewVersion: 2,
    promptVersion: 'v1',
    report: sampleReport(),
    consentRequired: false,
    wentExternal: false,
    requestedAt: new Date(finishedAt.getTime() - 10_000),
    finishedAt,
    durationMs: 10_000,
    ...overrides,
  };
  analyses.seed(analysis);
  return analysis;
}

function seedDegraded(
  reason: 'quota_exceeded' | 'consent_required' | 'no_providers' | 'providers_failed',
  options: { aiQuotaRetryAt?: Date; previewVersion?: number } = {},
): MatchAnalysis {
  const finishedAt = new Date(clock.now().getTime() - 5_000);
  const report = sampleDegradedReport(reason, options.aiQuotaRetryAt);
  const analysis: MatchAnalysis = {
    id: analyses.nextId(),
    userId: ANA,
    linkId: LINK,
    cvId: CV_DEFAULT,
    status: 'done',
    step: 'done',
    previewVersion: options.previewVersion ?? 2,
    promptVersion: 'v1',
    report,
    degraded: true,
    degradedReason: reason,
    ...(options.aiQuotaRetryAt === undefined
      ? {}
      : { aiQuotaRetryAt: options.aiQuotaRetryAt }),
    consentRequired: reason === 'consent_required',
    wentExternal: false,
    requestedAt: new Date(finishedAt.getTime() - 10_000),
    finishedAt,
    durationMs: 10_000,
  };
  analyses.seed(analysis);
  return analysis;
}

function seedRunning(overrides: Partial<MatchAnalysis> = {}): MatchAnalysis {
  const analysis: MatchAnalysis = {
    id: analyses.nextId(),
    userId: ANA,
    linkId: LINK,
    cvId: CV_DEFAULT,
    status: 'running',
    step: 'reading-job',
    previewVersion: 2,
    promptVersion: 'v1',
    consentRequired: false,
    wentExternal: false,
    requestedAt: clock.now(),
    ...overrides,
  };
  analyses.seed(analysis);
  return analysis;
}

describe('RequestMatchAnalysis — link gate (9.1)', () => {
  it('La oferta no es suya', async () => {
    await expect(request.execute(ANA, '66e9a0000000000000000b99')).rejects.toBeInstanceOf(
      LinkNotFound,
    );
  });

  it.each([
    ['inexistente', '66e9a0000000000000000b99'],
    ['ajena', LINK],
    ['mal formado', 'no-es-un-id'],
  ] as const)('rechaza %s con el mismo LinkNotFound', async (_label, linkId) => {
    if (linkId === LINK) {
      // Beto no puede ver el link de Ana.
      await expect(request.execute(BETO, linkId)).rejects.toMatchObject({
        name: 'LinkNotFound',
        code: 'link_not_found',
        message: 'Link not found',
      });
      return;
    }
    await expect(request.execute(ANA, linkId)).rejects.toMatchObject({
      name: 'LinkNotFound',
      code: 'link_not_found',
      message: 'Link not found',
    });
  });
});

describe('RequestMatchAnalysis — CV choice (9.2)', () => {
  it('Análisis pedido con el CV por defecto', async () => {
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') {
      return;
    }
    expect(result.analysis.cvId).toBe(CV_DEFAULT);
    expect(analyses.appendedEvents()).toHaveLength(1);
  });

  it('Análisis con otro CV mío', async () => {
    const result = await request.execute(ANA, LINK, CV_OTHER);
    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') {
      return;
    }
    expect(result.analysis.cvId).toBe(CV_OTHER);
  });

  it.each([
    ['ajeno', FOREIGN_CV],
    ['inexistente', '66e9a0000000000000000c88'],
    ['mal formado', 'no-es-un-id'],
  ] as const)('cvId %s → CvNotFound', async (_label, cvId) => {
    await expect(request.execute(ANA, LINK, cvId)).rejects.toBeInstanceOf(
      CvNotFound,
    );
    expect(analyses.all()).toHaveLength(0);
  });
});

describe('RequestMatchAnalysis — CV readiness (9.3)', () => {
  it('Todavía no hay CV', async () => {
    cvs.seed(ANA, []);
    await expect(request.execute(ANA, LINK)).rejects.toBeInstanceOf(NoCv);
    expect(analyses.all()).toHaveLength(0);
    expect(analyses.appendedEvents()).toHaveLength(0);
  });

  it('El CV aún se está leyendo', async () => {
    cvs.seed(ANA, [
      { id: CV_DEFAULT, extractionStatus: 'pending', isDefault: true },
    ]);
    await expect(request.execute(ANA, LINK)).rejects.toBeInstanceOf(CvNotReady);
    expect(analyses.all()).toHaveLength(0);
  });

  it('El CV no se pudo leer', async () => {
    cvs.seed(ANA, [
      { id: CV_DEFAULT, extractionStatus: 'failed', isDefault: true },
    ]);
    await expect(request.execute(ANA, LINK)).rejects.toBeInstanceOf(
      CvNotReadable,
    );
    expect(analyses.all()).toHaveLength(0);
  });

  it('ningún rechazo de CV encola ni guarda análisis', async () => {
    for (const setup of [
      () => cvs.seed(ANA, []),
      () =>
        cvs.seed(ANA, [
          { id: CV_DEFAULT, extractionStatus: 'pending', isDefault: true },
        ]),
      () =>
        cvs.seed(ANA, [
          { id: CV_DEFAULT, extractionStatus: 'failed', isDefault: true },
        ]),
    ]) {
      analyses = new InMemoryAnalysisRepository();
      wire();
      setup();
      await expect(request.execute(ANA, LINK)).rejects.toThrow();
      expect(analyses.all()).toEqual([]);
      expect(analyses.appendedEvents()).toEqual([]);
    }
  });
});

describe('RequestMatchAnalysis — job readiness (9.4)', () => {
  it('La oferta todavía no se ha leído', async () => {
    jobs.seed({ id: LINK, previewVersion: 1 });
    await expect(request.execute(ANA, LINK)).rejects.toBeInstanceOf(JobNotReady);
    expect(analyses.all()).toHaveLength(0);
  });

  it('solo título sí se analiza', async () => {
    jobs.seed({ id: LINK, previewVersion: 2, title: 'Solo título' });
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('accepted');
  });

  it('solo descripción pegada sí se analiza', async () => {
    jobs.seed({
      id: LINK,
      previewVersion: 2,
      description: 'Texto pegado de la vacante',
    });
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('accepted');
  });
});

describe('RequestMatchAnalysis — reuse without enqueue (9.5)', () => {
  it('Dos peticiones seguidas', async () => {
    const first = await request.execute(ANA, LINK);
    expect(first.outcome).toBe('accepted');
    if (first.outcome !== 'accepted') {
      return;
    }
    const second = await request.execute(ANA, LINK);
    expect(second.outcome).toBe('accepted');
    if (second.outcome !== 'accepted') {
      return;
    }
    expect(second.analysis.id).toBe(first.analysis.id);
    expect(analyses.appendedEvents()).toHaveLength(1);
  });

  it('Volver a pedir lo ya analizado', async () => {
    const done = seedDone();
    const result = await request.execute(ANA, LINK);
    expect(result).toEqual({
      outcome: 'reused',
      analysis: done,
      report: done.report,
      currentPreviewVersion: 2,
      defaultCvId: CV_DEFAULT,
    });
    expect(analyses.appendedEvents()).toHaveLength(0);
  });

  it('no existe forma de forzar reanálisis cuando nada cambió', async () => {
    seedDone();
    const again = await request.execute(ANA, LINK);
    expect(again.outcome).toBe('reused');
    expect(analyses.appendedEvents()).toHaveLength(0);
    expect(analyses.all()).toHaveLength(1);
  });
});

describe('RequestMatchAnalysis — degraded still current (9.6)', () => {
  it('Reintentar mientras la cuota de IA sigue agotada', async () => {
    const retryAt = new Date(clock.now().getTime() + 60_000);
    const degraded = seedDegraded('quota_exceeded', { aiQuotaRetryAt: retryAt });
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('reused');
    if (result.outcome !== 'reused') {
      return;
    }
    expect(result.analysis.id).toBe(degraded.id);
    expect(analyses.appendedEvents()).toHaveLength(0);
    expect(cvs.textOpenCount).toBe(0);
  });

  it('Reintentar sin haber dado el permiso', async () => {
    consent.externalProviders = false;
    eligibility.setResult({
      status: 'ready',
      hasEligible: false,
      hasEligibleByok: false,
      consentWouldEnable: true,
    });
    const degraded = seedDegraded('consent_required');
    const first = await request.execute(ANA, LINK);
    const second = await request.execute(ANA, LINK);
    expect(first.outcome).toBe('reused');
    expect(second.outcome).toBe('reused');
    if (first.outcome !== 'reused' || second.outcome !== 'reused') {
      return;
    }
    expect(first.analysis.id).toBe(degraded.id);
    expect(second.analysis.id).toBe(degraded.id);
    expect(analyses.appendedEvents()).toHaveLength(0);
    expect(cvs.textOpenCount).toBe(0);
  });

  it('Reintentar con el circuito todavía abierto', async () => {
    eligibility.setResult({
      status: 'ready',
      hasEligible: false,
      hasEligibleByok: false,
      consentWouldEnable: false,
    });
    const degraded = seedDegraded('no_providers');
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('reused');
    if (result.outcome !== 'reused') {
      return;
    }
    expect(result.analysis.id).toBe(degraded.id);
    expect(cvs.textOpenCount).toBe(0);
  });
});

describe('RequestMatchAnalysis — degraded no longer current (9.7)', () => {
  it('Reintentar cuando la hora de vuelta ya pasó', async () => {
    const retryAt = new Date(clock.now().getTime() - 1);
    seedDegraded('quota_exceeded', { aiQuotaRetryAt: retryAt });
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('accepted');
    expect(analyses.appendedEvents()).toHaveLength(1);
  });

  it('Reintentar tras guardar una clave BYOK (D11)', async () => {
    const retryAt = new Date(clock.now().getTime() + 60_000);
    seedDegraded('quota_exceeded', { aiQuotaRetryAt: retryAt });
    consent.externalProviders = true;
    eligibility.setResult({
      status: 'ready',
      hasEligible: true,
      hasEligibleByok: true,
      consentWouldEnable: false,
    });
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('accepted');
    expect(analyses.appendedEvents()).toHaveLength(1);
  });

  it('Reintentar después de dar el permiso', async () => {
    seedDegraded('consent_required');
    consent.externalProviders = true;
    eligibility.setResult({
      status: 'ready',
      hasEligible: true,
      hasEligibleByok: false,
      consentWouldEnable: false,
    });
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('accepted');
    expect(analyses.appendedEvents()).toHaveLength(1);
  });

  it('Reintentar con el circuito ya cerrado', async () => {
    seedDegraded('no_providers');
    eligibility.setResult({
      status: 'ready',
      hasEligible: true,
      hasEligibleByok: false,
      consentWouldEnable: false,
    });
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('accepted');
  });

  it('Reintentar un degradado porque todos fallaron', async () => {
    seedDegraded('providers_failed');
    eligibility.setResult({
      status: 'ready',
      hasEligible: true,
      hasEligibleByok: false,
      consentWouldEnable: false,
    });
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('accepted');
  });

  it('La elegibilidad no se puede consultar', async () => {
    seedDegraded('no_providers');
    eligibility.setResult({ status: 'unavailable' });
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('accepted');
  });
});

describe('RequestMatchAnalysis — precedence and new runs (9.8)', () => {
  it('Volver a pedir un análisis vencido', async () => {
    seedRunning({
      requestedAt: new Date(clock.now().getTime() - settings.maxAgeMs - 1),
    });
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') {
      return;
    }
    expect(result.analysis.status).toBe('running');
    expect(analyses.appendedEvents()).toHaveLength(1);
  });

  it('Volver a pedir un análisis fallido', async () => {
    const finishedAt = clock.now();
    analyses.seed({
      id: analyses.nextId(),
      userId: ANA,
      linkId: LINK,
      cvId: CV_DEFAULT,
      status: 'failed',
      step: 'failed',
      previewVersion: 2,
      promptVersion: 'v1',
      failureCode: 'internal_error',
      consentRequired: false,
      wentExternal: false,
      requestedAt: new Date(finishedAt.getTime() - 1_000),
      finishedAt,
      durationMs: 1_000,
    });
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('accepted');
  });

  it('La oferta se completó después', async () => {
    seedDone({ previewVersion: 1 });
    jobs.seed({
      id: LINK,
      previewVersion: 3,
      title: 'Backend Engineer',
      description: 'Ahora con descripción',
    });
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') {
      return;
    }
    expect(result.analysis.previewVersion).toBe(3);
  });

  it('Cambiar de CV', async () => {
    const previous = seedDone({ cvId: CV_DEFAULT });
    cvs.seed(ANA, [
      { id: CV_DEFAULT, extractionStatus: 'extracted', isDefault: false },
      { id: CV_OTHER, extractionStatus: 'extracted', isDefault: true },
    ]);
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') {
      return;
    }
    expect(result.analysis.cvId).toBe(CV_OTHER);
    expect(analyses.all().find((a) => a.id === previous.id)).toEqual(previous);
  });

  it('degradado vigente sobre otra previewVersion se reejecuta', async () => {
    eligibility.setResult({
      status: 'ready',
      hasEligible: false,
      hasEligibleByok: false,
      consentWouldEnable: false,
    });
    seedDegraded('no_providers', { previewVersion: 1 });
    jobs.seed({
      id: LINK,
      previewVersion: 4,
      title: 'Nueva versión',
    });
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('accepted');
    expect(analyses.appendedEvents()).toHaveLength(1);
  });

  it('versión de prompt distinta ejecuta uno nuevo', async () => {
    seedDone({ promptVersion: 'v0' });
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('accepted');
  });
});

describe('RequestMatchAnalysis — derived quota (9.9)', () => {
  it('Límite alcanzado', async () => {
    settings = { ...TEST_MATCH_SETTINGS, analysesPerUser: 2 };
    wire();
    const otherLink = '66e9a0000000000000000b02';
    const t0 = new Date(clock.now().getTime() - 60_000);
    for (let i = 0; i < 2; i += 1) {
      seedDone({
        id: analyses.nextId(),
        linkId: otherLink,
        finishedAt: new Date(t0.getTime() + i * 1_000),
        requestedAt: new Date(t0.getTime() + i * 1_000 - 5_000),
      });
    }
    await expect(request.execute(ANA, LINK)).rejects.toBeInstanceOf(
      TooManyAnalysisAttempts,
    );
    expect(analyses.appendedEvents()).toHaveLength(0);
    expect(analyses.all().filter((a) => a.status === 'running')).toHaveLength(0);
  });

  it('La espera se calcula del historial', async () => {
    settings = { ...TEST_MATCH_SETTINGS, analysesPerUser: 1 };
    wire();
    const otherLink = '66e9a0000000000000000b02';
    const finishedAt = new Date(clock.now().getTime() - 3_600_000);
    seedDone({
      linkId: otherLink,
      finishedAt,
      requestedAt: new Date(finishedAt.getTime() - 1_000),
    });
    try {
      await request.execute(ANA, LINK);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(TooManyAnalysisAttempts);
      if (!(error instanceof TooManyAnalysisAttempts)) {
        return;
      }
      const expected = Math.max(
        1,
        Math.ceil(
          (finishedAt.getTime() + settings.quotaWindowMs - clock.now().getTime()) /
            1_000,
        ),
      );
      expect(error.retryAfterSeconds).toBe(expected);
    }
  });

  it('El recuento no se puede calcular → acepta', async () => {
    analyses.countFailure = new Error('mongo down');
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('accepted');
  });

  it('Un rechazo no cuenta', async () => {
    cvs.seed(ANA, []);
    await expect(request.execute(ANA, LINK)).rejects.toBeInstanceOf(NoCv);
    expect(analyses.all()).toHaveLength(0);
    cvs.seed(ANA, [
      { id: CV_DEFAULT, extractionStatus: 'extracted', isDefault: true },
    ]);
    const result = await request.execute(ANA, LINK);
    expect(result.outcome).toBe('accepted');
  });

  it('no existe operación que suba, baje o devuelva cuota', () => {
    const methods = Object.getOwnPropertyNames(
      Object.getPrototypeOf(analyses) as AnalysisRepository,
    );
    expect(methods).not.toEqual(
      expect.arrayContaining([
        'increment',
        'decrement',
        'refund',
        'consume',
        'release',
      ]),
    );
    const portKeys = [
      'nextId',
      'createRunning',
      'findLatestResolved',
      'findRunning',
      'findReusable',
      'findReusableDegraded',
      'countForQuota',
      'removeByCv',
      'countByCv',
      'findLatestDoneFitScores',
    ] as const satisfies readonly (keyof AnalysisRepository)[];
    expect(portKeys).not.toContain('increment');
  });
});

describe('GetMatchAnalysis (9.10)', () => {
  it('Un análisis en curso no inventa el permiso', async () => {
    seedRunning();
    const response = await getAnalysis.execute(ANA, LINK);
    expect(response.running).toBeDefined();
    expect(response.running).not.toHaveProperty('consentRequired');
    expect(response.running).not.toHaveProperty('failureCode');
    expect(response.running).not.toHaveProperty('aiQuotaRetryAt');
    expect(response.running).not.toHaveProperty('report');
    expect(response.latest).toBeUndefined();
  });

  it('La consulta publica cuánto puede durar la espera', async () => {
    seedRunning();
    const response = await getAnalysis.execute(ANA, LINK);
    expect(response.running?.maxAgeMs).toBe(settings.maxAgeMs);
    expect(response.latest).toBeUndefined();
  });

  it('El plazo publicado es el que de verdad se aplica', async () => {
    settings = { ...TEST_MATCH_SETTINGS, maxAgeMs: 240_000 };
    wire();
    seedRunning({
      requestedAt: new Date(clock.now().getTime() - 200_000),
    });
    const response = await getAnalysis.execute(ANA, LINK);
    expect(response.running?.maxAgeMs).toBe(240_000);
    expect(response.running?.status).toBe('running');

    clock.advance(40_001);
    const after = await getAnalysis.execute(ANA, LINK);
    expect(after.running).toBeUndefined();
    expect(after.latest?.status).toBe('failed');
    expect(after.latest?.failureCode).toBe('internal_error');
  });

  it('Nunca pedí este análisis', async () => {
    await expect(getAnalysis.execute(ANA, LINK)).rejects.toBeInstanceOf(
      AnalysisNotFound,
    );
  });

  it('El fallo viaja con su código', async () => {
    const finishedAt = clock.now();
    analyses.seed({
      id: analyses.nextId(),
      userId: ANA,
      linkId: LINK,
      cvId: CV_DEFAULT,
      status: 'failed',
      step: 'failed',
      previewVersion: 2,
      promptVersion: 'v1',
      failureCode: 'internal_error',
      consentRequired: false,
      wentExternal: false,
      requestedAt: new Date(finishedAt.getTime() - 1_000),
      finishedAt,
      durationMs: 1_000,
    });
    const response = await getAnalysis.execute(ANA, LINK);
    expect(response.latest).toMatchObject({
      status: 'failed',
      failureCode: 'internal_error',
    });
    expect(response.latest).not.toHaveProperty('report');
  });

  it('Un resultado que llega tarde', async () => {
    seedRunning({
      requestedAt: new Date(clock.now().getTime() - settings.maxAgeMs - 1),
    });
    const response = await getAnalysis.execute(ANA, LINK);
    expect(response.latest?.status).toBe('failed');
    expect(response.latest?.failureCode).toBe('internal_error');
    expect(response.running).toBeUndefined();
  });

  it('La consulta trae la hora de vuelta de un degradado por cuota de IA', async () => {
    const retryAt = new Date(clock.now().getTime() + 3_600_000);
    seedDegraded('quota_exceeded', { aiQuotaRetryAt: retryAt });
    const response = await getAnalysis.execute(ANA, LINK);
    expect(response.latest?.aiQuotaRetryAt).toBe(retryAt.toISOString());

    seedDegraded('no_providers');
    analyses = new InMemoryAnalysisRepository();
    wire();
    seedHappyPath();
    seedDegraded('no_providers');
    const other = await getAnalysis.execute(ANA, LINK);
    expect(other.latest).not.toHaveProperty('aiQuotaRetryAt');
  });

  it('La oferta cambió después del análisis', async () => {
    seedDone({ previewVersion: 1 });
    jobs.seed({
      id: LINK,
      previewVersion: 5,
      title: 'Completada',
      description: 'Ahora sí',
    });
    const response = await getAnalysis.execute(ANA, LINK);
    expect(response.latest?.stale).toBe(true);
    expect(response.latest?.report).toBeDefined();
  });

  it('El análisis se hizo con otro CV', async () => {
    seedDone({ cvId: CV_DEFAULT });
    cvs.seed(ANA, [
      { id: CV_DEFAULT, extractionStatus: 'extracted', isDefault: false },
      { id: CV_OTHER, extractionStatus: 'extracted', isDefault: true },
    ]);
    const response = await getAnalysis.execute(ANA, LINK);
    expect(response.latest).toMatchObject({
      cvId: CV_DEFAULT,
      cvChanged: true,
    });
  });

  it('El motivo del informe no cambia al cambiar el permiso', async () => {
    seedDone({ consentRequired: true, report: sampleDegradedReport('consent_required') });
    // Overwrite with proper degraded fields.
    analyses = new InMemoryAnalysisRepository();
    wire();
    seedHappyPath();
    const finishedAt = clock.now();
    analyses.seed({
      id: analyses.nextId(),
      userId: ANA,
      linkId: LINK,
      cvId: CV_DEFAULT,
      status: 'done',
      step: 'done',
      previewVersion: 2,
      promptVersion: 'v1',
      report: sampleDegradedReport('consent_required'),
      degraded: true,
      degradedReason: 'consent_required',
      consentRequired: true,
      wentExternal: false,
      requestedAt: new Date(finishedAt.getTime() - 1_000),
      finishedAt,
      durationMs: 1_000,
    });
    consent.externalProviders = true;
    const response = await getAnalysis.execute(ANA, LINK);
    expect(response.latest?.consentRequired).toBe(true);
  });

  it('compone latest + running juntos y valida el schema', async () => {
    seedDone();
    seedRunning({ id: analyses.nextId(), cvId: CV_OTHER });
    const response = await getAnalysis.execute(ANA, LINK);
    expect(response.latest?.status).toBe('done');
    expect(response.running?.status).toBe('running');
    expect(matchAnalysisResponseSchema.safeParse(response).success).toBe(true);
  });

  it('oferta ajena → LinkNotFound aunque haya análisis', async () => {
    seedDone();
    await expect(getAnalysis.execute(BETO, LINK)).rejects.toBeInstanceOf(
      LinkNotFound,
    );
  });
});

