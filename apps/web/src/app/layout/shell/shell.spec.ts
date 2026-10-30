import { BreakpointObserver, type BreakpointState } from '@angular/cdk/layout';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  type TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import {
  NavigationEnd,
  type Event as RouterEvent,
  Router,
  provideRouter,
} from '@angular/router';
import type { CapabilitiesResponse, SessionResponse } from '@linkvault/shared';
import { Subject } from 'rxjs';
import { SessionStore } from '../../core/auth/session.store';
import { CapabilitiesStore } from '../../core/capabilities/capabilities.store';
import { Shell } from './shell';

const session: SessionResponse = {
  accessToken: 'token-1',
  expiresIn: 900,
  user: {
    id: 'u1',
    email: 'ana@example.com',
    displayName: 'Ana',
    emailVerified: true,
    aiConsent: {
      externalProviders: false,
      consentedAt: null,
      textVersion: null,
      currentTextVersion: '2026-09-20',
    },
    outputLanguage: 'es',
    redactName: false,
    createdAt: '2026-09-17T10:00:00.000Z',
  },
};

@Component({ selector: 'lv-login-stub', template: 'login' })
class LoginStub {}

@Component({ selector: 'lv-page-stub', template: 'page' })
class PageStub {}

/**
 * Doble de `BreakpointObserver`: implementa `isMatched` y `observe`. `observe` no repite el valor actual al
 * suscribirse (a propósito): el modo inicial tiene que salir solo de `isMatched`, como pide el primer render.
 */
class FakeBreakpoints {
  private readonly changes = new Subject<BreakpointState>();

  constructor(private matches: boolean) {}

  isMatched(): boolean {
    return this.matches;
  }

  observe() {
    return this.changes.asObservable();
  }

  set(matches: boolean): void {
    this.matches = matches;
    this.changes.next({ matches, breakpoints: {} });
  }
}

type CapabilitiesOutcome = CapabilitiesResponse | 'server-error' | 'pending';

interface MountOptions {
  readonly compact?: boolean;
  readonly capabilities?: CapabilitiesOutcome;
}

interface Mounted {
  readonly fixture: ComponentFixture<Shell>;
  readonly host: HTMLElement;
  readonly breakpoints: FakeBreakpoints;
  readonly http: HttpTestingController;
  readonly capabilitiesRequest: TestRequest;
  readonly router: Router;
  readonly store: SessionStore;
}

const ALL_ON: CapabilitiesResponse = { search: true, discovery: true };

function linkHrefs(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('a'))
    .map((link) => link.getAttribute('href') ?? '')
    .filter((href) => href !== '/');
}

function linkTo(root: ParentNode, href: string): HTMLAnchorElement | null {
  return root.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
}

function logoutButton(host: HTMLElement): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find((element) =>
    element.textContent?.includes('Cerrar sesión'),
  );
  if (!button) {
    throw new Error('Logout button not found');
  }
  return button;
}

function menuButton(host: HTMLElement): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('button[aria-controls]');
  if (!button) {
    throw new Error('Menu button not found');
  }
  return button;
}

function navOf(host: HTMLElement): HTMLElement {
  const nav = host.querySelector<HTMLElement>('nav#lv-shell-nav');
  if (!nav) {
    throw new Error('nav not found');
  }
  return nav;
}

function linkInNav(host: HTMLElement, href: string): HTMLAnchorElement {
  const link = linkTo(navOf(host), href);
  if (!link) {
    throw new Error(`link ${href} not found in the nav`);
  }
  return link;
}

function toolbarOf(host: HTMLElement): HTMLElement {
  const toolbar = host.querySelector<HTMLElement>('mat-toolbar');
  if (!toolbar) {
    throw new Error('toolbar not found');
  }
  return toolbar;
}

function mainOf(host: HTMLElement): HTMLElement {
  const main = host.querySelector('main');
  if (!main) {
    throw new Error('main not found');
  }
  return main;
}

function escape(target: HTMLElement): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
}

