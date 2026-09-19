import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { Application, ApplicationEvent } from '@linkvault/shared';
import { applicationWith } from '../../../testing/applications-testing';
import {
  apiError,
  buttonWithText,
  providePageTesting,
  sessionWith,
  settle,
  typeInto,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { ApplicationsBoardPage } from './applications-board.page';

const SCOPE =
  'Te verán los miembros de tus grupos donde esté esta oferta, ahora o más adelante, incluidos quienes se unan ' +
  'después. Verán tu nombre y tu estado, también cuando cambie (por ejemplo, «Rechazada»). Nunca la etapa, las ' +
  'notas ni el historial. Puedes dejar de compartir cuando quieras.';

const history: ApplicationEvent[] = [
  { id: 'e1', to: 'interested', at: '2026-09-10T10:00:00.000Z' },
  { id: 'e2', from: 'interested', to: 'applied', at: '2026-09-12T10:00:00.000Z' },
  {
    id: 'e3',
    from: 'applied',
    to: 'in_process',
    stageLabel: 'Entrevista',
    at: '2026-09-15T10:00:00.000Z',
  },
];

/** El panel se prueba abierto desde el tablero, que es donde vive: así se ve también lo que cambia en la tarjeta. */
describe('ApplicationDetailDialog', () => {
  let fixture: ComponentFixture<ApplicationsBoardPage>;
  let http: HttpTestingController;
  const inProcess = applicationWith({
    status: 'in_process',
    stageLabel: 'Entrevista',
    appliedAt: '2026-09-12T10:00:00.000Z',
    version: 3,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => verifyNoPendingRequests(http));

  async function refresh(): Promise<void> {
    await settle();
    await fixture.whenStable();
  }

  async function openPanel(application: Application = inProcess, events = history): Promise<void> {
    fixture = TestBed.createComponent(ApplicationsBoardPage);
    http.expectOne('/api/applications').flush({ items: [application] });
    await refresh();
    host().querySelector<HTMLButtonElement>('[data-testid="application-open"]')?.click();
    await refresh();
    (await vi.waitFor(() => http.expectOne(`/api/applications/${application.id}/events`))).flush({
      items: events,
    });
    await refresh();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function containers(): HTMLElement[] {
    return Array.from(document.body.querySelectorAll<HTMLElement>('mat-dialog-container'));
  }

  function panel(): HTMLElement {
    const container = containers().find((element) => element.querySelector('lv-application-detail-dialog'));
    if (!container) {
      throw new Error('Panel not opened');
    }
    return container;
  }

  function confirmation(): HTMLElement {
    const container = containers().find((element) => element.querySelector('lv-confirm-dialog'));
    if (!container) {
      throw new Error('Confirmation not opened');
    }
    return container;
  }

  function text(element: Element): string {
    return element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function untrackButton(): HTMLButtonElement {
    const button = panel().querySelector<HTMLButtonElement>('[data-testid="detail-untrack"]');
    if (!button) {
      throw new Error('"Dejar de seguir" not rendered');
    }
    return button;
  }

  async function deleteRequest(): Promise<TestRequest> {
    return await vi.waitFor(() =>
      http.expectOne({ method: 'DELETE', url: `/api/applications/${inProcess.id}` }),
    );
  }

  it('opens the offer in a new tab without leaking the referrer', async () => {
    await openPanel();

    const offer = panel().querySelector<HTMLAnchorElement>('[data-testid="detail-offer"]');
    expect(offer?.getAttribute('href')).toBe(inProcess.link.displayUrl);
    expect(offer?.getAttribute('target')).toBe('_blank');
    expect(offer?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(text(panel())).toContain('Oferta l1');
    expect(text(panel().querySelector('[data-testid="detail-status"]') ?? panel())).toBe(
      'En proceso · Entrevista',
    );
  });

  it('Historial legible', async () => {
    await openPanel();

    const rows = Array.from(panel().querySelectorAll('[data-testid="detail-history"] li')).map(text);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/^Interés \d{2}\/09\/2026 \d{2}:\d{2}$/);
    expect(rows[1]).toMatch(/^Postulada \d{2}\/09\/2026/);
    expect(rows[2]).toMatch(/^En proceso · Entrevista \d{2}\/09\/2026/);
  });

  it('changes the stage from the panel and reloads the history', async () => {
    await openPanel();

    panel().querySelector<HTMLButtonElement>('[data-testid="detail-edit-stage"]')?.click();
    await refresh();
    const stageDialog = containers().find((element) => element.querySelector('lv-stage-dialog'));
    if (!stageDialog) {
      throw new Error('Stage dialog not opened');
    }
    expect(stageDialog.querySelector<HTMLInputElement>('[data-testid="stage-input"]')?.value).toBe('Entrevista');
    typeInto(stageDialog, '[data-testid="stage-input"]', 'Prueba técnica');
    buttonWithText(stageDialog, 'Guardar').click();

    const request = await vi.waitFor(() => http.expectOne(`/api/applications/${inProcess.id}/status`));
    expect(request.request.body).toEqual({ status: 'in_process', stageLabel: 'Prueba técnica', version: 3 });
    request.flush({ ...inProcess, stageLabel: 'Prueba técnica', version: 4 });
    (await vi.waitFor(() => http.expectOne(`/api/applications/${inProcess.id}/events`))).flush({
      items: [...history, { id: 'e4', from: 'in_process', to: 'in_process', fromStageLabel: 'Entrevista', stageLabel: 'Prueba técnica', at: '2026-09-16T10:00:00.000Z' }],
    });
    await refresh();

    expect(text(panel().querySelector('[data-testid="detail-status"]') ?? panel())).toBe(
      'En proceso · Prueba técnica',
    );
    expect(panel().querySelectorAll('[data-testid="detail-history"] li')).toHaveLength(4);
  });

  it('saves the note', async () => {
    await openPanel();

    typeInto(panel(), '[data-testid="detail-notes"]', 'Piden inglés C1; escribir a RR. HH. el lunes');
    buttonWithText(panel(), 'Guardar la nota').click();
    const request = await vi.waitFor(() =>
      http.expectOne({ method: 'PATCH', url: `/api/applications/${inProcess.id}` }),
    );
    expect(request.request.body).toEqual({ notes: 'Piden inglés C1; escribir a RR. HH. el lunes' });
    request.flush({ ...inProcess, notes: 'Piden inglés C1; escribir a RR. HH. el lunes' });
    await refresh();

    expect(text(panel())).toContain('Nota guardada');
  });

  it('Nota que no se guardó', async () => {
    await openPanel();

    typeInto(panel(), '[data-testid="detail-notes"]', 'Llamar el lunes');
    buttonWithText(panel(), 'Guardar la nota').click();
    (
      await vi.waitFor(() => http.expectOne({ method: 'PATCH', url: `/api/applications/${inProcess.id}` }))
    ).error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await refresh();

    expect(text(panel())).toContain('No pudimos conectar con LinkVault. Revisa tu conexión');
    expect(panel().querySelector<HTMLTextAreaElement>('[data-testid="detail-notes"]')?.value).toBe(
      'Llamar el lunes',
    );
  });

  it('Compartir con los grupos', async () => {
    await openPanel(applicationWith({ status: 'interested' }), [history[0]]);

    expect(text(panel())).toContain('Compartir mi estado con mis grupos');
    expect(text(panel().querySelector('[data-testid="detail-share-scope"]') ?? panel())).toBe(SCOPE);
    expect(host().querySelector('[data-testid="application-shared"]')).toBeNull();

    panel().querySelector<HTMLButtonElement>('[data-testid="detail-share"] button')?.click();
    const request = await vi.waitFor(() =>
      http.expectOne({ method: 'PATCH', url: '/api/applications/a-l1' }),
    );
    expect(request.request.body).toEqual({ visibility: 'group' });
    request.flush(applicationWith({ status: 'interested', visibility: 'group' }));
    await refresh();

    expect(host().querySelector('[data-testid="application-shared"]')?.textContent).toContain(
      'Compartida con tus grupos',
    );
  });

  it('Dejar de seguir', async () => {
    await openPanel();

    untrackButton().click();
    await refresh();
    expect(text(confirmation())).toContain(
      'Dejarás de seguir esta oferta: se borrarán tu estado, tus notas y tu historial de esta oferta. Tus grupos dejarán de verte en ella. No se puede deshacer.',
    );
    buttonWithText(confirmation(), 'Dejar de seguir').click();
    (await deleteRequest()).flush(null, { status: 204, statusText: 'No Content' });

    await vi.waitFor(() => expect(containers()).toHaveLength(0));
    await refresh();
    expect(host().textContent).not.toContain('Oferta l1');
  });

  it('Ya no existía', async () => {
    await openPanel();

    untrackButton().click();
    await refresh();
    buttonWithText(confirmation(), 'Dejar de seguir').click();
    const { body, options } = apiError('application_not_found', 404);
    (await deleteRequest()).flush(body, options);

    await vi.waitFor(() => expect(containers()).toHaveLength(0));
    await refresh();
    expect(host().querySelector('[role="alert"]')).toBeNull();
  });

  it('Un solo borrado por doble clic', async () => {
    await openPanel();

    untrackButton().click();
    await refresh();
    buttonWithText(confirmation(), 'Dejar de seguir').click();
    const request = await deleteRequest();
    await refresh();

    expect(untrackButton().disabled).toBe(true);
    untrackButton().click();
    await refresh();
    http.expectNone({ method: 'DELETE', url: `/api/applications/${inProcess.id}` });

    request.flush(null, { status: 204, statusText: 'No Content' });
    await vi.waitFor(() => expect(containers()).toHaveLength(0));
  });

  it('Cancelar dejar de seguir', async () => {
    await openPanel();

    untrackButton().click();
    await refresh();
    buttonWithText(confirmation(), 'Cancelar').click();
    await vi.waitFor(() => expect(containers()).toHaveLength(1));
    await refresh();

    http.expectNone({ method: 'DELETE', url: `/api/applications/${inProcess.id}` });
    expect(untrackButton().disabled).toBe(false);
    expect(host().textContent).toContain('Oferta l1');
  });

  it('closes silently when the history finds the application gone', async () => {
    fixture = TestBed.createComponent(ApplicationsBoardPage);
    http.expectOne('/api/applications').flush({ items: [inProcess] });
    await refresh();
    host().querySelector<HTMLButtonElement>('[data-testid="application-open"]')?.click();
    await refresh();
    const { body, options } = apiError('application_not_found', 404);
    (await vi.waitFor(() => http.expectOne(`/api/applications/${inProcess.id}/events`))).flush(body, options);

    await vi.waitFor(() => expect(containers()).toHaveLength(0));
    await refresh();
    expect(host().textContent).not.toContain('Oferta l1');
  });
});
