import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingHarness } from '@angular/router/testing';
import type { GroupSummary } from '@linkvault/shared';
import { providePageTesting, sessionWith, settle } from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { Shell } from '../../layout/shell/shell';
import { GroupsListPage } from './groups-list.page';

const backend: GroupSummary = {
  id: 'g1',
  name: 'Backend Bolivia',
  role: 'owner',
  memberCount: 3,
  joinedAt: '2026-09-17T10:00:00.000Z',
};

const frontend: GroupSummary = {
  id: 'g2',
  name: 'Frontend Bolivia',
  role: 'member',
  memberCount: 1,
  joinedAt: '2026-09-16T10:00:00.000Z',
};

describe('GroupsListPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    // Sesión ya resuelta: los guards no lanzan el refresh inicial.
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => http.verify());

  /** La página vive dentro del shell: se busca por su directiva, no por el elemento de la ruta. */
  function page(): HTMLElement {
    const debugElement = harness.fixture.debugElement.query(By.directive(GroupsListPage));
    if (!debugElement) {
      throw new Error('GroupsListPage not rendered');
    }
    return debugElement.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  /** Entra en `/grupos` y responde a la carga de la lista con `groups`. */
  async function openList(groups: GroupSummary[]): Promise<void> {
    await harness.navigateByUrl('/grupos', Shell);
    http.expectOne({ method: 'GET', url: '/api/groups' }).flush(groups);
    await settle();
    await harness.fixture.whenStable();
  }

  it('Estado vacío', async () => {
    await openList([]);

    expect(text()).toContain(
      'Un grupo es donde tú y tu círculo juntan las ofertas de empleo que encuentran',
    );
    expect(text()).toContain('Crea un grupo o únete con un código');
    const buttons = Array.from(page().querySelectorAll('button')).map((button) =>
      button.textContent?.trim(),
    );
    expect(buttons).toEqual(['Crear un grupo', 'Unirse con un código']);
  });

  it('Lista con grupos', async () => {
    await openList([backend, frontend]);

    expect(text()).toContain(
      'Un grupo es donde tú y tu círculo juntan las ofertas de empleo que encuentran',
    );
    expect(text()).toContain('Backend Bolivia');
    expect(text()).toContain('Propietario · 3 miembros');
    expect(text()).toContain('Frontend Bolivia');
    expect(text()).toContain('Miembro · 1 miembro');
    expect(text()).not.toContain('Crea un grupo o únete con un código');
  });

  it('links every group to its detail', async () => {
    await openList([backend, frontend]);

    const links = Array.from(page().querySelectorAll<HTMLAnchorElement>('a'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/grupos/g1', '/grupos/g2']);
  });

  it('Lista actualizada al volver', async () => {
    await openList([backend, frontend]);
    expect(text()).toContain('Backend Bolivia');

    await harness.navigateByUrl('/perfil');
    await openList([frontend]);

    expect(text()).not.toContain('Backend Bolivia');
    expect(text()).toContain('Frontend Bolivia');
  });

  it('shows the generic failure when the list cannot be loaded', async () => {
    await harness.navigateByUrl('/grupos', Shell);
    http
      .expectOne('/api/groups')
      .flush({ code: 'internal_error', message: 'Boom' }, { status: 500, statusText: 'Error' });
    await settle();
    await harness.fixture.whenStable();

    expect(page().querySelector('[role="alert"]')?.textContent).toContain(
      'Algo salió mal. Inténtalo de nuevo',
    );
  });
});