describe('Shell', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  async function mount(options: MountOptions = {}): Promise<Mounted> {
    const breakpoints = new FakeBreakpoints(options.compact ?? false);
    TestBed.configureTestingModule({
      imports: [Shell],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'login', component: LoginStub },
          { path: 'mi-cv', component: PageStub },
          { path: 'grupos', component: PageStub },
        ]),
        { provide: BreakpointObserver, useValue: breakpoints },
      ],
    });
    await TestBed.compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(SessionStore);
    const router = TestBed.inject(Router);
    store.setSession(session);

    const fixture = TestBed.createComponent(Shell);
    const request = http.expectOne('/api/capabilities');
    const outcome = options.capabilities ?? ALL_ON;
    if (outcome === 'server-error') {
      request.flush(null, { status: 500, statusText: 'Server Error' });
    } else if (outcome !== 'pending') {
      request.flush(outcome);
    }
    await fixture.whenStable();
    return {
      fixture,
      host: fixture.nativeElement as HTMLElement,
      breakpoints,
      http,
      capabilitiesRequest: request,
      router,
      store,
    };
  }

  async function open(mounted: Mounted): Promise<void> {
    menuButton(mounted.host).click();
    await mounted.fixture.whenStable();
  }

  describe('wide mode', () => {
    it('shows the logout button and a link to the profile', async () => {
      const { host } = await mount();

      expect(logoutButton(host).disabled).toBe(false);
      expect(linkTo(host, '/perfil')?.textContent).toContain('Perfil');
    });

    it('shows a link to the private list of links', async () => {
      const { host } = await mount();

      expect(linkTo(host, '/mis-links')?.textContent).toContain('Solo para mí');
    });

    it('shows a link to my CV', async () => {
      const { host } = await mount();

      expect(linkTo(host, '/mi-cv')?.textContent).toContain('Mi CV');
    });

    it('shows a link to the applications board', async () => {
      const { host } = await mount();

      expect(linkTo(host, '/postulaciones')?.textContent).toContain(
        'Postulaciones',
      );
    });

    it('shows a link to search when it is on', async () => {
      const { host } = await mount();

      expect(linkTo(host, '/buscar')?.textContent).toContain('Buscar');
    });

    it('shows a link to discovery next to search when it is on', async () => {
      const { host } = await mount();

      expect(linkTo(host, '/descubrir')?.textContent).toContain('Descubrir');
    });

    it('renders the entries in the agreed order', async () => {
      const { host } = await mount();

      expect(linkHrefs(host)).toEqual([
        '/grupos',
        '/mis-links',
        '/postulaciones',
        '/mi-cv',
        '/buscar',
        '/descubrir',
        '/perfil',
      ]);
    });

    it('Grupos links to /grupos', async () => {
      const { host } = await mount();

      expect(linkTo(host, '/grupos')?.textContent).toContain('Grupos');
    });

    it('Cerrar sesión comes after every entry', async () => {
      const { host } = await mount();
      const lastEntry = linkTo(host, '/perfil');

      expect(lastEntry).not.toBeNull();
      expect(
        lastEntry?.compareDocumentPosition(logoutButton(host)) ===
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBe(true);
    });

    it('hides Buscar and Descubrir when both capabilities are off', async () => {
      const { host } = await mount({
        capabilities: { search: false, discovery: false },
      });

      expect(linkTo(host, '/buscar')).toBeNull();
      expect(linkTo(host, '/descubrir')).toBeNull();
      expect(linkTo(host, '/postulaciones')).not.toBeNull();
    });

    it('shows Descubrir and hides Buscar when only discovery is on', async () => {
      const { host } = await mount({
        capabilities: { search: false, discovery: true },
      });

      expect(linkTo(host, '/buscar')).toBeNull();
      expect(linkTo(host, '/descubrir')).not.toBeNull();
    });

    it('hides both while capabilities are loading', async () => {
      const { host } = await mount({ capabilities: 'pending' });

      expect(linkTo(host, '/buscar')).toBeNull();
      expect(linkTo(host, '/descubrir')).toBeNull();
    });

    it('shows both when the capabilities request fails', async () => {
      const { host } = await mount({ capabilities: 'server-error' });

      expect(linkTo(host, '/buscar')).not.toBeNull();
      expect(linkTo(host, '/descubrir')).not.toBeNull();
    });

    it('toolbar reflects the capabilities state in data-capabilities', async () => {
      const { host, fixture, capabilitiesRequest } = await mount({
        capabilities: 'pending',
      });
      const state = () =>
        host.querySelector('mat-toolbar')?.getAttribute('data-capabilities');
      expect(state()).toBe('loading');

      capabilitiesRequest.flush(ALL_ON);
      await TestBed.inject(CapabilitiesStore).ensureLoaded();
      await fixture.whenStable();

      expect(state()).toBe('ready');
    });

    it('toolbar reports failed in data-capabilities after a 500', async () => {
      const { host } = await mount({ capabilities: 'server-error' });

      expect(
        host.querySelector('mat-toolbar')?.getAttribute('data-capabilities'),
      ).toBe('failed');
    });

    it('wide mode has no menu button', async () => {
      const { host } = await mount();

      expect(host.querySelector('button[aria-controls]')).toBeNull();
      expect(host.querySelector('nav')).toBeNull();
    });

    it('logs out and navigates to /login', async () => {
      const { host, http, router, store } = await mount();

      logoutButton(host).click();
      http
        .expectOne('/api/auth/logout')
        .flush(null, { status: 204, statusText: 'No Content' });

      await vi.waitFor(() => expect(router.url).toBe('/login'));
      expect(store.status()).toBe('anonymous');
    });

    it('Logout con red caída', async () => {
      const { host, http, router, store } = await mount();

      logoutButton(host).click();
      http.expectOne('/api/auth/logout').error(new ProgressEvent('error'), {
        status: 0,
        statusText: 'Unknown Error',
      });

      await vi.waitFor(() => expect(router.url).toBe('/login'));
      expect(store.status()).toBe('anonymous');
      expect(store.accessToken()).toBeNull();
    });
  });

  describe('compact mode', () => {
    it('compact bar shows only the brand and the menu button', async () => {
      const { host } = await mount({ compact: true });
      const toolbar = host.querySelector('mat-toolbar');

      expect(toolbar?.querySelectorAll('a')).toHaveLength(1);
      expect(toolbar?.querySelector('a')?.textContent).toContain('LinkVault');
      expect(toolbar?.querySelectorAll('button')).toHaveLength(1);
      expect(menuButton(host).textContent).toContain('Menú');
    });

    it('renders compact on the first change detection when the query already matches', async () => {
      const breakpoints = new FakeBreakpoints(true);
      TestBed.configureTestingModule({
        imports: [Shell],
        providers: [
          provideZonelessChangeDetection(),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideRouter([]),
          { provide: BreakpointObserver, useValue: breakpoints },
        ],
      });
      const fixture = TestBed.createComponent(Shell);
      fixture.detectChanges();

      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          'button[aria-controls]',
        ),
      ).not.toBeNull();
      expect(
        linkHrefs(toolbarOf(fixture.nativeElement as HTMLElement)),
      ).toEqual([]);
      TestBed.inject(HttpTestingController).expectOne('/api/capabilities');
    });

    it('menu button starts with aria-expanded false and points to the nav', async () => {
      const { host } = await mount({ compact: true });
      const button = menuButton(host);

      expect(button.getAttribute('aria-expanded')).toBe('false');
      const controls = button.getAttribute('aria-controls');
      expect(controls).toBe('lv-shell-nav');
      expect(host.querySelector(`#${controls}`)?.tagName).toBe('NAV');
    });

    it('the nav exists and is hidden while closed', async () => {
      const { host } = await mount({ compact: true });
      const nav = host.querySelector<HTMLElement>('nav#lv-shell-nav');

      expect(nav).not.toBeNull();
      expect(nav?.hidden).toBe(true);
      expect(nav?.getAttribute('aria-label')).toBe('Navegación principal');
    });

    it('opening the menu lists the visible entries as links', async () => {
      const mounted = await mount({ compact: true });
      await open(mounted);
      const nav = navOf(mounted.host);

      expect(menuButton(mounted.host).getAttribute('aria-expanded')).toBe(
        'true',
      );
      expect(nav.hidden).toBe(false);
      expect(linkHrefs(nav)).toEqual([
        '/grupos',
        '/mis-links',
        '/postulaciones',
        '/mi-cv',
        '/buscar',
        '/descubrir',
        '/perfil',
      ]);
      expect(nav.lastElementChild?.textContent).toContain('Cerrar sesión');
    });

    it('compact panel hides Buscar and Descubrir when both are off', async () => {
      const mounted = await mount({
        compact: true,
        capabilities: { search: false, discovery: false },
      });
      await open(mounted);
      const nav = navOf(mounted.host);

      expect(linkTo(nav, '/buscar')).toBeNull();
      expect(linkTo(nav, '/descubrir')).toBeNull();
      expect(linkTo(nav, '/mi-cv')).not.toBeNull();
    });

    it('toggles the panel with the menu button', async () => {
      const mounted = await mount({ compact: true });
      const button = menuButton(mounted.host);

      await open(mounted);
      expect(button.getAttribute('aria-expanded')).toBe('true');

      button.click();
      await mounted.fixture.whenStable();
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(button);
    });

    it('closes the panel and focuses main when a navigation completes while it is open', async () => {
      const mounted = await mount({ compact: true });
      await open(mounted);

      await mounted.router.navigateByUrl('/mi-cv');
      await mounted.fixture.whenStable();

      expect(menuButton(mounted.host).getAttribute('aria-expanded')).toBe(
        'false',
      );
      expect(document.activeElement).toBe(mainOf(mounted.host));
    });

    it('closes the panel after navigating to Mi CV', async () => {
      const mounted = await mount({ compact: true });
      await open(mounted);

      linkInNav(mounted.host, '/mi-cv').click();
      await vi.waitFor(() => expect(mounted.router.url).toBe('/mi-cv'));
      await mounted.fixture.whenStable();

      expect(menuButton(mounted.host).getAttribute('aria-expanded')).toBe(
        'false',
      );
      expect(document.activeElement).toBe(mainOf(mounted.host));
    });

    it("tapping the current route's entry closes the panel", async () => {
      const mounted = await mount({ compact: true });
      await mounted.router.navigateByUrl('/mi-cv');
      await open(mounted);

      linkInNav(mounted.host, '/mi-cv').click();
      await mounted.fixture.whenStable();

      expect(menuButton(mounted.host).getAttribute('aria-expanded')).toBe(
        'false',
      );
      expect(document.activeElement).toBe(mainOf(mounted.host));
    });

    it('focuses main after navigating from the panel', async () => {
      const mounted = await mount({ compact: true });
      await open(mounted);

      linkInNav(mounted.host, '/grupos').click();
      await vi.waitFor(() => expect(mounted.router.url).toBe('/grupos'));
      await mounted.fixture.whenStable();

      expect(document.activeElement).toBe(mainOf(mounted.host));
    });

    it('focuses main without scrolling', async () => {
      const mounted = await mount({ compact: true });
      const focus = vi.spyOn(mainOf(mounted.host), 'focus');
      await open(mounted);

      linkInNav(mounted.host, '/mi-cv').click();
      await mounted.fixture.whenStable();

      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it('does not move focus on NavigationEnd when the panel was closed', async () => {
      const mounted = await mount({ compact: true });
      await mounted.router.navigateByUrl('/mi-cv');
      const input = document.createElement('input');
      mainOf(mounted.host).appendChild(input);
      input.focus();
      const events: RouterEvent[] = [];
      mounted.router.events.subscribe((event) => events.push(event));

      await mounted.router.navigate([], {
        queryParams: { q: 'x' },
        replaceUrl: true,
      });
      await mounted.fixture.whenStable();

      expect(events.some((event) => event instanceof NavigationEnd)).toBe(true);
      expect(document.activeElement).toBe(input);
      expect(menuButton(mounted.host).getAttribute('aria-expanded')).toBe(
        'false',
      );
    });

    it('Escape closes the panel and focuses the menu button', async () => {
      const mounted = await mount({ compact: true });
      await open(mounted);
      const link = linkInNav(mounted.host, '/mi-cv');
      link.focus();

      escape(link);
      await mounted.fixture.whenStable();

      expect(menuButton(mounted.host).getAttribute('aria-expanded')).toBe(
        'false',
      );
      expect(document.activeElement).toBe(menuButton(mounted.host));
    });

    it('ignores Escape when the panel is closed', async () => {
      const mounted = await mount({ compact: true });
      const input = document.createElement('input');
      mainOf(mounted.host).appendChild(input);
      input.focus();

      escape(menuButton(mounted.host));
      await mounted.fixture.whenStable();

      expect(menuButton(mounted.host).getAttribute('aria-expanded')).toBe(
        'false',
      );
      expect(document.activeElement).toBe(input);
    });

    it('ignores Escape from outside the header', async () => {
      const mounted = await mount({ compact: true });
      await open(mounted);
      const input = document.createElement('input');
      mainOf(mounted.host).appendChild(input);
      input.focus();

      escape(input);
      await mounted.fixture.whenStable();

      expect(menuButton(mounted.host).getAttribute('aria-expanded')).toBe(
        'true',
      );
      expect(document.activeElement).toBe(input);
    });

    it('closes the panel when the viewport becomes wide', async () => {
      const mounted = await mount({ compact: true });
      await open(mounted);
      const main = mainOf(mounted.host);
      const focus = vi.spyOn(main, 'focus');
      linkInNav(mounted.host, '/mi-cv').focus();

      mounted.breakpoints.set(false);
      await mounted.fixture.whenStable();

      expect(mounted.host.querySelector('nav')).toBeNull();
      expect(linkTo(mounted.host, '/mi-cv')).not.toBeNull();
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(document.activeElement).toBe(main);
    });
  });
});
