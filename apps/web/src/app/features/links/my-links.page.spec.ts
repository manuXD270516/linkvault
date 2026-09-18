import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingHarness } from '@angular/router/testing';
import type { JobLinkSummary, LinkPage } from '@linkvault/shared';
import { providePageTesting, sessionWith, settle } from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { Shell } from '../../layout/shell/shell';
import { MyLinksPage } from './my-links.page';

const MINE_PAGE = '/api/links/mine?limit=20';

const priv: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://ejemplo.test/ofertas/analista-de-datos',
  displayUrl: 'https://ejemplo.test/ofertas/analista-de-datos',
  platform: 'generic',
  previewStatus: 'pending',
  sharedAt: '2026-09-17T10:00:00.000Z',
};

describe('MyLinksPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => http.verify());

  function page(): HTMLElement {
    const debugElement = harness.fixture.debugElement.query(By.directive(MyLinksPage));
    if (!debugElement) {
      throw new Error('MyLinksPage not rendered');
    }
    return debugElement.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  /** Entra en `/mis-links` y responde a la primera página de la lista privada. */
  async function openPage(items: JobLinkSummary[]): Promise<void> {
    await harness.navigateByUrl('/mis-links', Shell);
    const request = await vi.waitFor(() => http.expectOne(MINE_PAGE));
    request.flush({ items, total: items.length } satisfies LinkPage);
    await settle();
    await harness.fixture.whenStable();
  }

  it('Vista privada', async () => {
    await openPage([priv]);

    expect(text()).toContain('Solo para mí');
    expect(text()).toContain('analista de datos');
    expect(page().querySelectorAll('[data-testid="link-open"]')).toHaveLength(1);
  });

  it('Vista privada vacía', async () => {
    await openPage([]);

    expect(text()).toContain('Solo para mí');
    expect(text()).toContain('Aquí guardas ofertas solo para ti. Las que compartiste están en tus grupos.');
  });

  it('offers to save a link and to paste a chat', async () => {
    await openPage([]);

    expect(text()).toContain('Pega el enlace de una oferta');
    expect(text()).toContain('Pegar un chat');
  });

  it('does not show the empty state while the first page is loading', async () => {
    await harness.navigateByUrl('/mis-links', Shell);
    const request = await vi.waitFor(() => http.expectOne(MINE_PAGE));

    expect(text()).not.toContain('Aquí guardas ofertas solo para ti');

    request.flush({ items: [], total: 0 } satisfies LinkPage);
    await settle();
    await harness.fixture.whenStable();
  });
});
