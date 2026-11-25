import { Clipboard } from '@angular/cdk/clipboard';
import { HttpTestingController } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { WeeklyPlanResponse } from '@linkvault/shared';
import { weeklyPlanActionWith, weeklyPlanWith } from '../../../testing/applications-testing';
import {
  apiError,
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { WeeklyPlanCard } from './weekly-plan-card.component';

const PLAN_URL = '/api/applications/weekly-plan';
const DECISIONS_URL = '/api/applications/weekly-plan/decisions';

const closing = weeklyPlanActionWith();
const followUp = weeklyPlanActionWith({
  candidateId: 'follow_up:a-l2:2026-W48',
  rule: 'follow_up',
  applicationId: 'a-l2',
  linkId: 'l2',
  link: { displayUrl: 'https://www.linkedin.com/jobs/view/l2', title: 'Mobile Developer', company: 'Startup Andes' },
  reason: { kind: 'quiet', daysQuiet: 12, status: 'applied' },
});
const knowSomeone = weeklyPlanActionWith({
  candidateId: 'ask_know_someone:a-l3:g7',
  rule: 'ask_know_someone',
  applicationId: 'a-l3',
  linkId: 'l3',
  link: { displayUrl: 'https://www.linkedin.com/jobs/view/l3', title: 'Data Engineer' },
  reason: { kind: 'know_someone', count: 2, groupId: 'g7' },
});

describe('WeeklyPlanCard', () => {
  let fixture: ComponentFixture<WeeklyPlanCard>;
  let http: HttpTestingController;
  let copy: ReturnType<typeof vi.fn<(text: string) => boolean>>;

  beforeEach(() => {
    copy = vi.fn<(text: string) => boolean>().mockReturnValue(true);
    TestBed.configureTestingModule({
      providers: [...providePageTesting(), { provide: Clipboard, useValue: { copy } }],
    });
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => verifyNoPendingRequests(http));

  async function render(plan: WeeklyPlanResponse): Promise<HTMLElement> {
    fixture = TestBed.createComponent(WeeklyPlanCard);
    http.expectOne(PLAN_URL).flush(plan);
    await settle();
    await fixture.whenStable();
    return host();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function byId(testId: string): HTMLElement[] {
    return Array.from(host().querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  }

  function text(testId: string): string | null {
    return byId(testId)[0]?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  }

  async function click(element: HTMLElement | undefined): Promise<void> {
    if (element === undefined) {
      throw new Error('Element not found');
    }
    element.click();
    await settle();
    await fixture.whenStable();
  }

  it('renders three actions with their reasons', async () => {
    await render(weeklyPlanWith([closing, followUp, knowSomeone]));

    expect(text('weekly-plan')).toContain('Tu semana');
    expect(byId('weekly-plan-action')).toHaveLength(3);
    expect(byId('weekly-plan-reason').map((reason) => reason.textContent?.trim())).toEqual([
      'Cierra en 3 días: postula antes.',
      '12 días sin novedades: manda un seguimiento.',
      '2 personas de tu grupo conocen a alguien ahí: pregunta en el grupo.',
    ]);
    expect(byId('weekly-plan-open').map((link) => link.textContent?.trim())).toEqual([
      'Oferta l1',
      'Mobile Developer',
      'Data Engineer',
    ]);
    const first = byId('weekly-plan-action')[0];
    expect(Array.from(first.querySelectorAll('button')).map((button) => button.textContent?.trim())).toEqual([
      'Oferta l1',
      'Hecho',
      'Ahora no',
      'Ocultar sugerencia',
    ]);
  });

  it('shows the loading skeleton with aria-busy until the plan arrives', () => {
    fixture = TestBed.createComponent(WeeklyPlanCard);
    fixture.detectChanges();

    expect(byId('weekly-plan-loading')[0]?.getAttribute('aria-busy')).toBe('true');
    http.expectOne(PLAN_URL).flush(weeklyPlanWith());
  });

  it('renders the honest empty state with the explanation line ending in en una de tus ofertas', async () => {
    await render(weeklyPlanWith());

    expect(text('weekly-plan-empty')).toContain('No hay nada urgente esta semana.');
    expect(text('weekly-plan-empty-hint')).toBe(
      'Aquí verás cuando una oferta guardada esté por cerrar, una postulación lleve 10 días sin novedades o alguien de tu grupo conozca a alguien en una de tus ofertas.',
    );
    expect(text('weekly-plan-empty-hint')?.endsWith('en una de tus ofertas.')).toBe(true);
    expect(byId('weekly-plan-done')).toHaveLength(0);
  });

  it('renders Completaste 1 acción esta semana for one and the plural for three', async () => {
    await render(weeklyPlanWith([], { doneThisWeek: 1 }));
    expect(text('weekly-plan-done')).toBe('Completaste 1 acción esta semana.');
    fixture.destroy();

    await render(weeklyPlanWith([], { doneThisWeek: 3 }));
    expect(text('weekly-plan-done')).toBe('Completaste 3 acciones esta semana.');
  });

  it('renders the error with retry', async () => {
    fixture = TestBed.createComponent(WeeklyPlanCard);
    const { body, options } = apiError('internal_error', 500);
    http.expectOne(PLAN_URL).flush(body, options);
    await settle();
    await fixture.whenStable();

    expect(text('weekly-plan-error')).toContain('No pudimos armar tu semana.');
    await click(byId('weekly-plan-retry')[0]);
    http.expectOne(PLAN_URL).flush(weeklyPlanWith([closing]));
    await settle();
    await fixture.whenStable();

    expect(byId('weekly-plan-action')).toHaveLength(1);
    expect(byId('weekly-plan-error')).toHaveLength(0);
  });

  it('renders the save failure message', async () => {
    await render(weeklyPlanWith([closing]));

    await click(byId('weekly-plan-dismiss-button')[0]);
    const { body, options } = apiError('internal_error', 500);
    http.expectOne(DECISIONS_URL).flush(body, options);
    await settle();
    await fixture.whenStable();

    expect(text('weekly-plan-save-failed')).toBe('No pudimos guardar tu elección. Prueba de nuevo.');
    expect((byId('weekly-plan-done-button')[0] as HTMLButtonElement).disabled).toBe(false);
  });

  it('uses the URL when there is no title', async () => {
    await render(
      weeklyPlanWith([weeklyPlanActionWith({ link: { displayUrl: 'https://empresa.example/jobs/42' } })]),
    );

    expect(text('weekly-plan-open')).toBe('https://empresa.example/jobs/42');
  });

  describe('actions', () => {
    it('done sends the done decision with its candidateId', async () => {
      await render(weeklyPlanWith([closing, followUp]));

      await click(byId('weekly-plan-done-button')[1]);

      const request = http.expectOne({ method: 'POST', url: DECISIONS_URL });
      expect(request.request.body).toEqual({ candidateId: followUp.candidateId, decision: 'done' });
      request.flush(weeklyPlanWith([closing], { doneThisWeek: 1 }));
      await settle();
      await fixture.whenStable();

      expect(byId('weekly-plan-action')).toHaveLength(1);
    });

    it('disables only the buttons of the deciding action', async () => {
      await render(weeklyPlanWith([closing, followUp]));

      await click(byId('weekly-plan-snooze-button')[0]);

      const [firstAction, secondAction] = byId('weekly-plan-action');
      const disabled = (action: HTMLElement): boolean[] =>
        Array.from(action.querySelectorAll('button[data-testid$="-button"]')).map(
          (button) => (button as HTMLButtonElement).disabled,
        );
      expect(disabled(firstAction).every(Boolean)).toBe(true);
      expect(disabled(secondAction).some(Boolean)).toBe(false);
      http.expectOne(DECISIONS_URL).flush(weeklyPlanWith([followUp]));
    });

    it('not now sends snoozed and hide sends dismissed', async () => {
      await render(weeklyPlanWith([closing, followUp]));

      await click(byId('weekly-plan-snooze-button')[0]);
      const snoozed = http.expectOne(DECISIONS_URL);
      expect(snoozed.request.body).toEqual({ candidateId: closing.candidateId, decision: 'snoozed' });
      snoozed.flush(weeklyPlanWith([followUp]));
      await settle();
      await fixture.whenStable();

      await click(byId('weekly-plan-dismiss-button')[0]);
      const dismissed = http.expectOne(DECISIONS_URL);
      expect(dismissed.request.body).toEqual({ candidateId: followUp.candidateId, decision: 'dismissed' });
      dismissed.flush(weeklyPlanWith());
    });

    it('title opens the application', async () => {
      await render(weeklyPlanWith([closing]));
      const opened: string[] = [];
      fixture.componentInstance.open.subscribe((applicationId) => opened.push(applicationId));

      await click(byId('weekly-plan-open')[0]);

      expect(opened).toEqual(['a-l1']);
    });

    it('title navigates to the group for ask_know_someone', async () => {
      await render(weeklyPlanWith([knowSomeone]));
      const opened: string[] = [];
      fixture.componentInstance.open.subscribe((applicationId) => opened.push(applicationId));
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      await click(byId('weekly-plan-open')[0]);

      expect(navigate).toHaveBeenCalledWith(['/grupos', 'g7']);
      expect(opened).toEqual([]);
    });

    it('done on apply_before_close offers to move it to applied without a status request', async () => {
      await render(weeklyPlanWith([closing]));

      await click(byId('weekly-plan-done-button')[0]);
      http.expectOne(DECISIONS_URL).flush(weeklyPlanWith([], { doneThisWeek: 1 }));
      await settle();
      await fixture.whenStable();

      expect(text('weekly-plan-move-hint')).toBe('¿Ya postulaste? Muévela a Postulada');
      const opened: string[] = [];
      fixture.componentInstance.open.subscribe((applicationId) => opened.push(applicationId));
      await click(byId('weekly-plan-move-link')[0]);

      expect(opened).toEqual(['a-l1']);
      http.expectNone({ method: 'PATCH' });
    });

    it('done on follow_up does not offer the move line', async () => {
      await render(weeklyPlanWith([followUp]));

      await click(byId('weekly-plan-done-button')[0]);
      http.expectOne(DECISIONS_URL).flush(weeklyPlanWith());
      await settle();
      await fixture.whenStable();

      expect(byId('weekly-plan-move-hint')).toHaveLength(0);
    });
  });

  describe('follow-up draft', () => {
    it('offers the draft only on follow_up actions', async () => {
      await render(weeklyPlanWith([closing, followUp]));

      expect(byId('weekly-plan-draft-button')).toHaveLength(1);
      expect(byId('weekly-plan-draft')).toHaveLength(0);
    });

    it('copy puts the draft in the clipboard without HTTP calls', async () => {
      await render(weeklyPlanWith([followUp]));

      await click(byId('weekly-plan-draft-button')[0]);
      expect(text('weekly-plan-draft-text')).toContain(
        'Hace un tiempo me postulé a Mobile Developer en Startup Andes. Sigo con mucho interés en el puesto.',
      );
      await click(byId('weekly-plan-copy')[0]);

      expect(copy).toHaveBeenCalledOnce();
      const copied = copy.mock.calls[0][0];
      expect(copied.split('\n')).toEqual([
        'Hola:',
        'Hace un tiempo me postulé a Mobile Developer en Startup Andes. Sigo con mucho interés en el puesto.',
        '¿Me podrían contar en qué estado está el proceso de selección?',
      ]);
      expect(text('weekly-plan-copied')).toBe('Borrador copiado');
      http.verify();
    });

    it('does not offer a mailto link', async () => {
      await render(weeklyPlanWith([followUp]));
      await click(byId('weekly-plan-draft-button')[0]);

      expect(host().querySelector('a[href^="mailto:"]')).toBeNull();
    });
  });

});
