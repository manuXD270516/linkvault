import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import type {
  CvDocument,
  JobLinkSummary,
  MatchAnalysisResponse,
  MatchLatest,
  MatchReport,
  MatchRequestAccepted,
  MatchRunning,
  MatchSuggestion,
  UserProfile,
} from '@linkvault/shared';
import {
  apiError,
  providePageTesting,
  sessionWith,
  settle,
  testUser,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import {
  MATCH_DIALOG_SIZE,
  MatchDialog,
  type MatchDialogData,
  type MatchDialogResult,
} from './match.dialog';

const LINK_ID = 'l1';
const MATCH_URL = `/api/links/${LINK_ID}/match`;
const CV_URL = '/api/cv';
const DATE = '2026-09-20T12:00:00.000Z';

const link: JobLinkSummary = {
  id: LINK_ID,
  normalizedUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  displayUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  platform: 'linkedin',
  previewStatus: 'enriched',
  previewVersion: 1,
  preview: { title: 'Ingeniera de datos', company: 'Acme' },
  sharedBy: { userId: 'u1', displayName: 'Ana' },
  sharedAt: DATE,
};

const defaultCv: CvDocument = {
  id: 'cv1',
  fileName: 'CV_backend.pdf',
  fileType: 'pdf',
  sizeBytes: 1000,
  version: 1,
  isDefault: true,
  uploadedAt: DATE,
  extraction: { status: 'extracted', textChars: 100, extractedAt: DATE },
  matchAnalysesCount: 0,
};

function suggestion(overrides: Partial<MatchSuggestion> = {}): MatchSuggestion {
  return {
    section: 'Experience',
    after: 'Built APIs in TypeScript.',
    reason: 'The role asks for TypeScript.',
    ...overrides,
    evidence: {
      jobRequirement: 'TypeScript',
      importance: 'must',
      cvFragment: '3 years of TypeScript',
      ...overrides.evidence,
    },
  };
}

function report(overrides: Partial<MatchReport> = {}): MatchReport {
  return {
    score: 82,
    matchedSkills: ['TypeScript'],
    missingSkills: [
      { name: 'Kubernetes', importance: 'must' },
      { name: 'GraphQL', importance: 'nice' },
    ],
    suggestions: [suggestion()],
    degraded: false,
    ...overrides,
  };
}

function latestDone(overrides: Partial<MatchLatest> = {}): MatchLatest {
  return {
    analysisId: 'a1',
    cvId: 'cv1',
    status: 'done',
    step: 'done',
    requestedAt: DATE,
    analyzedAt: DATE,
    stale: false,
    cvChanged: false,
    consentRequired: false,
    report: report(),
    ...overrides,
  };
}

function running(overrides: Partial<MatchRunning> = {}): MatchRunning {
  return {
    analysisId: 'a2',
    cvId: 'cv1',
    status: 'running',
    step: 'comparing-cv',
    requestedAt: DATE,
    maxAgeMs: 120_000,
    ...overrides,
  };
}

function consentCurrent(user: UserProfile = testUser): UserProfile {
  return {
    ...user,
    aiConsent: {
      externalProviders: true,
      consentedAt: DATE,
      textVersion: user.aiConsent.currentTextVersion,
      currentTextVersion: user.aiConsent.currentTextVersion,
    },
  };
}

describe('MatchDialog', () => {
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1', consentCurrent()));
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    verifyNoPendingRequests(http);
  });

  async function openDialog(data: Partial<MatchDialogData> = {}): Promise<void> {
    TestBed.inject(MatDialog).open<MatchDialog, MatchDialogData, MatchDialogResult>(MatchDialog, {
      ...MATCH_DIALOG_SIZE,
      data: {
        linkId: LINK_ID,
        jobTitle: 'Ingeniera de datos',
        link,
        ...data,
      },
    });
    TestBed.tick();
    await settle();
  }

  function dialog(): HTMLElement {
    const element = document.body.querySelector<HTMLElement>('lv-match-dialog');
    if (!element) {
      throw new Error('Dialog not rendered');
    }
    return element;
  }

  function text(): string {
    return dialog().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function click(testId: string): void {
    const button = dialog().querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    if (!button) {
      throw new Error(`Missing button ${testId}`);
    }
    button.click();
    TestBed.tick();
  }

  async function flushOpen(
    matchBody: MatchAnalysisResponse = { linkId: LINK_ID },
    cvs: CvDocument[] = [defaultCv],
  ): Promise<void> {
    const matchReq = http.expectOne({ method: 'GET', url: MATCH_URL });
    const cvReq = http.expectOne({ method: 'GET', url: CV_URL });
    matchReq.flush(matchBody);
    cvReq.flush({ items: cvs });
    await settle();
    TestBed.tick();
    await settle();
  }

  it('Abrir el diálogo no manda nada a ningún sitio', async () => {
    await openDialog();
    await flushOpen();

    expect(text()).toContain('Tu encaje con esta oferta');
    expect(text()).toContain('Ingeniera de datos');
    expect(text()).toContain('CV_backend.pdf');
    expect(text()).toContain('Se analizará con IA externa (OpenRouter).');
    expect(dialog().querySelector('[data-testid="match-analyze"]')).not.toBeNull();
    http.expectNone({ method: 'POST', url: MATCH_URL });
  });

  it('does not POST an analysis until Analizar is pressed', async () => {
    await openDialog();
    await flushOpen();
    http.verify({ ignoreCancelled: true });

    click('match-analyze');
    await settle();
    const post = http.expectOne({ method: 'POST', url: MATCH_URL });
    expect(post.request.body).toEqual({});
    post.flush(
      {
        analysisId: 'a2',
        linkId: LINK_ID,
        cvId: 'cv1',
        status: 'running',
        step: 'reading-job',
        requestedAt: DATE,
      } satisfies MatchRequestAccepted,
      { status: 202, statusText: 'Accepted' },
    );
    await settle();
    http.expectOne({ method: 'GET', url: MATCH_URL }).flush({
      linkId: LINK_ID,
      running: running({ step: 'reading-job' }),
    });
    await settle();
  });

  it('Con el permiso vigente se dice que sale fuera', async () => {
    await openDialog();
    await flushOpen();
    expect(text()).toContain('Se analizará con IA externa (OpenRouter).');
    expect(text()).not.toContain('Se analizará dentro de LinkVault');
  });

  it('Sin permiso se dice que se queda dentro y qué cuesta', async () => {
    TestBed.inject(SessionStore).setSession(sessionWith('token-1', testUser));
    await openDialog();
    await flushOpen();

    expect(text()).toContain('Se analizará dentro de LinkVault');
    expect(text()).toContain('análisis será básico y sin sugerencias');
    expect(text()).not.toContain('siempre básico');
    expect(dialog().querySelector('[data-testid="match-give-consent"]')).not.toBeNull();
    expect(dialog().querySelector('[data-testid="match-analyze"]')).not.toBeNull();
    expect(text()).not.toContain('Se analizará con IA externa');
  });

  it('No se pudo comprobar el permiso', async () => {
    const store = TestBed.inject(SessionStore);
    const failed = store.reloadConsent();
    http.expectOne({ method: 'GET', url: '/api/users/me' }).flush(
      { code: 'internal_error', message: 'x' },
      { status: 500, statusText: 'Error' },
    );
    await failed;

    await openDialog();
    await flushOpen();

    expect(text()).toContain(
      'No pudimos comprobar si diste permiso para analizar tu CV con IA externa.',
    );
    expect(text()).not.toContain('Se analizará con IA externa');
    expect(text()).not.toContain('Se analizará dentro de LinkVault');
    expect(dialog().querySelector('[data-testid="match-analyze"]')).toBeNull();
  });

  it('El estado sin comprobar tiene salida', async () => {
    const store = TestBed.inject(SessionStore);
    const failed = store.reloadConsent();
    http.expectOne({ method: 'GET', url: '/api/users/me' }).flush(
      { code: 'internal_error', message: 'x' },
      { status: 500, statusText: 'Error' },
    );
    await failed;

    await openDialog();
    await flushOpen();

    expect(dialog().querySelector('[data-testid="match-retry-consent"]')).not.toBeNull();
    expect(dialog().querySelector('[data-testid="match-change-cv"]')).not.toBeNull();
    expect(dialog().querySelector('[data-testid="match-close"]')).not.toBeNull();
  });

  it('Comprobar de nuevo resuelve el estado', async () => {
    const store = TestBed.inject(SessionStore);
    const failed = store.reloadConsent();
    http.expectOne({ method: 'GET', url: '/api/users/me' }).flush(
      { code: 'internal_error', message: 'x' },
      { status: 500, statusText: 'Error' },
    );
    await failed;

    await openDialog();
    await flushOpen();

    click('match-retry-consent');
    await settle();
    http.expectOne({ method: 'GET', url: '/api/users/me' }).flush(consentCurrent());
    await settle();
    TestBed.tick();
    await settle();

    expect(text()).toContain('Se analizará con IA externa (OpenRouter).');
    expect(dialog().querySelector('[data-testid="match-analyze"]')).not.toBeNull();
    http.expectNone({ method: 'POST', url: MATCH_URL });
  });

  it('Volver de Perfil no dispara nada', async () => {
    TestBed.inject(SessionStore).setSession(sessionWith('token-1', testUser));
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await openDialog();
    await flushOpen();

    click('match-give-consent');
    await settle();

    expect(navigate).toHaveBeenCalledWith(['/perfil']);
    http.expectNone({ method: 'POST', url: MATCH_URL });
  });

  it('Volver de Mi CV no dispara nada', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await openDialog();
    await flushOpen();

    click('match-change-cv');
    await settle();

    expect(navigate).toHaveBeenCalledWith(['/mi-cv']);
    http.expectNone({ method: 'POST', url: MATCH_URL });
  });

  it('La oferta no se ha leído', async () => {
    await openDialog();
    await flushOpen();

    click('match-analyze');
    await settle();
    const { body, options } = apiError('job_not_ready', 422);
    http.expectOne({ method: 'POST', url: MATCH_URL }).flush(body, options);
    await settle();
    TestBed.tick();

    expect(text()).toContain(
      'Todavía no hemos leído esta oferta, así que no hay con qué comparar tu CV.',
    );
    expect(dialog().querySelector('[data-testid="match-paste-description"]')).not.toBeNull();
  });

  it('Se acabó la paciencia', async () => {
    vi.useFakeTimers();
    try {
      const dialogRef = TestBed.inject(MatDialog).open<
        MatchDialog,
        MatchDialogData,
        MatchDialogResult
      >(MatchDialog, {
        ...MATCH_DIALOG_SIZE,
        data: { linkId: LINK_ID, jobTitle: 'Ingeniera de datos', link },
      });
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(0);

      const maxAgeMs = 9_000;
      http.expectOne({ method: 'GET', url: MATCH_URL }).flush({
        linkId: LINK_ID,
        running: running({ maxAgeMs }),
      });
      http.expectOne({ method: 'GET', url: CV_URL }).flush({ items: [defaultCv] });
      await vi.advanceTimersByTimeAsync(0);
      TestBed.tick();

      for (let i = 0; i < maxAgeMs / 3_000; i += 1) {
        await vi.advanceTimersByTimeAsync(3_000);
        http.expectOne({ method: 'GET', url: MATCH_URL }).flush({
          linkId: LINK_ID,
          running: running({ maxAgeMs }),
        });
        await vi.advanceTimersByTimeAsync(0);
      }
      TestBed.tick();

      expect(text()).toContain('Sigue en proceso. Vuelve en un momento.');
      expect(dialog().querySelector('[data-testid="match-refresh"]')).not.toBeNull();

      click('match-refresh');
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne({ method: 'GET', url: MATCH_URL }).flush({
        linkId: LINK_ID,
        running: running({ maxAgeMs }),
      });
      await vi.advanceTimersByTimeAsync(0);
      TestBed.tick();

      expect(text()).not.toContain('Sigue en proceso');
      expect(text()).toContain('Comparando con tu CV');

      dialogRef.close();
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Los pasos conforme avanza', async () => {
    await openDialog();
    await flushOpen({ linkId: LINK_ID, running: running({ step: 'comparing-cv' }) });

    expect(text()).toContain('Leyendo la oferta');
    expect(text()).toContain('Comparando con tu CV');
    expect(text()).toContain('Redactando sugerencias');
    expect(
      dialog().querySelector('[data-step="reading-job"][data-done]'),
    ).not.toBeNull();
    expect(
      dialog().querySelector('[data-step="comparing-cv"][data-current]'),
    ).not.toBeNull();
  });

  it('Todavía no hay paso que mostrar', async () => {
    await openDialog();
    await flushOpen();
    click('match-analyze');
    await settle();
    TestBed.tick();

    // Entre el clic y la respuesta del POST: `requesting` sin paso aún.
    expect(text()).toContain('Estamos analizando tu encaje…');
    expect(text()).not.toMatch(/No pudimos analizar ahora/);

    http.expectOne({ method: 'POST', url: MATCH_URL }).flush(
      {
        analysisId: 'a2',
        linkId: LINK_ID,
        cvId: 'cv1',
        status: 'running',
        step: 'reading-job',
        requestedAt: DATE,
      } satisfies MatchRequestAccepted,
      { status: 202, statusText: 'Accepted' },
    );
    await settle();
    http.expectOne({ method: 'GET', url: MATCH_URL }).flush({
      linkId: LINK_ID,
      running: running({ step: 'reading-job' }),
    });
    await settle();
  });

  it('Un paso que no llega porque no toca', async () => {
    await openDialog();
    await flushOpen({
      linkId: LINK_ID,
      latest: latestDone({
        step: 'done-degraded',
        report: report({
          score: 64,
          suggestions: [],
          degraded: true,
          degradedReason: 'no_providers',
        }),
      }),
    });

    expect(text()).toContain('Análisis básico');
    expect(text()).not.toContain('Redactando sugerencias');
  });

  it('Informe completo', async () => {
    await openDialog();
    await flushOpen({ linkId: LINK_ID, latest: latestDone() });

    expect(dialog().querySelector('[data-testid="match-badge"]')).not.toBeNull();
    expect(text()).toContain('TypeScript');
    expect(text()).toContain('Imprescindible');
    expect(text()).toContain('Suma puntos');
    expect(text()).toContain('Kubernetes');
    expect(text()).toContain('GraphQL');
    expect(dialog().querySelector('[data-testid="match-suggestions"]')).not.toBeNull();
    expect(text()).not.toContain('must');
    expect(text()).not.toContain('nice');
  });

  it('Nada coincide', async () => {
    await openDialog();
    await flushOpen({
      linkId: LINK_ID,
      latest: latestDone({
        report: report({ matchedSkills: [], suggestions: [] }),
      }),
    });

    expect(text()).toContain(
      'Ninguna de las habilidades que pide esta oferta está en tu CV',
    );
  });

  it('La oferta cambió', async () => {
    await openDialog();
    await flushOpen({
      linkId: LINK_ID,
      latest: latestDone({ stale: true }),
    });

    expect(text()).toContain('Esta oferta cambió desde tu análisis');
    expect(dialog().querySelector('[data-testid="match-reanalyze"]')).not.toBeNull();
  });

  it('El informe es de otro CV', async () => {
    const other: CvDocument = {
      ...defaultCv,
      id: 'cv-old',
      fileName: 'CV_viejo.pdf',
      isDefault: false,
    };
    await openDialog();
    await flushOpen(
      {
        linkId: LINK_ID,
        latest: latestDone({ cvId: 'cv-old', cvChanged: true }),
      },
      [defaultCv, other],
    );

    expect(text()).toContain('Lo analizaste con otro CV');
    expect(text()).toContain('CV_viejo.pdf');
  });

  it('El CV no se enseña aquí', async () => {
    await openDialog();
    await flushOpen({ linkId: LINK_ID, latest: latestDone() });

    expect(text()).not.toContain('Ver lo que leímos');
    expect(text()).not.toMatch(/Ana Pérez\nDesarrolladora/);
  });

  it('Una sugerencia con su evidencia', async () => {
    await openDialog();
    await flushOpen({ linkId: LINK_ID, latest: latestDone() });

    expect(text()).toContain('Lo pide la oferta');
    expect(text()).toContain('TypeScript');
    expect(text()).toContain('En tu CV dice');
    expect(text()).toContain('3 years of TypeScript');
  });

  it('Una sugerencia sobre algo que no está', async () => {
    await openDialog();
    await flushOpen({
      linkId: LINK_ID,
      latest: latestDone({
        report: report({
          suggestions: [suggestion({ evidence: { jobRequirement: 'K8s', importance: 'must', cvFragment: null } })],
        }),
      }),
    });

    expect(text()).toContain('Esto no aparece en tu CV');
    expect(text()).toContain('K8s');
  });

  it('Queda claro quién lo escribió', async () => {
    await openDialog();
    await flushOpen({ linkId: LINK_ID, latest: latestDone() });

    expect(text()).toContain(
      'Estas propuestas las redactó una IA a partir de tu CV y de la oferta',
    );
    expect(text()).toContain('Por ahora los cambios los aplicas tú en tu CV.');
  });

  it('does not show the AI warning on a basic analysis', async () => {
    await openDialog();
    await flushOpen({
      linkId: LINK_ID,
      latest: latestDone({
        step: 'done-degraded',
        report: report({
          suggestions: [],
          degraded: true,
          degradedReason: 'no_providers',
        }),
      }),
    });

    expect(dialog().querySelector('[data-testid="match-ai-warning"]')).toBeNull();
    expect(dialog().querySelector('[data-testid="match-suggestions"]')).toBeNull();
  });

  it('Copiar una sugerencia', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    await openDialog();
    await flushOpen({ linkId: LINK_ID, latest: latestDone() });

    click('match-suggestion-copy');
    await settle();
    TestBed.tick();
    await settle();

    expect(writeText).toHaveBeenCalledWith('Built APIs in TypeScript.');
    expect(text()).toContain('Copiado');
    http.expectNone({ method: 'POST', url: MATCH_URL });
    http.expectNone((req) => req.url.includes('/api/cv'));
  });

  it('Doce sugerencias no caen todas de golpe', async () => {
    const suggestions = Array.from({ length: 12 }, (_, i) =>
      suggestion({
        after: `Suggestion ${i}`,
        evidence: {
          jobRequirement: `Req ${i}`,
          importance: i < 6 ? 'must' : 'nice',
          cvFragment: null,
        },
      }),
    );
    await openDialog();
    await flushOpen({
      linkId: LINK_ID,
      latest: latestDone({ report: report({ suggestions }) }),
    });

    expect(dialog().querySelectorAll('[data-testid="match-suggestion"]')).toHaveLength(5);
    expect(text()).toContain('Ver las 7 restantes');
  });

  it('Ver las demás sugerencias', async () => {
    const suggestions = Array.from({ length: 12 }, (_, i) =>
      suggestion({
        after: `Suggestion ${i}`,
        evidence: {
          jobRequirement: `Req ${i}`,
          importance: 'must',
          cvFragment: null,
        },
      }),
    );
    await openDialog();
    await flushOpen({
      linkId: LINK_ID,
      latest: latestDone({ report: report({ suggestions }) }),
    });

    click('match-suggestions-more');
    await settle();
    TestBed.tick();

    expect(dialog().querySelectorAll('[data-testid="match-suggestion"]')).toHaveLength(12);
    http.expectNone({ method: 'POST', url: MATCH_URL });
  });

  it('Con pocas sugerencias no hay gesto que ofrecer', async () => {
    await openDialog();
    await flushOpen({
      linkId: LINK_ID,
      latest: latestDone({
        report: report({
          suggestions: [
            suggestion({ after: 'a' }),
            suggestion({ after: 'b', evidence: { jobRequirement: 'B', importance: 'nice', cvFragment: null } }),
            suggestion({ after: 'c', evidence: { jobRequirement: 'C', importance: 'nice', cvFragment: null } }),
          ],
        }),
      }),
    });

    expect(dialog().querySelectorAll('[data-testid="match-suggestion"]')).toHaveLength(3);
    expect(dialog().querySelector('[data-testid="match-suggestions-more"]')).toBeNull();
  });

  it('La IA no está disponible', async () => {
    await openDialog();
    await flushOpen({
      linkId: LINK_ID,
      latest: latestDone({
        step: 'done-degraded',
        report: report({
          suggestions: [],
          degraded: true,
          degradedReason: 'providers_failed',
        }),
      }),
    });

    expect(text()).toContain('Análisis básico');
    expect(text()).toContain('El análisis con IA no está disponible ahora.');
    expect(dialog().querySelector('[data-testid="match-retry"]')).not.toBeNull();
    expect(dialog().querySelector('[data-testid="match-suggestions"]')).toBeNull();
  });

  it('Límite diario de IA', async () => {
    const retryAt = '2026-09-20T18:00:00.000Z';
    await openDialog();
    await flushOpen({
      linkId: LINK_ID,
      latest: latestDone({
        step: 'done-degraded',
        aiQuotaRetryAt: retryAt,
        report: report({
          suggestions: [],
          degraded: true,
          degradedReason: 'quota_exceeded',
          aiQuotaRetryAt: retryAt,
        }),
      }),
    });

    expect(text()).toContain('Alcanzaste tu límite de análisis con IA por hoy');
    expect(text()).not.toContain('No pudimos analizar ahora');
    expect(text()).not.toContain('Pediste muchos análisis seguidos');
  });

  it('Sin permiso', async () => {
    await openDialog();
    await flushOpen({
      linkId: LINK_ID,
      latest: latestDone({
        step: 'done-degraded',
        consentRequired: true,
        report: report({
          suggestions: [],
          degraded: true,
          degradedReason: 'consent_required',
        }),
      }),
    });

    expect(text()).toContain('Para analizar tu CV con IA necesitamos tu permiso.');
    expect(text()).toContain('email');
    expect(text()).toContain('URL');
    expect(text()).toContain('resto del CV se envía tal cual');
    expect(text()).not.toMatch(/anónim/);
    expect(dialog().querySelector('mat-slide-toggle')).toBeNull();
    expect(dialog().querySelector('[data-testid="match-give-consent"]')).not.toBeNull();
    expect(dialog().querySelector('[data-testid="match-badge"]')).not.toBeNull();
  });

  it('Otra degradación no habla de permisos', async () => {
    await openDialog();
    await flushOpen({
      linkId: LINK_ID,
      latest: latestDone({
        step: 'done-degraded',
        report: report({
          suggestions: [],
          degraded: true,
          degradedReason: 'no_providers',
        }),
      }),
    });

    expect(text()).not.toContain('necesitamos tu permiso');
  });

  it('Sin CV', async () => {
    await openDialog();
    await flushOpen({ linkId: LINK_ID }, []);

    click('match-analyze');
    await settle();
    const { body, options } = apiError('no_cv', 422);
    http.expectOne({ method: 'POST', url: MATCH_URL }).flush(body, options);
    await settle();
    TestBed.tick();

    expect(text()).toContain('Necesitas un CV guardado para analizar tu encaje.');
    expect(dialog().querySelector('[data-testid="match-upload-cv"]')).not.toBeNull();
  });

  it('El CV se está leyendo', async () => {
    await openDialog();
    await flushOpen();

    click('match-analyze');
    await settle();
    const { body, options } = apiError('cv_not_ready', 422);
    http.expectOne({ method: 'POST', url: MATCH_URL }).flush(body, options);
    await settle();
    TestBed.tick();

    expect(text()).toContain('Estamos leyendo tu CV');
    expect(dialog().querySelector('[data-testid="match-retry"]')).not.toBeNull();
  });

  it('El CV no se pudo leer', async () => {
    await openDialog();
    await flushOpen();

    click('match-analyze');
    await settle();
    const { body, options } = apiError('cv_not_readable', 422);
    http.expectOne({ method: 'POST', url: MATCH_URL }).flush(body, options);
    await settle();
    TestBed.tick();

    expect(text()).toContain('Tu CV no se pudo leer');
    expect(dialog().querySelector('[data-testid="match-go-my-cv"]')).not.toBeNull();
  });

  it('Límite de peticiones de la API', async () => {
    await openDialog();
    await flushOpen();

    click('match-analyze');
    await settle();
    const { body, options } = apiError('too_many_attempts', 429, { 'Retry-After': '600' });
    http.expectOne({ method: 'POST', url: MATCH_URL }).flush(body, options);
    await settle();
    TestBed.tick();

    expect(text()).toContain('Pediste muchos análisis seguidos');
    expect(text()).not.toContain('No pudimos analizar ahora');
    expect(text()).not.toContain('Alcanzaste tu límite de análisis con IA');
  });

  it('Avería del servidor', async () => {
    await openDialog();
    await flushOpen();

    click('match-analyze');
    await settle();
    const { body, options } = apiError('internal_error', 500);
    http.expectOne({ method: 'POST', url: MATCH_URL }).flush(body, options);
    await settle();
    TestBed.tick();

    expect(text()).toContain('No pudimos analizar ahora.');
    expect(dialog().querySelector('[data-testid="match-retry"]')).not.toBeNull();
  });

  it('El análisis terminó en fallo', async () => {
    await openDialog();
    await flushOpen({
      linkId: LINK_ID,
      latest: {
        analysisId: 'a-fail',
        cvId: 'cv1',
        status: 'failed',
        step: 'failed',
        requestedAt: DATE,
        analyzedAt: DATE,
        stale: false,
        cvChanged: false,
        consentRequired: false,
        failureCode: 'internal_error',
      },
    });

    expect(text()).toContain('No pudimos analizar ahora.');
    expect(dialog().querySelector('[data-testid="match-retry"]')).not.toBeNull();
  });

  it('Un encaje bajo no es una avería', async () => {
    await openDialog();
    await flushOpen({
      linkId: LINK_ID,
      latest: latestDone({
        report: report({
          score: 12,
          missingSkills: [{ name: 'Kubernetes', importance: 'must' }],
        }),
      }),
    });

    expect(text()).toContain('Encaje bajo');
    expect(text()).toContain('12');
    expect(text()).not.toContain('No pudimos analizar ahora');
    expect(dialog().querySelector('[data-testid="match-retry"]')).toBeNull();
  });

  it('Los errores no filtran el CV', async () => {
    await openDialog();
    await flushOpen();
    click('match-analyze');
    await settle();
    const { body, options } = apiError('internal_error', 500);
    http.expectOne({ method: 'POST', url: MATCH_URL }).flush(body, options);
    await settle();
    TestBed.tick();

    expect(text()).not.toMatch(/experiencia|curriculum|teléfono \+591/i);
  });

  it('Sin acciones que no existen', async () => {
    await openDialog();
    await flushOpen({ linkId: LINK_ID, latest: latestDone() });

    const actions = Array.from(dialog().querySelectorAll('button')).map((button) =>
      button.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(actions.some((label) => label === 'Copiar')).toBe(true);
    for (const forbidden of [
      'Aplicar',
      'Aceptar',
      'Rechazar',
      'Puntuar',
      'Descargar',
      'Compartir',
    ]) {
      expect.soft(actions.join(' ')).not.toContain(forbidden);
    }
    expect(text()).not.toMatch(/pantalla de edición|editor de CV|aplicar al CV/i);
  });

  it('La lista de ofertas no lleva badge — el diálogo sí', async () => {
    await openDialog();
    await flushOpen({ linkId: LINK_ID, latest: latestDone() });
    expect(dialog().querySelector('[data-testid="match-badge"]')).not.toBeNull();
  });
});
