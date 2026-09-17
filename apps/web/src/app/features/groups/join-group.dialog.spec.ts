import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { GroupSummary } from '@linkvault/shared';
import {
  apiError,
  buttonWithText,
  flushGroupsList,
  providePageTesting,
  sessionWith,
  settle,
  typeInto,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { Shell } from '../../layout/shell/shell';
import { GroupsListPage } from './groups-list.page';

const joined: GroupSummary = {
  id: 'g2',
  name: 'Frontend Bolivia',
  role: 'member',
  memberCount: 4,
  joinedAt: '2026-09-17T11:00:00.000Z',
};

describe('JoinGroupDialog', () => {
  let http: HttpTestingController;
  let router: Router;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => http.verify());

  function page(): HTMLElement {
    const debugElement = harness.fixture.debugElement.query(By.directive(GroupsListPage));
    if (!debugElement) {
      throw new Error('GroupsListPage not rendered');
    }
    return debugElement.nativeElement as HTMLElement;
  }

  /** El diálogo se abre en el overlay, fuera del árbol del componente. */
  function dialog(): HTMLElement {
    const container = document.body.querySelector<HTMLElement>('mat-dialog-container');
    if (!container) {
      throw new Error('Dialog not opened');
    }
    return container;
  }

  function codeInput(): HTMLInputElement | null {
    return dialog().querySelector<HTMLInputElement>('input[formControlName="code"]');
  }

  function alertText(): string {
    return dialog().querySelector('[role="alert"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  /** Entra en `/grupos` y abre el diálogo de unirse. */
  async function openDialog(): Promise<void> {
    await harness.navigateByUrl('/grupos', Shell);
    await flushGroupsList(http);
    await settle();
    await harness.fixture.whenStable();

    buttonWithText(page(), 'Unirse con un código').click();
    await settle();
    await harness.fixture.whenStable();
  }

  async function submitCode(code: string): Promise<void> {
    typeInto(dialog(), 'input[formControlName="code"]', code);
    buttonWithText(dialog(), 'Unirme').click();
    await settle();
  }

  it('Unirse con un código válido', async () => {
    await openDialog();

    await submitCode(' abcd2345 ');
    const request = http.expectOne('/api/groups/join');
    expect(request.request.body).toEqual({ code: 'ABCD2345' });
    request.flush(joined);
    await settle();
    await flushGroupsList(http, [joined]);

    await vi.waitFor(() => expect(router.url).toBe('/grupos/g2'));
    await vi.waitFor(() =>
      expect(document.body.querySelector('mat-dialog-container')).toBeNull(),
    );
  });

  it('Código inválido', async () => {
    await openDialog();

    await submitCode('ABC-12');
    const { body, options } = apiError('invalid_invite_code', 404);
    http.expectOne('/api/groups/join').flush(body, options);
    await vi.waitFor(() => expect(alertText()).toBe('Ese código no corresponde a ningún grupo'));

    expect(codeInput()?.value).toBe('ABC-12');
    expect(router.url).toBe('/grupos');
  });

  it('Límite de grupos al unirse', async () => {
    await openDialog();

    await submitCode('ABCD2345');
    const { body, options } = apiError('too_many_groups', 409);
    http.expectOne('/api/groups/join').flush(body, options);

    await vi.waitFor(() => expect(alertText()).toBe('Ya perteneces a 20 grupos, el máximo'));
  });

  it('shows the message of a full group', async () => {
    await openDialog();

    await submitCode('ABCD2345');
    const { body, options } = apiError('group_full', 409);
    http.expectOne('/api/groups/join').flush(body, options);

    await vi.waitFor(() => expect(alertText()).toBe('Ese grupo ya tiene 50 miembros, el máximo'));
  });

  it('does not call the API with a blank code', async () => {
    await openDialog();

    await submitCode('   ');
    await harness.fixture.whenStable();

    expect(dialog().textContent).toContain('Pega el código que te compartieron');
    http.expectNone('/api/groups/join');
  });
});
