import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { GroupDetail, GroupMember, JobLinkSummary, LinkPage } from '@linkvault/shared';
import {
  buttonWithText,
  flushGroupsList,
  providePageTesting,
  sessionWith,
  settle,
  typeInto,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { GroupsStore } from '../../core/groups/groups.store';
import { LinksStore, type LinksScope } from '../../core/links/links.store';
import { Shell } from '../../layout/shell/shell';
import { GroupDetailPage } from './group-detail.page';

const ownerDetail: GroupDetail = {
  id: 'g1',
  name: 'Backend Bolivia',
  role: 'owner',
  memberCount: 2,
  createdAt: '2026-09-10T12:00:00.000Z',
  defaultVisibility: 'public',
  inviteCode: 'ABCD2345',
};

const memberDetail: GroupDetail = {
  id: 'g1',
  name: 'Backend Bolivia',
  role: 'member',
  memberCount: 2,
  createdAt: '2026-09-10T12:00:00.000Z',
  defaultVisibility: 'public',
};

const linkOfBeto: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://co.computrabajo.com/trabajo/1A2B3C',
  displayUrl: 'https://co.computrabajo.com/trabajo-de-analista-de-datos-en-acme-1A2B3C',
  platform: 'computrabajo',
  previewStatus: 'pending',
  previewVersion: 1,
  sharedBy: { userId: 'u2', displayName: 'Beto' },
  sharedAt: '2026-09-17T10:00:00.000Z',
};

