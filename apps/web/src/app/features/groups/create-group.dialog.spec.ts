import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { GroupDetail } from '@linkvault/shared';
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

const created: GroupDetail = {
  id: 'g3',
  name: 'Backend Bolivia',
  role: 'owner',
  memberCount: 1,
  createdAt: '2026-09-17T11:00:00.000Z',
  inviteCode: 'ABCD2345',
};

describe('CreateGroupDialog', () => {
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

  function alertText(): string {
    return dialog().querySelector('[role="alert"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  /** Entra en `/grupos` con la lista vacía y abre el diálogo de creación. */
  async function openDialog(): Promise<void> {
    await harness.navigateByUrl('/grupos', Shell);
    await flushGroupsList(http);
    await settle();
    await harness.fixture.whenStable();

    buttonWithText(page(), 'Crear un grupo').click();
    await settle();
    await harness.fixture.whenStable();
  }

  async function submitName(name: string): Promise<void> {
    typeInto(dialog(), 'input[formControlName="name"]', name);
    buttonWithText(dialog(), 'Crear grupo').click();
    await settle();
  }

  it('Grupo creado', async () => {
    await openDialog();

    await submitName('Backend Bolivia');
    const request = http.expectOne({ method: 'POST', url: '/api/groups' });
    expect(request.request.body).toEqual({ name: 'Backend Bolivia' });
    request.flush(created, { status: 201, statusText: 'Created' });
    await settle();
    // El store recarga la lista tras crear; después el diálogo navega al detalle del grupo nuevo.
    await flushGroupsList(http, [
      {
        id: 'g3',
        name: 'Backend Bolivia',
        role: 'owner',
        memberCount: 1,
        joinedAt: '2026-09-17T11:00:00.000Z',
      },
    ]);

    await vi.waitFor(() => expect(router.url).toBe('/grupos/g3'));
    await vi.waitFor(() =>
      expect(document.body.querySelector('mat-dialog-container')).toBeNull(),
    );
  });

  it('Límite de grupos', async () => {
    await openDialog();

    await submitName('Backend Bolivia');
    const { body, options } = apiError('too_many_groups', 409);
    http.expectOne({ method: 'POST', url: '/api/groups' }).flush(body, options);
    await vi.waitFor(() => expect(alertText()).toBe('Ya perteneces a 20 grupos, el máximo'));

    expect(dialog().querySelector<HTMLInputElement>('input[formControlName="name"]')?.value).toBe(
      'Backend Bolivia',
    );
    expect(router.url).toBe('/grupos');
  });

  it('validates the name with the shared schema without calling the API', async () => {
    await openDialog();

    await submitName('   ');
    await harness.fixture.whenStable();

    expect(dialog().textContent).toContain('Escribe un nombre de hasta 60 caracteres');
    http.expectNone({ method: 'POST', url: '/api/groups' });
  });

  it('trims the name before sending it', async () => {
    await openDialog();

    await submitName('  Backend Bolivia ');
    const request = http.expectOne({ method: 'POST', url: '/api/groups' });
    expect(request.request.body).toEqual({ name: 'Backend Bolivia' });
    request.flush(created, { status: 201, statusText: 'Created' });
    await settle();
    await flushGroupsList(http);

    await vi.waitFor(() => expect(router.url).toBe('/grupos/g3'));
  });
});
