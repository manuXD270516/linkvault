import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { JobLinkSummary, LinkPage } from '@linkvault/shared';
import {
  buttonWithText,
  providePageTesting,
  sessionWith,
  settle,
  testUser,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { LinksStore } from '../../core/links/links.store';
import { LinkList } from './link-list.component';

/** El detalle del grupo compone así la lista: los links salen del store, abierto en el grupo `g1`. */
@Component({
  selector: 'lv-link-list-comments-host',
  imports: [LinkList],
  template: `<lv-link-list
    [links]="items()"
    scope="group"
    groupId="g1"
    [canModerate]="canModerate()"
  />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class GroupHost {
  readonly items = inject(LinksStore).items;
  readonly canModerate = signal(false);
}

const GROUP_PAGE = '/api/groups/g1/links?limit=20';
const note = { text: 'Esta es la que te dije', createdAt: '2026-09-17T10:00:00.000Z' };

/** Compartido por Beto, con nota. */
const ofBeto: JobLinkSummary = {
  id: 'l2',
  normalizedUrl: 'https://co.computrabajo.com/trabajo/1A2B3C',
  displayUrl: 'https://co.computrabajo.com/trabajo-de-analista-de-datos-en-acme-1A2B3C',
  platform: 'computrabajo',
  previewStatus: 'pending',
  previewVersion: 1,
  sharedBy: { userId: 'u2', displayName: 'Beto' },
  sharedAt: '2026-09-17T09:00:00.000Z',
  note,
};

/** Compartido por Ana (`testUser`, `u1`), con nota. */
const ofAna: JobLinkSummary = {
  ...ofBeto,
  id: 'l1',
  normalizedUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  displayUrl: 'https://www.linkedin.com/jobs/view/senior-backend-engineer-3912345678/',
  platform: 'linkedin',
  sharedBy: { userId: 'u1', displayName: 'Ana' },
};

describe('LinkList: la nota del grupo', () => {
  let fixture: ComponentFixture<GroupHost>;
  let http: HttpTestingController;

  async function setUp(user = testUser, links: JobLinkSummary[] = [ofAna, ofBeto]): Promise<void> {
    TestBed.inject(SessionStore).setSession(sessionWith('token-1', user));
    const store = TestBed.inject(LinksStore);
    const opening = store.open({ kind: 'group', groupId: 'g1' });
    http.expectOne(GROUP_PAGE).flush({ items: links, total: links.length } satisfies LinkPage);
    await opening;
    fixture = TestBed.createComponent(GroupHost);
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => verifyNoPendingRequests(http));

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function rowOf(label: string): HTMLElement {
    const row = Array.from(host().querySelectorAll<HTMLElement>('li')).find((item) =>
      item.textContent?.includes(label),
    );
    if (!row) {
      throw new Error(`Row "${label}" not rendered`);
    }
    return row;
  }

  function removeNoteIn(label: string): HTMLButtonElement | null {
    return rowOf(label).querySelector<HTMLButtonElement>('[data-testid="link-note-remove"]');
  }

  function dialog(): HTMLElement {
    const container = document.body.querySelector<HTMLElement>('mat-dialog-container');
    if (!container) {
      throw new Error('Dialog not opened');
    }
    return container;
  }

  async function clickRemoveNote(label: string): Promise<void> {
    const button = removeNoteIn(label);
    if (!button) {
      throw new Error(`Row "${label}" does not offer to remove its note`);
    }
    button.click();
    await settle();
    await fixture.whenStable();
  }

  async function awaitRequest(method: string, url: string): Promise<TestRequest> {
    return await vi.waitFor(() => http.expectOne({ method, url }));
  }

  it('Quitar la nota', async () => {
    await setUp();
    fixture.componentInstance.canModerate.set(true);
    await fixture.whenStable();

    await clickRemoveNote('analista de datos');
    expect(dialog().textContent).toContain(
      '¿Quitar la nota de Beto? Desaparecerá para todo el grupo y no se puede deshacer.',
    );
    buttonWithText(dialog(), 'Quitar la nota').click();
    await settle();

    (await awaitRequest('DELETE', '/api/groups/g1/links/l2/note')).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    await settle();
    await fixture.whenStable();

    http.expectNone(GROUP_PAGE);
    expect(rowOf('analista de datos').querySelector('[data-testid="link-note"]')).toBeNull();
    expect(rowOf('senior backend engineer').querySelector('[data-testid="link-note"]')).not.toBeNull();
  });

  it('asks a shorter question to remove your own note', async () => {
    await setUp();

    await clickRemoveNote('senior backend engineer');

    expect(dialog().textContent).toContain('¿Quitar la nota? No se puede deshacer.');
    expect(dialog().textContent).not.toContain('Desaparecerá');
    buttonWithText(dialog(), 'Cancelar').click();
    await settle();
    await fixture.whenStable();

    http.expectNone({ method: 'DELETE', url: '/api/groups/g1/links/l1/note' });
    expect(rowOf('senior backend engineer').querySelector('[data-testid="link-note"]')).not.toBeNull();
  });

  it('does not offer to remove a note to a member who neither shared it nor owns the group', async () => {
    await setUp({ ...testUser, id: 'u3', displayName: 'Carla' });

    expect(removeNoteIn('analista de datos')).toBeNull();
    expect(removeNoteIn('senior backend engineer')).toBeNull();
    expect(rowOf('analista de datos').textContent).toContain('Esta es la que te dije');
  });
});
