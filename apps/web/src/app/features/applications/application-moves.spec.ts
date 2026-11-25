import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { applicationWith, weeklyPlanWith } from '../../../testing/applications-testing';
import {
  apiError,
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { ApplicationMoves } from './application-moves';

const PLAN_URL = '/api/applications/weekly-plan';
const STATUS_URL = '/api/applications/a-l1/status';

describe('ApplicationMoves and the weekly plan', () => {
  let moves: ApplicationMoves;
  let http: HttpTestingController;
  const saved = applicationWith({ status: 'saved', appliedAt: '2026-11-20T10:00:00.000Z', version: 2 });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    moves = TestBed.inject(ApplicationMoves);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => verifyNoPendingRequests(http));

  it('a successful move reloads the weekly plan', async () => {
    const moving = moves.move(saved, 'applied');
    await settle();
    http.expectOne(STATUS_URL).flush({ ...saved, status: 'applied', version: 3 });
    const outcome = await moving;
    await settle();

    expect(outcome.kind).toBe('moved');
    http.expectOne({ method: 'GET', url: PLAN_URL }).flush(weeklyPlanWith());
  });

  it('a status change from the detail reloads the weekly plan', async () => {
    // El panel de detalle cambia el estado por el mismo `ApplicationMoves.move`, con el contexto de grupo vacío.
    const moving = moves.move(saved, 'applied', null);
    await settle();
    http.expectOne(STATUS_URL).flush({ ...saved, status: 'applied', version: 3 });
    await moving;
    await settle();

    http.expectOne({ method: 'GET', url: PLAN_URL }).flush(weeklyPlanWith());
  });

  it('a cancelled or failed move does not reload the weekly plan', async () => {
    const withoutDate = applicationWith({ status: 'interested', version: 1 });
    const dialog = TestBed.inject(MatDialog);
    vi.spyOn(dialog, 'open').mockReturnValue({ afterClosed: () => of(undefined) } as ReturnType<MatDialog['open']>);

    const cancelled = await moves.move(withoutDate, 'applied');
    expect(cancelled.kind).toBe('cancelled');

    const failing = moves.move(saved, 'applied');
    await settle();
    const { body, options } = apiError('internal_error', 500);
    http.expectOne(STATUS_URL).flush(body, options);
    const failed = await failing;
    await settle();

    expect(failed.kind).toBe('failed');
    http.expectNone(PLAN_URL);
  });
});
