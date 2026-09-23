import { HttpTestingController } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { JobLinkSummary, LinkPage } from '@linkvault/shared';
import {
  providePageTesting,
  sessionWith,
  settle,
  typeInto,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { LinksStore } from '../../core/links/links.store';
import { LinkList, type LinkListScope } from './link-list.component';

const GROUP_PAGE = '/api/groups/g1/links?limit=20';
const REOPEN_URL = '/api/links/l1/reopen';

/** Vacante cerrada por calendario con caducidad pasada: el API pedirá `expiresAt` al reabrir. */
const closed: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://ejemplo.test/ofertas/1',
  displayUrl: 'https://ejemplo.test/ofertas/ingeniera-de-datos',
  platform: 'generic',
  previewStatus: 'enriched',
  previewVersion: 2,
  preview: {
    title: 'Ingeniera de datos',
    company: 'Acme',
    expiresAt: '2026-09-01',
  },
  closedAt: '2026-09-22T12:00:00.000Z',
  closedReason: 'calendar',
  sharedBy: { userId: 'u2', displayName: 'Beto' },
  sharedAt: '2026-09-17T10:00:00.000Z',
};

const reopened: JobLinkSummary = {
  ...closed,
  previewVersion: 3,
  preview: { ...closed.preview, expiresAt: '2099-01-15' },
  closedAt: undefined,
  closedReason: undefined,
};

/** La lista tal y como la componen el detalle del grupo y `/mis-links`. */
@Component({
  selector: 'lv-reopen-host',
  imports: [LinkList],
  template: `<lv-link-list [links]="items()" [scope]="scope()" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ReopenHost {
  readonly items = inject(LinksStore).items;
  readonly scope = signal<LinkListScope>('group');
}

describe('Reopen vacante cerrada (ADR-041)', () => {
  let fixture: ComponentFixture<ReopenHost>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));

    const opening = TestBed.inject(LinksStore).open({ kind: 'group', groupId: 'g1' });
    http.expectOne(GROUP_PAGE).flush({ items: [closed], total: 1 } satisfies LinkPage);
    await opening;

    fixture = TestBed.createComponent(ReopenHost);
    await fixture.whenStable();
  });

  afterEach(() => {
    document.body.querySelectorAll('mat-snack-bar-container').forEach((node) => node.remove());
    verifyNoPendingRequests(http);
  });

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function dialog(): HTMLElement {
    const container = document.body.querySelector<HTMLElement>('mat-dialog-container');
    if (!container) {
      throw new Error('Dialog not opened');
    }
    return container;
  }

  async function closedDialog(): Promise<void> {
    await vi.waitFor(() =>
      expect(document.body.querySelector('mat-dialog-container')).toBeNull(),
    );
  }

  it('Reabrir sin body quita el badge', async () => {
    expect(host().querySelector('[data-testid="link-closed"]')).not.toBeNull();
    host().querySelector<HTMLButtonElement>('[data-testid="link-reopen"]')?.click();
    await settle();

    const request = http.expectOne({ method: 'POST', url: REOPEN_URL });
    expect(request.request.body).toEqual({});
    // Summary sin `closedAt`: el store reemplaza la tarjeta y el badge desaparece.
    const { closedAt: _omit, closedReason: _omitReason, ...openSummary } = closed;
    request.flush({ ...openSummary, previewVersion: 3 } satisfies JobLinkSummary);
    await settle();
    await fixture.whenStable();

    expect(host().querySelector('[data-testid="link-closed"]')).toBeNull();
    expect(host().querySelector('[data-testid="link-reopen"]')).toBeNull();
    expect(host().textContent).toContain('Ingeniera de datos');
  });

  it('Calendar pide expiresAt: date picker y reintento', async () => {
    host().querySelector<HTMLButtonElement>('[data-testid="link-reopen"]')?.click();
    await settle();

    http
      .expectOne({ method: 'POST', url: REOPEN_URL })
      .flush(
        { code: 'validation_error', message: 'Invalid request', fields: ['expiresAt'] },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();
    await fixture.whenStable();

    expect(dialog().textContent).toContain('Elige cuándo cierra');
    expect(dialog().querySelector('[data-testid="reopen-apps-note"]')?.textContent).toContain(
      'no se reabren solas',
    );

    typeInto(dialog(), '[data-testid="reopen-expires-at"]', '2099-01-15');
    await fixture.whenStable();
    const confirm = dialog().querySelector<HTMLButtonElement>('[data-testid="reopen-confirm"]');
    expect(confirm?.disabled).toBe(false);
    confirm?.click();
    await settle();
    await fixture.whenStable();

    const retry = http.expectOne({ method: 'POST', url: REOPEN_URL });
    expect(retry.request.body).toEqual({ expiresAt: '2099-01-15' });
    retry.flush(reopened);
    await settle();
    await fixture.whenStable();
    await closedDialog();

    expect(host().querySelector('[data-testid="link-closed"]')).toBeNull();
    expect(host().textContent).toContain('Cierra el 15/01/2099');
  });

  it('Calendar: quitar caducidad y reabrir', async () => {
    host().querySelector<HTMLButtonElement>('[data-testid="link-reopen"]')?.click();
    await settle();

    http
      .expectOne({ method: 'POST', url: REOPEN_URL })
      .flush(
        { code: 'validation_error', message: 'Invalid request', fields: ['expiresAt'] },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();
    await fixture.whenStable();

    dialog().querySelector<HTMLButtonElement>('[data-testid="reopen-clear-expires"]')?.click();
    await settle();

    const retry = http.expectOne({ method: 'POST', url: REOPEN_URL });
    expect(retry.request.body).toEqual({ expiresAt: null });
    const { closedAt: _a, closedReason: _b, ...open } = closed;
    retry.flush({
      ...open,
      previewVersion: 3,
      preview: { ...closed.preview, expiresAt: null },
    } satisfies JobLinkSummary);
    await settle();
    await fixture.whenStable();
    await closedDialog();

    expect(host().querySelector('[data-testid="link-closed"]')).toBeNull();
    expect(host().querySelector('[data-testid="link-expires"]')).toBeNull();
  });
});
