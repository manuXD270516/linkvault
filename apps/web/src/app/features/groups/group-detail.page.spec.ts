import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { GroupDetail, GroupMember } from '@linkvault/shared';
import {
  buttonWithText,
  flushGroupsList,
  providePageTesting,
  sessionWith,
  settle,
  typeInto,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { GroupsStore } from '../../core/groups/groups.store';
import { Shell } from '../../layout/shell/shell';
import { GroupDetailPage } from './group-detail.page';

const ownerDetail: GroupDetail = {
  id: 'g1',
  name: 'Backend Bolivia',
  role: 'owner',
  memberCount: 2,
  createdAt: '2026-09-10T12:00:00.000Z',
  inviteCode: 'ABCD2345',
};

const memberDetail: GroupDetail = {
  id: 'g1',
  name: 'Backend Bolivia',
  role: 'member',
  memberCount: 2,
  createdAt: '2026-09-10T12:00:00.000Z',
};

const members: GroupMember[] = [
  {
    userId: 'u1',
    displayName: 'Ana',
    role: 'owner',
    joinedAt: '2026-09-10T12:00:00.000Z',
  },
  {
    userId: 'u2',
    displayName: 'Beto',
    role: 'member',
    joinedAt: '2026-09-17T12:00:00.000Z',
  },
];

describe('GroupDetailPage', () => {
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
    const debugElement = harness.fixture.debugElement.query(By.directive(GroupDetailPage));
    if (!debugElement) {
      throw new Error('GroupDetailPage not rendered');
    }
    return debugElement.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  /** Cada miembro como `[nombre, rol, fecha de alta]`. */
  function memberRows(): string[][] {
    return Array.from(page().querySelectorAll('li')).map((row) =>
      Array.from(row.children)
        .filter((cell) => cell.tagName === 'SPAN')
        .map((cell) => cell.textContent?.trim() ?? ''),
    );
  }

  function buttonTexts(): (string | undefined)[] {
    return Array.from(page().querySelectorAll('button')).map((button) => button.textContent?.trim());
  }

  /** El diálogo de confirmación se abre en el overlay. */
  function dialog(): HTMLElement {
    const container = document.body.querySelector<HTMLElement>('mat-dialog-container');
    if (!container) {
      throw new Error('Dialog not opened');
    }
    return container;
  }

  /** Pulsa una acción del detalle y espera a la confirmación. */
  async function act(action: string): Promise<void> {
    buttonWithText(page(), action).click();
    await settle();
    await harness.fixture.whenStable();
  }

  async function answer(button: string): Promise<void> {
    buttonWithText(dialog(), button).click();
    await settle();
  }

  /** La acción arranca al cerrarse la confirmación, es decir tras su animación de cierre. */
  async function awaitRequest(method: string, url: string): Promise<TestRequest> {
    return await vi.waitFor(() => http.expectOne({ method, url }));
  }

  /** Entra en el detalle y responde al grupo y a sus miembros. */
  async function openDetail(detail: GroupDetail, list: GroupMember[] = members): Promise<void> {
    await harness.navigateByUrl(`/grupos/${detail.id}`, Shell);
    http.expectOne({ method: 'GET', url: `/api/groups/${detail.id}` }).flush(detail);
    await settle();
    http.expectOne({ method: 'GET', url: `/api/groups/${detail.id}/members` }).flush(list);
    await settle();
    await harness.fixture.whenStable();
  }

  it('Detalle como owner', async () => {
    await openDetail(ownerDetail);

    expect(text()).toContain('Backend Bolivia');
    expect(page().querySelector('[data-testid="invite-code"]')?.textContent?.trim()).toBe(
      'ABCD2345',
    );
    expect(text()).toContain(
      'Quien tenga este código puede entrar y ver los nombres de los miembros. Regenéralo si se filtró.',
    );
    expect(memberRows()).toEqual([
      ['Ana', 'Propietario', 'Desde el 10/09/2026'],
      ['Beto', 'Miembro', 'Desde el 17/09/2026'],
    ]);
    expect(buttonTexts()).toEqual([
      'Copiar invitación',
      'Renombrar',
      'Regenerar el código',
      'Expulsar',
      'Borrar el grupo',
    ]);
  });

  it('Detalle como miembro', async () => {
    await openDetail(memberDetail);

    expect(memberRows()).toEqual([
      ['Ana', 'Propietario', 'Desde el 10/09/2026'],
      ['Beto', 'Miembro', 'Desde el 17/09/2026'],
    ]);
    expect(buttonTexts()).toEqual(['Salir del grupo']);
    expect(page().querySelector('[data-testid="invite-code"]')).toBeNull();
    expect(text()).not.toContain('Regenéralo si se filtró');
  });

  it('Grupo sin links todavía', async () => {
    await openDetail(memberDetail, [members[0]]);

    expect(text()).toContain(
      'Aquí aparecerán las ofertas que compartan los miembros. Pronto podrás guardar links en este grupo.',
    );
  });

  it('Grupo ajeno', async () => {
    // La lista guardada todavía trae el grupo: el 404 del detalle debe quitarlo.
    await harness.navigateByUrl('/grupos', Shell);
    await flushGroupsList(http, [
      {
        id: 'g1',
        name: 'Backend Bolivia',
        role: 'member',
        memberCount: 2,
        joinedAt: '2026-09-17T12:00:00.000Z',
      },
    ]);
    await settle();

    await harness.navigateByUrl('/grupos/g1', Shell);
    http
      .expectOne('/api/groups/g1')
      .flush(
        { code: 'group_not_found', message: 'Group not found' },
        { status: 404, statusText: 'Not Found' },
      );
    await settle();
    await harness.fixture.whenStable();

    expect(text()).toContain('Ese grupo no existe o ya no perteneces a él');
    expect(page().querySelector<HTMLAnchorElement>('a')?.getAttribute('href')).toBe('/grupos');
    expect(TestBed.inject(GroupsStore).groups()).toEqual([]);
    expect(router.url).toBe('/grupos/g1');
    http.expectNone('/api/groups/g1/members');
  });

  it('Salir del grupo', async () => {
    await openDetail(memberDetail);

    await act('Salir del grupo');
    await answer('Salir');
    (await awaitRequest('DELETE', '/api/groups/g1/members/me')).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    // El store recarga la lista tras salir y la página de destino la vuelve a pedir al entrar.
    await flushGroupsList(http, []);

    await vi.waitFor(() => expect(router.url).toBe('/grupos'));
    await flushGroupsList(http, []);
    expect(TestBed.inject(GroupsStore).groups()).toEqual([]);
  });

  it('Cancelar el borrado', async () => {
    await openDetail(ownerDetail);

    await act('Borrar el grupo');
    await answer('Cancelar');
    await settle();

    http.expectNone({ method: 'DELETE', url: '/api/groups/g1' });
    expect(router.url).toBe('/grupos/g1');
    expect(text()).toContain('Backend Bolivia');
  });

  it('renames the group with the shared name rules', async () => {
    await openDetail(ownerDetail);

    await act('Renombrar');
    typeInto(dialog(), 'input[formControlName="name"]', '  Backend LatAm ');
    await answer('Guardar nombre nuevo');

    const request = await awaitRequest('PATCH', '/api/groups/g1');
    expect(request.request.body).toEqual({ name: 'Backend LatAm' });
    request.flush({ ...ownerDetail, name: 'Backend LatAm' });
    // El nombre también cambia en la lista guardada.
    await flushGroupsList(http, []);
    await harness.fixture.whenStable();

    expect(page().querySelector('h1')?.textContent?.trim()).toBe('Backend LatAm');
  });

  it('regenerates the invite code after a confirmation that explains what changes', async () => {
    await openDetail(ownerDetail);

    await act('Regenerar el código');
    expect(dialog().textContent?.replace(/\s+/g, ' ')).toContain(
      'Los miembros actuales siguen dentro; solo dejará de servir el código anterior',
    );

    await answer('Regenerar');
    (await awaitRequest('POST', '/api/groups/g1/invite-code')).flush({ inviteCode: 'WXYZ6789' });
    await settle();
    await harness.fixture.whenStable();

    expect(page().querySelector('[data-testid="invite-code"]')?.textContent?.trim()).toBe(
      'WXYZ6789',
    );
  });

  it('keeps the invite code when the regeneration is cancelled', async () => {
    await openDetail(ownerDetail);

    await act('Regenerar el código');
    await answer('Cancelar');
    await settle();

    http.expectNone({ method: 'POST', url: '/api/groups/g1/invite-code' });
    expect(page().querySelector('[data-testid="invite-code"]')?.textContent?.trim()).toBe(
      'ABCD2345',
    );
  });

  it('Invitación copiada', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await openDetail(ownerDetail);

    await act('Copiar invitación');

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = String(writeText.mock.calls[0]?.[0]);
    // El enlace es absoluto (empieza por `http`) dentro del mensaje que pide la spec.
    const link = `${window.location.origin}/unirse?codigo=ABCD2345`;
    expect(link.startsWith('http')).toBe(true);
    expect(copied).toBe(`Únete a «Backend Bolivia» en LinkVault: ${link} (código ABCD2345)`);
    expect(text()).toContain('Invitación copiada');
  });

  it('shows the message to copy by hand when there is no clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await openDetail(ownerDetail);

    await act('Copiar invitación');

    const fallback = page().querySelector<HTMLTextAreaElement>('[data-testid="invitation-fallback"]');
    expect(fallback?.value).toContain('/unirse?codigo=ABCD2345');
    expect(fallback?.value).toContain('Backend Bolivia');
  });

  it('Expulsar ofrece regenerar el código', async () => {
    await openDetail(ownerDetail);

    buttonWithText(page(), 'Expulsar').click();
    await settle();
    await harness.fixture.whenStable();
    await answer('Expulsar');

    (await awaitRequest('DELETE', '/api/groups/g1/members/u2')).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    await flushGroupsList(http, []);
    (await awaitRequest('GET', '/api/groups/g1')).flush({ ...ownerDetail, memberCount: 1 });
    (await awaitRequest('GET', '/api/groups/g1/members')).flush([members[0]]);
    await settle();
    await harness.fixture.whenStable();

    expect(router.url).toBe('/grupos/g1');
    expect(memberRows()).toEqual([['Ana', 'Propietario', 'Desde el 10/09/2026']]);
    expect(text()).toContain('Regenerar el código para que no pueda volver a entrar');

    // La oferta ya cuenta como confirmación: acepta y regenera sin preguntar otra vez.
    await act('Regenerar el código para que no pueda volver a entrar');
    expect(document.body.querySelector('mat-dialog-container')).toBeNull();
    (await awaitRequest('POST', '/api/groups/g1/invite-code')).flush({ inviteCode: 'WXYZ6789' });
    await settle();
    await harness.fixture.whenStable();

    expect(page().querySelector('[data-testid="invite-code"]')?.textContent?.trim()).toBe(
      'WXYZ6789',
    );
  });

  it('Borrado de un grupo en el que estás solo', async () => {
    await openDetail({ ...ownerDetail, memberCount: 1 }, [members[0]]);

    await act('Borrar el grupo');

    expect(dialog().textContent?.replace(/\s+/g, ' ')).toContain(
      'Se borrará solo para ti. No se puede deshacer.',
    );
  });

  it('Borrado informado', async () => {
    await openDetail({ ...ownerDetail, memberCount: 3 });

    await act('Borrar el grupo');

    expect(dialog().textContent?.replace(/\s+/g, ' ')).toContain(
      'Se borrará para los 3 miembros. No se puede deshacer.',
    );

    await answer('Borrar');
    (await awaitRequest('DELETE', '/api/groups/g1')).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    await flushGroupsList(http, []);

    await vi.waitFor(() => expect(router.url).toBe('/grupos'));
    await flushGroupsList(http, []);
  });
});
