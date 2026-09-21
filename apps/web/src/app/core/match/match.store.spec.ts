import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  MatchAnalysisResponse,
  MatchLatest,
  MatchReport,
  MatchRequestAccepted,
  MatchRunning,
} from '@linkvault/shared';
import {
  apiError,
  providePageTesting,
  sessionWith,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { EventsChannel } from '../events/events.channel';
import { MATCH_POLL_INTERVAL_MS, MatchStore } from './match.store';

const DATE = '2026-09-20T12:00:00.000Z';
const LINK = 'l1';
const MATCH_URL = `/api/links/${LINK}/match`;

const report: MatchReport = {
  score: 72,
  matchedSkills: ['TypeScript'],
  missingSkills: [{ name: 'Kubernetes', importance: 'nice' }],
  suggestions: [
    {
      section: 'Experience',
      after: 'Built APIs in TypeScript for three years.',
      reason: 'The role requires TypeScript.',
      evidence: {
        jobRequirement: 'TypeScript',
        importance: 'must',
        cvFragment: '3 years of TypeScript',
      },
    },
  ],
  degraded: false,
};

const latestDone: MatchLatest = {
  analysisId: 'a1',
  cvId: 'c1',
  status: 'done',
  step: 'done',
  requestedAt: DATE,
  analyzedAt: DATE,
  stale: false,
  cvChanged: false,
  consentRequired: false,
  report,
};

const latestDegraded: MatchLatest = {
  ...latestDone,
  analysisId: 'a-deg',
  step: 'done-degraded',
  report: {
    score: 64,
    matchedSkills: ['TypeScript'],
    missingSkills: [{ name: 'Kubernetes', importance: 'must' }],
    suggestions: [],
    degraded: true,
    degradedReason: 'no_providers',
  },
};

function running(overrides: Partial<MatchRunning> = {}): MatchRunning {
  return {
    analysisId: 'a2',
    cvId: 'c1',
    status: 'running',
    step: 'comparing-cv',
    requestedAt: DATE,
    maxAgeMs: 120_000,
    ...overrides,
  };
}

function response(
  overrides: Partial<MatchAnalysisResponse> = {},
): MatchAnalysisResponse {
  return { linkId: LINK, ...overrides };
}

describe('MatchStore', () => {
  let http: HttpTestingController;
  let store: MatchStore;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [...providePageTesting(), MatchStore] });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    store = TestBed.inject(MatchStore);
  });

  afterEach(() => {
    store.stopPolling();
    verifyNoPendingRequests(http);
    vi.useRealTimers();
  });

  async function flushGet(body: MatchAnalysisResponse): Promise<void> {
    http.expectOne({ method: 'GET', url: MATCH_URL }).flush(body);
    await vi.advanceTimersByTimeAsync(0);
  }

  async function openWith(body: MatchAnalysisResponse): Promise<void> {
    const loading = store.load(LINK);
    await flushGet(body);
    await loading;
  }

  async function nextPoll(body: MatchAnalysisResponse): Promise<void> {
    await vi.advanceTimersByTimeAsync(MATCH_POLL_INTERVAL_MS);
    await flushGet(body);
  }

  it('pedir deja el análisis en marcha sin borrar el informe anterior', async () => {
    await openWith(response({ latest: latestDone }));
    expect(store.report()).toEqual(report);

    const requesting = store.request();
    const accepted: MatchRequestAccepted = {
      analysisId: 'a2',
      linkId: LINK,
      cvId: 'c1',
      status: 'running',
      step: 'reading-job',
      requestedAt: DATE,
    };
    http.expectOne({ method: 'POST', url: MATCH_URL }).flush(accepted, {
      status: 202,
      statusText: 'Accepted',
    });
    await vi.advanceTimersByTimeAsync(0);
    // Tras el 202 el informe anterior sigue; luego el GET trae los dos bloques.
    expect(store.report()).toEqual(report);

    await flushGet(response({ latest: latestDone, running: running() }));
    await requesting;

    expect(store.report()).toEqual(report);
    expect(store.running()?.analysisId).toBe('a2');
    expect(store.isRunning()).toBe(true);
    expect(store.latest()?.analysisId).toBe('a1');
  });

  it('el informe lo pasa a terminado', async () => {
    await openWith(response({ running: running({ step: 'drafting-suggestions' }) }));
    expect(store.isRunning()).toBe(true);
    expect(store.report()).toBeNull();

    await nextPoll(response({ latest: latestDone }));

    expect(store.isRunning()).toBe(false);
    expect(store.report()).toEqual(report);
    expect(store.step()).toBe('done');
    expect(store.completedSteps()).toEqual([
      'reading-job',
      'comparing-cv',
      'drafting-suggestions',
      'critiquing-suggestions',
      'revising-suggestions',
    ]);
    expect(store.pendingSteps()).toEqual([]);
    expect(store.stalled()).toBe(false);
  });

  it('el error no borra el informe anterior', async () => {
    await openWith(response({ latest: latestDone }));

    const requesting = store.request();
    const { body, options } = apiError('internal_error', 500);
    http.expectOne({ method: 'POST', url: MATCH_URL }).flush(body, options);
    await requesting;

    expect(store.report()).toEqual(report);
    expect(store.failure()).toEqual({
      kind: 'api',
      status: 500,
      code: 'internal_error',
      retryAfterMinutes: null,
    });
    expect(store.isRunning()).toBe(false);
  });

  it('analysis_not_found al abrir es estado vacío, no avería', async () => {
    const loading = store.load(LINK);
    const { body, options } = apiError('analysis_not_found', 404);
    http.expectOne({ method: 'GET', url: MATCH_URL }).flush(body, options);
    await loading;

    expect(store.loading()).toBe(false);
    expect(store.failure()).toBeNull();
    expect(store.report()).toBeNull();
    expect(store.latest()).toBeNull();
    expect(store.running()).toBeNull();
    expect(store.isRunning()).toBe(false);
    expect(store.linkId()).toBe(LINK);
  });

  it('link_not_found al abrir sí es avería', async () => {
    const loading = store.load(LINK);
    const { body, options } = apiError('link_not_found', 404);
    http.expectOne({ method: 'GET', url: MATCH_URL }).flush(body, options);
    await loading;

    expect(store.failure()).toEqual({
      kind: 'api',
      status: 404,
      code: 'link_not_found',
      retryAfterMinutes: null,
    });
    expect(store.report()).toBeNull();
  });

  it('un paso que no llega porque no toca no queda pendiente', async () => {
    await openWith(response({ latest: latestDegraded }));

    expect(store.step()).toBe('done-degraded');
    expect(store.completedSteps()).toEqual(['reading-job', 'comparing-cv']);
    expect(store.pendingSteps()).toEqual([]);
    expect(store.pendingSteps()).not.toContain('drafting-suggestions');
  });

  it('La espera dura lo que dura el plazo de la API', async () => {
    const maxAgeMs = 180_000;
    await openWith(response({ running: running({ maxAgeMs }) }));

    // Más de minuto y medio, pero dentro del plazo publicado: no se agota la paciencia.
    const polls = Math.floor(90_000 / MATCH_POLL_INTERVAL_MS);
    for (let i = 0; i < polls; i += 1) {
      await nextPoll(response({ running: running({ maxAgeMs }) }));
    }

    expect(store.stalled()).toBe(false);
    expect(store.isRunning()).toBe(true);
    expect(store.step()).toBe('comparing-cv');
  });

  it('Se acabó la paciencia', async () => {
    const maxAgeMs = 9_000;
    await openWith(response({ running: running({ maxAgeMs }) }));

    for (let i = 0; i < maxAgeMs / MATCH_POLL_INTERVAL_MS; i += 1) {
      await nextPoll(response({ running: running({ maxAgeMs }) }));
    }

    expect(store.stalled()).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    http.expectNone({ method: 'GET', url: MATCH_URL });
  });

  it('Actualizar reanuda la espera', async () => {
    const maxAgeMs = 9_000;
    await openWith(response({ running: running({ maxAgeMs }) }));
    for (let i = 0; i < maxAgeMs / MATCH_POLL_INTERVAL_MS; i += 1) {
      await nextPoll(response({ running: running({ maxAgeMs }) }));
    }
    expect(store.stalled()).toBe(true);

    const refreshing = store.refresh();
    await flushGet(response({ running: running({ maxAgeMs }) }));
    await refreshing;

    expect(store.stalled()).toBe(false);
    await nextPoll(response({ running: running({ maxAgeMs }) }));
    expect(store.stalled()).toBe(false);
  });

  it('Salir corta el sondeo', async () => {
    await openWith(response({ running: running() }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    TestBed.resetTestingModule();

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    http.expectNone({ method: 'GET', url: MATCH_URL });
  });

  it('sin maxAgeMs sigue preguntando en vez de inventarse un plazo más corto', async () => {
    await openWith(
      response({
        running: {
          analysisId: 'a2',
          cvId: 'c1',
          status: 'running',
          step: 'reading-job',
          requestedAt: DATE,
        } as MatchRunning,
      }),
    );

    // Mucho más que cualquier constante típica del SPA: sigue sin stalled.
    for (let i = 0; i < 40; i += 1) {
      await nextPoll(
        response({
          running: {
            analysisId: 'a2',
            cvId: 'c1',
            status: 'running',
            step: 'reading-job',
            requestedAt: DATE,
          } as MatchRunning,
        }),
      );
    }

    expect(store.stalled()).toBe(false);
    expect(store.isRunning()).toBe(true);
  });

  it('el comportamiento no cambia según haya o no ningún canal de eventos abierto', async () => {
    const channel = TestBed.inject(EventsChannel);
    channel.connect();
    // El canal deja una petición SSE abierta; el sondeo del match no depende de ella ni la consume.
    const eventsRequest = http.expectOne({ method: 'GET', url: '/api/events' });

    await openWith(response({ running: running({ maxAgeMs: 9_000 }) }));
    await nextPoll(response({ latest: latestDone }));

    expect(store.report()).toEqual(report);
    expect(store.isRunning()).toBe(false);
    expect(eventsRequest.cancelled).toBe(false);

    channel.disconnect();
  });
});
