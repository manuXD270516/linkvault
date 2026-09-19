import { BreakpointObserver, type BreakpointState } from '@angular/cdk/layout';
import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import type {
  CommentPage,
  CommentsSummary,
  CreateCommentResponse,
  GroupLinkComment,
  JobLinkSummary,
  LinkPage,
} from '@linkvault/shared';
import { BehaviorSubject, type Observable, map } from 'rxjs';
import {
  providePageTesting,
  sessionWith,
  settle,
  testUser,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { LinksStore } from '../../core/links/links.store';
import { type VisualViewportLike, VISUAL_VIEWPORT } from './comments.dialog';
import { LinkList } from './link-list.component';

/** El hilo se prueba abierto desde la lista del grupo, que es donde vive: así se ve también lo que cambia en la tarjeta. */
@Component({
  selector: 'lv-comments-host',
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
const THREAD = '/api/groups/g1/links/l1/comments';
const SHARED_AT = '2026-09-17T10:00:00.000Z';

const link: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  displayUrl: 'https://www.linkedin.com/jobs/view/3912345678/',
  platform: 'linkedin',
  previewStatus: 'enriched',
  previewVersion: 1,
  preview: { title: 'Backend Engineer', company: 'Acme' },
  sharedBy: { userId: 'u2', displayName: 'Beto' },
  sharedAt: SHARED_AT,
};

/** Comentario número `n`: cuanto mayor, más reciente. */
function commentNumber(n: number, displayName = 'Beto'): GroupLinkComment {
  return {
    id: `c${n}`,
    author: { userId: displayName === 'Ana' ? 'u1' : `u-${displayName}`, displayName },
    authorLeft: false,
    text: `Comentario ${n}`,
    createdAt: new Date(Date.UTC(2026, 8, 19, 10, n)).toISOString(),
  };
}

/** Los comentarios de `from` a `to`, del más reciente al más antiguo, como los da la API. */
function newestFirst(from: number, to: number): GroupLinkComment[] {
  const items: GroupLinkComment[] = [];
  for (let n = to; n >= from; n--) {
    items.push(commentNumber(n));
  }
  return items;
}

/** El punto de corte `sm` a voluntad: por defecto, una pantalla grande. */
class FakeBreakpoints {
  readonly small = new BehaviorSubject(false);
  observe(): Observable<BreakpointState> {
    return this.small.pipe(map((matches) => ({ matches, breakpoints: {} })));
  }
  isMatched(): boolean {
    return this.small.value;
  }
}

/** El viewport visual de un móvil: al abrirse el teclado encoge y avisa con `resize`. */
class FakeViewport extends EventTarget implements VisualViewportLike {
  height = 800;
  offsetTop = 0;
}

describe('CommentsDialog', () => {
  let fixture: ComponentFixture<GroupHost>;
  let http: HttpTestingController;
  let breakpoints: FakeBreakpoints;
  let viewport: FakeViewport;

  beforeEach(() => {
    breakpoints = new FakeBreakpoints();
    viewport = new FakeViewport();
    TestBed.configureTestingModule({
      providers: [
        ...providePageTesting(),
        { provide: BreakpointObserver, useValue: breakpoints },
        { provide: VISUAL_VIEWPORT, useValue: viewport },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    TestBed.inject(MatSnackBar).dismiss();
    verifyNoPendingRequests(http);
  });

  async function setUp(links: JobLinkSummary[] = [link], user = testUser): Promise<void> {
    TestBed.inject(SessionStore).setSession(sessionWith('token-1', user));
    const store = TestBed.inject(LinksStore);
    const opening = store.open({ kind: 'group', groupId: 'g1' });
    http.expectOne(GROUP_PAGE).flush({ items: links, total: links.length } satisfies LinkPage);
    await opening;
    fixture = TestBed.createComponent(GroupHost);
    await fixture.whenStable();
  }

  async function refresh(): Promise<void> {
    await settle();
    await fixture.whenStable();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function dialog(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>('lv-comments-dialog');
  }

  function openedDialog(): HTMLElement {
    const element = dialog();
    if (!element) {
      throw new Error('Thread not opened');
    }
    return element;
  }

  function threadTexts(): string[] {
    return Array.from(openedDialog().querySelectorAll('[data-testid="thread-comment"] [data-testid="comment-text"]')).map(
      (element) => element.textContent ?? '',
    );
  }

  async function awaitRequest(url: string, method = 'GET'): Promise<TestRequest> {
    return await vi.waitFor(() => http.expectOne({ method, url }));
  }

  /** Pulsa la acción de la tarjeta y responde la primera página del hilo. */
  async function openThread(page: CommentPage): Promise<void> {
    host().querySelector<HTMLButtonElement>('[data-testid="link-comments-open"]')?.click();
    await refresh();
    (await awaitRequest(`${THREAD}?limit=20`)).flush(page);
    await refresh();
  }

  function inDialog<T extends HTMLElement>(testId: string): T | null {
    return openedDialog().querySelector<T>(`[data-testid="${testId}"]`);
  }

  async function write(text: string): Promise<void> {
    const draft = inDialog<HTMLTextAreaElement>('comment-draft');
    if (!draft) {
      throw new Error('No comment box');
    }
    draft.value = text;
    draft.dispatchEvent(new Event('input'));
    await refresh();
  }

  function postButton(): HTMLButtonElement {
    const button = inDialog<HTMLButtonElement>('comment-post');
    if (!button) {
      throw new Error('No post button');
    }
    return button;
  }

  function cardTexts(): string[] {
    return Array.from(host().querySelectorAll('[data-testid="link-comment"] [data-testid="comment-text"]')).map(
      (element) => element.textContent ?? '',
    );
  }

  function cardAction(): string {
    return host().querySelector('[data-testid="link-comments-open"]')?.textContent?.trim() ?? '';
  }

  function summaryOf(count: number, latest: GroupLinkComment[]): CommentsSummary {
    return { count, revision: count, sharedAt: SHARED_AT, latest };
  }

  describe('lectura', () => {
    it('Hilo largo', async () => {
      await setUp([{ ...link, comments: { count: 25, revision: 25, sharedAt: SHARED_AT, latest: newestFirst(24, 25) } }]);

      await openThread({ items: newestFirst(6, 25), total: 25, nextCursor: 'Y3Vyc29y' });

      expect(openedDialog().querySelector('h2')?.textContent).toContain('Comentarios');
      expect(openedDialog().querySelector('[data-testid="comments-headline"]')?.textContent).toBe(
        'Backend Engineer',
      );
      expect(threadTexts()).toHaveLength(20);
      expect(threadTexts()[0]).toBe('Comentario 6');
      expect(threadTexts()[19]).toBe('Comentario 25');

      openedDialog().querySelector<HTMLButtonElement>('[data-testid="comments-older"]')?.click();
      // La página siguiente repite a propósito el 6: el cursor no debe duplicar lo que ya se ve.
      (await awaitRequest(`${THREAD}?limit=20&cursor=Y3Vyc29y`)).flush({
        items: newestFirst(1, 6),
        total: 25,
      } satisfies CommentPage);
      await refresh();

      expect(threadTexts()).toEqual(Array.from({ length: 25 }, (_, index) => `Comentario ${index + 1}`));
      expect(openedDialog().querySelector('[data-testid="comments-older"]')).toBeNull();
    });

    it('Hilo vacío', async () => {
      await setUp();

      await openThread({ items: [], total: 0 });

      expect(openedDialog().querySelector('[data-testid="comments-empty"]')?.textContent?.trim()).toBe(
        'Todavía nadie comentó esta oferta. Cuenta lo que sepas: requisitos, si ya cerró, a quién escribir.',
      );
      expect(openedDialog().querySelector('[data-testid="comments-older"]')).toBeNull();
    });

    it('shows each comment whole, with its line breaks, in the thread', async () => {
      await setUp();
      const long = { ...commentNumber(1), text: `${'c'.repeat(399)}\nfin` };

      await openThread({ items: [long], total: 1 });

      const [text] = Array.from(openedDialog().querySelectorAll<HTMLElement>('[data-testid="comment-text"]'));
      expect(text?.textContent).toBe(long.text);
      expect(text?.classList).not.toContain('line-clamp-2');
    });

    it('La oferta ya no está', async () => {
      await setUp();

      host().querySelector<HTMLButtonElement>('[data-testid="link-comments-open"]')?.click();
      await refresh();
      (await awaitRequest(`${THREAD}?limit=20`)).flush(
        { code: 'link_not_found', message: 'Not found' },
        { status: 404, statusText: 'Not Found' },
      );

      (await awaitRequest(GROUP_PAGE)).flush({ items: [], total: 0 } satisfies LinkPage);
      await refresh();

      await vi.waitFor(() => expect(dialog()).toBeNull());
      expect(document.body.textContent).toContain('Esta oferta ya no está en el grupo');
    });

    it('closes the same way when the person is no longer a member', async () => {
      await setUp();

      host().querySelector<HTMLButtonElement>('[data-testid="link-comments-open"]')?.click();
      await refresh();
      (await awaitRequest(`${THREAD}?limit=20`)).flush(
        { code: 'group_not_found', message: 'Not found' },
        { status: 404, statusText: 'Not Found' },
      );

      (await awaitRequest(GROUP_PAGE)).flush({ items: [], total: 0 } satisfies LinkPage);
      await refresh();

      await vi.waitFor(() => expect(dialog()).toBeNull());
    });
  });

  describe('en el móvil', () => {
    function pane(): HTMLElement | null {
      return document.body.querySelector<HTMLElement>('.cdk-overlay-pane');
    }

    it('En el móvil', async () => {
      breakpoints.small.next(true);
      await setUp();

      await openThread({ items: newestFirst(1, 2), total: 2 });

      expect(pane()?.classList).toContain('lv-dialog-fullscreen');
      expect(pane()?.style.width).toBe('100vw');
      const frame = inDialog('comments-dialog');
      expect(frame?.style.height).toBe('800px');

      // Se enfoca el cuadro y el teclado deja 450 px de viewport visual: el diálogo encoge hasta ahí.
      inDialog<HTMLTextAreaElement>('comment-draft')?.focus();
      viewport.height = 450;
      viewport.dispatchEvent(new Event('resize'));
      await refresh();

      expect(frame?.style.height).toBe('450px');
      // "Comentar" vive en el pie del marco, que es su último hijo: queda justo encima del teclado.
      const footer = inDialog('comments-composer');
      expect(frame?.lastElementChild).toBe(footer);
      expect(footer?.contains(postButton())).toBe(true);
    });

    it('keeps its normal size on a large screen', async () => {
      await setUp();

      await openThread({ items: [], total: 0 });

      expect(pane()?.classList).not.toContain('lv-dialog-fullscreen');
      expect(inDialog('comments-dialog')?.style.height).toBe('');
    });

    it('follows the screen when it turns', async () => {
      await setUp();
      await openThread({ items: [], total: 0 });

      breakpoints.small.next(true);
      await refresh();
      expect(pane()?.classList).toContain('lv-dialog-fullscreen');

      breakpoints.small.next(false);
      await refresh();
      expect(pane()?.classList).not.toContain('lv-dialog-fullscreen');
    });
  });

  describe('escritura', () => {
    const two = [commentNumber(2), commentNumber(1)];

    async function openWithTwo(): Promise<void> {
      await setUp([{ ...link, comments: summaryOf(2, two) }]);
      await openThread({ items: two, total: 2 });
    }

    function mine(text: string): GroupLinkComment {
      return { ...commentNumber(3, 'Ana'), text };
    }

    it('Publicar', async () => {
      await openWithTwo();
      expect(cardAction()).toBe('Responder');

      await write('Ya cerró');
      postButton().click();
      const request = await awaitRequest(THREAD, 'POST');
      expect(request.request.body).toEqual({ text: 'Ya cerró' });
      const created = mine('Ya cerró');
      request.flush(
        { comment: created, comments: summaryOf(3, [created, commentNumber(2)]) } satisfies CreateCommentResponse,
        { status: 201, statusText: 'Created' },
      );
      await refresh();

      expect(threadTexts()).toEqual(['Comentario 1', 'Comentario 2', 'Ya cerró']);
      expect(inDialog<HTMLTextAreaElement>('comment-draft')?.value).toBe('');
      expect(cardAction()).toBe('Ver los 3 comentarios');
      expect(cardTexts().at(-1)).toBe('Ya cerró');
    });

    it('La indicación dice qué pasa al salir', async () => {
      await openWithTwo();

      expect(inDialog('comment-hint')?.textContent?.trim()).toBe(
        'Lo verán los miembros de este grupo y seguirá aquí aunque salgas.',
      );
      expect(inDialog('comment-counter')?.textContent?.trim()).toBe('0/500');
    });

    it('Demasiado largo', async () => {
      await openWithTwo();

      await write('a'.repeat(501));

      expect(inDialog('comment-counter')?.textContent?.trim()).toBe('501/500');
      expect(inDialog('comment-too-long')?.textContent?.trim()).toBe('Máximo 500 caracteres');
      expect(postButton().disabled).toBe(true);

      // 500 rodeados de espacios sí caben: se mide sin los espacios exteriores.
      await write(`  ${'a'.repeat(500)}  `);
      expect(inDialog('comment-counter')?.textContent?.trim()).toBe('500/500');
      expect(postButton().disabled).toBe(false);
    });

    it('does not post an empty comment', async () => {
      await openWithTwo();

      expect(postButton().disabled).toBe(true);
      await write('   ');
      expect(postButton().disabled).toBe(true);
    });

    it('Demasiados comentarios', async () => {
      await openWithTwo();

      await write('Otra más');
      postButton().click();
      (await awaitRequest(THREAD, 'POST')).flush(
        { code: 'too_many_attempts', message: 'Too many' },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '300' } },
      );
      await refresh();

      expect(inDialog('comment-post-error')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'Escribiste muchos comentarios seguidos. Vuelve a intentarlo en 5 minutos',
      );
      expect(inDialog<HTMLTextAreaElement>('comment-draft')?.value).toBe('Otra más');
    });

    it('says "later" when the API gives no wait, and the generic message for anything else', async () => {
      await openWithTwo();
      await write('Otra más');

      postButton().click();
      (await awaitRequest(THREAD, 'POST')).flush(
        { code: 'too_many_attempts', message: 'Too many' },
        { status: 429, statusText: 'Too Many Requests' },
      );
      await refresh();
      expect(inDialog('comment-post-error')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'Escribiste muchos comentarios seguidos. Vuelve a intentarlo más tarde',
      );

      postButton().click();
      (await awaitRequest(THREAD, 'POST')).flush(
        { code: 'internal_error', message: 'Boom' },
        { status: 500, statusText: 'Internal Server Error' },
      );
      await refresh();
      expect(inDialog('comment-post-error')?.textContent?.trim()).toBe(
        'No se pudo publicar el comentario. Inténtalo de nuevo.',
      );
      expect(inDialog<HTMLTextAreaElement>('comment-draft')?.value).toBe('Otra más');
    });

    it('Un solo envío', async () => {
      await openWithTwo();
      await write('Ya cerró');

      postButton().click();
      postButton().click();
      inDialog<HTMLTextAreaElement>('comment-draft')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }),
      );
      await refresh();

      const [request, ...others] = http.match({ method: 'POST', url: THREAD });
      expect(others).toHaveLength(0);
      expect(postButton().disabled).toBe(true);
      const created = mine('Ya cerró');
      request?.flush({ comment: created, comments: summaryOf(3, [created, commentNumber(2)]) });
      await refresh();
    });

    it('posts with Ctrl+Enter or Cmd+Enter, and keeps a plain Enter as a line break', async () => {
      await openWithTwo();
      await write('Ya cerró');
      const draft = inDialog<HTMLTextAreaElement>('comment-draft');

      draft?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await refresh();
      http.expectNone({ method: 'POST', url: THREAD });

      draft?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
      const created = mine('Ya cerró');
      (await awaitRequest(THREAD, 'POST')).flush({
        comment: created,
        comments: summaryOf(3, [created, commentNumber(2)]),
      });
      await refresh();

      expect(threadTexts().at(-1)).toBe('Ya cerró');
    });

    it('closes the thread when the job left the group while writing', async () => {
      await openWithTwo();
      await write('Ya cerró');

      postButton().click();
      (await awaitRequest(THREAD, 'POST')).flush(
        { code: 'link_not_found', message: 'Not found' },
        { status: 404, statusText: 'Not Found' },
      );
      (await awaitRequest(GROUP_PAGE)).flush({ items: [], total: 0 } satisfies LinkPage);
      await refresh();

      await vi.waitFor(() => expect(dialog()).toBeNull());
      expect(document.body.textContent).toContain('Esta oferta ya no está en el grupo');
    });
  });
});