const linkOfAna: JobLinkSummary = {
  id: 'l2',
  normalizedUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  displayUrl: 'https://www.linkedin.com/jobs/view/backend-engineer-3912345678',
  platform: 'linkedin',
  previewStatus: 'pending',
  previewVersion: 1,
  sharedBy: { userId: 'u1', displayName: 'Ana' },
  sharedAt: '2026-09-17T09:00:00.000Z',
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

  afterEach(() => verifyNoPendingRequests(http));

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
    return Array.from(page().querySelectorAll('[data-testid="members"] li')).map((row) =>
      Array.from(row.children)
        .filter((cell) => cell.tagName === 'SPAN')
        .map((cell) => cell.textContent?.trim() ?? ''),
    );
  }

  /** Botones de la fila de un miembro, por su nombre. */
  function rowButtons(name: string): (string | undefined)[] {
    const row = Array.from(page().querySelectorAll('[data-testid="members"] li')).find(
      (item) => item.querySelector('span')?.textContent?.trim() === name,
    );
    if (!row) {
      throw new Error(`Member "${name}" not listed`);
    }
    return Array.from(row.querySelectorAll('button')).map((button) => button.textContent?.trim());
  }

  /** Mensaje de la confirmación abierta, sin título ni botones. */
  function dialogMessage(): string {
    return (
      dialog()
        .querySelector('mat-dialog-content p')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim() ?? ''
    );
  }

  /**
   * Botones de la pantalla. El interruptor de la visibilidad por defecto queda fuera: Material lo pinta como un
   * `button[role="switch"]` sin texto propio, y tiene sus propios tests.
   */
  function buttonTexts(): (string | undefined)[] {
    return Array.from(page().querySelectorAll('button'))
      .filter((button) => button.getAttribute('role') !== 'switch')
      .map((button) => button.textContent?.trim());
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

  /**
   * Entra en el detalle y responde al grupo, a sus miembros y a la primera página de sus links. `total` es el número de
   * links del grupo entero, que no tiene por qué ser el de la página: quien lo necesite lo pasa aparte.
   */
  async function openDetail(
    detail: GroupDetail,
    list: GroupMember[] = members,
    links: JobLinkSummary[] = [],
    total: number = links.length,
  ): Promise<void> {
    await harness.navigateByUrl(`/grupos/${detail.id}`, Shell);
    http.expectOne({ method: 'GET', url: `/api/groups/${detail.id}` }).flush(detail);
    await settle();
    http.expectOne({ method: 'GET', url: `/api/groups/${detail.id}/members` }).flush(list);
    await settle();
    http
      .expectOne(`/api/groups/${detail.id}/links?limit=20`)
      .flush({ items: links, total } satisfies LinkPage);
    await settle();
    await harness.fixture.whenStable();
  }

  describe('Guardar antes de que se abra el grupo no guarda en otro sitio', () => {
    /** Deja abierta en `LinksStore` la lista de la que se viene, como tras mirar otro grupo o la lista privada. */
    async function comeFrom(scope: LinksScope): Promise<void> {
      const opening = TestBed.inject(LinksStore).open(scope);
      http
        .expectOne(scope.kind === 'group' ? `/api/groups/${scope.groupId}/links?limit=20` : '/api/links/mine?limit=20')
        .flush({ items: [linkOfBeto], total: 1 } satisfies LinkPage);
      await opening;
    }

    /** Entra en el grupo y se queda entre pintar el grupo y abrir su lista: con los miembros todavía por llegar. */
    async function enterUntilMembers(): Promise<void> {
      await harness.navigateByUrl(`/grupos/${memberDetail.id}`, Shell);
      http.expectOne({ method: 'GET', url: `/api/groups/${memberDetail.id}` }).flush(memberDetail);
      await settle();
      await harness.fixture.whenStable();
    }

    function saveField(): HTMLInputElement | null {
      return page().querySelector<HTMLInputElement>('lv-save-link-form input');
    }

    async function finishEntering(): Promise<void> {
      http.expectOne({ method: 'GET', url: `/api/groups/${memberDetail.id}/members` }).flush(members);
      await settle();
      http.expectOne(`/api/groups/${memberDetail.id}/links?limit=20`).flush({ items: [], total: 0 });
      await settle();
      await harness.fixture.whenStable();
    }

    it('coming from another group', async () => {
      await comeFrom({ kind: 'group', groupId: 'g-anterior' });

      await enterUntilMembers();

      expect(page().textContent).toContain(memberDetail.name);
      expect(saveField()).toBeNull();
      expect(buttonTexts()).not.toContain('Pegar un chat');
      // Tampoco se pintan los links del grupo anterior mientras llega la lista de este.
      expect(page().querySelector('[data-testid="link-list"]')).toBeNull();
      expect(TestBed.inject(LinksStore).scope()).toBeNull();
      http.expectNone({ method: 'POST', url: '/api/links' });

      await finishEntering();

      expect(saveField()).not.toBeNull();
      expect(buttonTexts()).toContain('Pegar un chat');
    });

    it('coming from the private list', async () => {
      await comeFrom({ kind: 'mine' });

      await enterUntilMembers();

      expect(saveField()).toBeNull();
      expect(buttonTexts()).not.toContain('Pegar un chat');
      http.expectNone({ method: 'POST', url: '/api/links' });

      await finishEntering();

      typeInto(page(), 'lv-save-link-form input', 'https://www.linkedin.com/jobs/view/3999999999/');
      await harness.fixture.whenStable();
      buttonWithText(page(), 'Guardar').click();
      const save = await vi.waitFor(() => http.expectOne({ method: 'POST', url: '/api/links' }));
      expect(save.request.body).toEqual({
        url: 'https://www.linkedin.com/jobs/view/3999999999/',
        groupId: memberDetail.id,
      });
      save.flush(null, { status: 500, statusText: 'Error' });
      await settle();
    });
  });

  it('does not ask for the links of a group already left behind', async () => {
    await harness.navigateByUrl(`/grupos/${memberDetail.id}`, Shell);
    http.expectOne({ method: 'GET', url: `/api/groups/${memberDetail.id}` }).flush(memberDetail);
    await settle();

    // El usuario sale de la pantalla mientras todavía se esperan los miembros.
    harness.fixture.destroy();
    http.expectOne({ method: 'GET', url: `/api/groups/${memberDetail.id}/members` }).flush(members);
    await settle();

    http.expectNone(`/api/groups/${memberDetail.id}/links?limit=20`);
    expect(TestBed.inject(LinksStore).scope()).toBeNull();
  });

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
      'Guardar',
      'Pegar un chat',
      'Filtrar',
      'Copiar invitación',
      'Renombrar',
      'Regenerar el código',
      'Nombrar propietario',
      'Expulsar',
      'Borrar el grupo',
    ]);
    // El propietario no puede salir: en lugar de "Salir" se le dice cómo irse.
    expect(text()).toContain('Para salir, nombra propietario a otro miembro');
    expect(text()).not.toContain('Eres el único miembro');
  });

  it('Owner solo en su grupo', async () => {
    await openDetail({ ...ownerDetail, memberCount: 1 }, [members[0]]);

    expect(text()).toContain('Eres el único miembro: para irte, borra el grupo');
    expect(text()).not.toContain('Para salir, nombra propietario a otro miembro');
    expect(buttonTexts()).not.toContain('Nombrar propietario');
    expect(buttonTexts()).not.toContain('Salir del grupo');
  });

  it('Detalle como miembro', async () => {
    await openDetail(memberDetail);

    expect(memberRows()).toEqual([
      ['Ana', 'Propietario', 'Desde el 10/09/2026'],
      ['Beto', 'Miembro', 'Desde el 17/09/2026'],
    ]);
    expect(buttonTexts()).toEqual(['Guardar', 'Pegar un chat', 'Filtrar', 'Salir del grupo']);
    expect(page().querySelector('[data-testid="invite-code"]')).toBeNull();
    expect(text()).not.toContain('Regenéralo si se filtró');
  });

  it('Grupo sin links todavía', async () => {
    await openDetail(memberDetail, [members[0]]);

    expect(text()).toContain(
      'Todavía no hay ofertas aquí. Guarda un link o pega el chat donde las compartís.',
    );
    expect(text()).not.toContain('Pronto podrás guardar links en este grupo');
  });

  it('Grupo con links', async () => {
    await openDetail(memberDetail, members, [linkOfBeto]);

    expect(text()).toContain('trabajo de analista de datos en acme');
    expect(text()).toContain('Compartido por Beto');
    expect(text()).toContain('Sin vista previa todavía');
    // Un miembro que no es owner no puede quitar lo que compartió otro.
    expect(page().querySelector('[data-testid="link-remove"]')).toBeNull();
  });

  it('lets the owner remove any link of the group', async () => {
    await openDetail(ownerDetail, members, [linkOfBeto]);

    expect(page().querySelector('[data-testid="link-remove"]')).not.toBeNull();
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

    // Sin ofertas, el mensaje se queda en la parte de los miembros; solo, no hay a quién nombrar propietario.
    expect(dialogMessage()).toBe('Se borrará solo para ti. No se puede deshacer.');
  });

  it('cuenta una sola oferta en singular', async () => {
    await openDetail({ ...ownerDetail, memberCount: 1 }, [members[0]], [linkOfBeto]);

    await act('Borrar el grupo');

    expect(dialog().textContent?.replace(/\s+/g, ' ')).toContain(
      'Se borrará solo para ti y se perderá 1 oferta compartida aquí (las que estén en otros grupos siguen ahí). No se puede deshacer.',
    );
  });

  it('Borrado informado', async () => {
    // El recuento sale del `total` del listado, no de los links cargados: la primera página trae 2 de 37.
    await openDetail({ ...ownerDetail, memberCount: 3 }, members, [linkOfBeto, linkOfAna], 37);

    await act('Borrar el grupo');

    // Con más de un miembro, la confirmación empieza proponiendo irse sin borrar.
    expect(dialogMessage()).toBe(
      'Si solo quieres irte, nombra propietario a otro miembro y sal del grupo. Se borrará para los 3 miembros y se perderán las 37 ofertas compartidas aquí (las que estén en otros grupos siguen ahí). No se puede deshacer.',
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

  it('Nombrar propietario sobre los demás', async () => {
    const carla: GroupMember = {
      userId: 'u3',
      displayName: 'Carla',
      role: 'member',
      joinedAt: '2026-09-18T12:00:00.000Z',
    };
    await openDetail({ ...ownerDetail, memberCount: 3 }, [...members, carla]);

    expect(rowButtons('Beto')).toContain('Nombrar propietario');
    expect(rowButtons('Carla')).toContain('Nombrar propietario');
    expect(rowButtons('Ana')).toEqual([]);
  });

  it('Nombrar propietario y salir', async () => {
    await openDetail(ownerDetail);

    buttonWithText(page(), 'Nombrar propietario').click();
    await settle();
    await harness.fixture.whenStable();
    expect(dialog().textContent?.replace(/\s+/g, ' ')).toContain(
      '«Beto» tendrá el rol de propietario de «Backend Bolivia»: podrá renombrarlo, expulsar miembros y borrarlo. Tú seguirás como miembro y no podrás deshacerlo.',
    );
    await answer('Nombrar propietario');

    const request = await awaitRequest('POST', '/api/groups/g1/owner');
    expect(request.request.body).toEqual({ userId: 'u2' });
    // La API responde el detalle visto por quien pide, que ya es miembro: sin código.
    request.flush(memberDetail);
    // El store recarga la lista, porque cambia el rol del usuario en el grupo.
    await flushGroupsList(http, []);
    (await awaitRequest('GET', '/api/groups/g1/members')).flush([
      { ...members[0], role: 'member' },
      { ...members[1], role: 'owner' },
    ] satisfies GroupMember[]);
    await settle();
    await harness.fixture.whenStable();

    expect(router.url).toBe('/grupos/g1');
    expect(memberRows()).toEqual([
      ['Ana', 'Miembro', 'Desde el 10/09/2026'],
      ['Beto', 'Propietario', 'Desde el 17/09/2026'],
    ]);
    expect(page().querySelector('[data-testid="invite-code"]')).toBeNull();
    expect(buttonTexts()).toEqual(['Guardar', 'Pegar un chat', 'Filtrar', 'Salir del grupo']);
  });

  it('Cancelar la transferencia', async () => {
    await openDetail(ownerDetail);

    buttonWithText(page(), 'Nombrar propietario').click();
    await settle();
    await harness.fixture.whenStable();
    await answer('Cancelar');
    await settle();

    http.expectNone({ method: 'POST', url: '/api/groups/g1/owner' });
    expect(page().querySelector('[data-testid="invite-code"]')?.textContent?.trim()).toBe(
      'ABCD2345',
    );
    expect(buttonTexts()).toContain('Borrar el grupo');
    expect(buttonTexts()).not.toContain('Salir del grupo');
  });

  describe('los enlaces públicos por defecto', () => {
    function toggle(): HTMLButtonElement | null {
      return page().querySelector<HTMLButtonElement>(
        '[data-testid="group-public-toggle"] button[role="switch"]',
      );
    }

    it('El owner apaga los enlaces públicos por defecto', async () => {
      await openDetail(ownerDetail);
      expect(toggle()?.getAttribute('aria-checked')).toBe('true');

      toggle()?.click();
      await settle();
      const request = await awaitRequest('PATCH', '/api/groups/g1/settings');
      expect(request.request.body).toEqual({ defaultVisibility: 'private' });
      request.flush({ ...ownerDetail, defaultVisibility: 'private' } satisfies GroupDetail);
      await settle();
      await harness.fixture.whenStable();

      expect(toggle()?.getAttribute('aria-checked')).toBe('false');
      expect(text()).toContain(
        'Solo afecta a lo que se guarde a partir de ahora; los links que ya están no cambian.',
      );
    });

    it('turns it back on without reloading the group', async () => {
      await openDetail({ ...ownerDetail, defaultVisibility: 'private' });
      expect(toggle()?.getAttribute('aria-checked')).toBe('false');

      toggle()?.click();
      await settle();
      const request = await awaitRequest('PATCH', '/api/groups/g1/settings');
      expect(request.request.body).toEqual({ defaultVisibility: 'public' });
      request.flush(ownerDetail);
      await settle();
      await harness.fixture.whenStable();

      expect(toggle()?.getAttribute('aria-checked')).toBe('true');
      http.expectNone({ method: 'GET', url: '/api/groups/g1' });
    });

    it('leaves the switch as it was when the API fails', async () => {
      await openDetail(ownerDetail);

      toggle()?.click();
      await settle();
      (await awaitRequest('PATCH', '/api/groups/g1/settings')).flush(
        { code: 'forbidden', message: 'Forbidden' },
        { status: 403, statusText: 'Forbidden' },
      );
      await settle();
      await harness.fixture.whenStable();

      expect(toggle()?.getAttribute('aria-checked')).toBe('true');
      expect(text()).toContain('Algo salió mal. Inténtalo de nuevo');
    });

    it('Un miembro no ve el interruptor', async () => {
      await openDetail(memberDetail);

      expect(page().querySelector('[data-testid="group-default-visibility"]')).toBeNull();
      expect(text()).not.toContain('Los links nuevos se comparten con un enlace público');
    });
  });

  describe('Filtros de organización (tags / pinned)', () => {
    it('pide el listado con pinned=true al activar solo fijados', async () => {
      await openDetail(memberDetail, members, [linkOfAna, linkOfBeto]);

      const pinnedToggle = page().querySelector<HTMLElement>(
        '[data-testid="group-filter-pinned"] button[role="switch"]',
      );
      expect(pinnedToggle).not.toBeNull();
      pinnedToggle?.click();
      await settle();

      http
        .expectOne(`/api/groups/${memberDetail.id}/links?limit=20&pinned=true`)
        .flush({ items: [{ ...linkOfAna, pinned: true }], total: 1 } satisfies LinkPage);
      await settle();
      await harness.fixture.whenStable();

      expect(TestBed.inject(LinksStore).groupFilter()).toEqual({ pinnedOnly: true });
      expect(page().querySelectorAll('[data-testid="link-list"] li').length).toBe(1);
    });

    it('pide el listado con tag y reinicia el cursor', async () => {
      await openDetail(memberDetail, members, [linkOfAna], 2);
      // Simula que ya hay más páginas (cursor) sin cargarlas: el store conserva nextCursor del open.
      // Abrimos de nuevo con cursor en la respuesta para poder afirmar el reset.
      const store = TestBed.inject(LinksStore);
      const reloading = store.reload();
      http
        .expectOne(`/api/groups/${memberDetail.id}/links?limit=20`)
        .flush({
          items: [linkOfAna],
          total: 2,
          nextCursor: 'Y3Vyc29y',
        } satisfies LinkPage);
      await reloading;
      expect(store.nextCursor()).toBe('Y3Vyc29y');

      typeInto(page(), '[data-testid="group-filter-tag-input"]', 'remoto');
      buttonWithText(page(), 'Filtrar').click();
      await settle();

      http
        .expectOne(`/api/groups/${memberDetail.id}/links?limit=20&tag=remoto`)
        .flush({
          items: [{ ...linkOfAna, tags: ['remoto'] }],
          total: 1,
        } satisfies LinkPage);
      await settle();
      await harness.fixture.whenStable();

      expect(store.groupFilter()).toEqual({ tag: 'remoto' });
      expect(store.nextCursor()).toBeNull();
    });

    it('muestra pin y etiquetas en las cards del grupo', async () => {
      await openDetail(memberDetail, members, [
        { ...linkOfAna, pinned: true, tags: ['remoto'] },
      ]);

      expect(page().querySelector('[data-testid="link-pin-toggle"]')?.textContent?.trim()).toBe(
        'Fijado',
      );
      expect(page().querySelector('[data-testid="link-tag-chip"]')?.textContent?.trim()).toBe(
        'remoto',
      );
    });
  });
});
