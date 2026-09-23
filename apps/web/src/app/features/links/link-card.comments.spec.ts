import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { CommentsSummary, GroupLinkComment, JobLinkSummary } from '@linkvault/shared';
import { providePageTesting } from '../../../testing/auth-testing';
import { LinkCard } from './link-card.component';

const bare: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  displayUrl: 'https://www.linkedin.com/jobs/view/3912345678/',
  platform: 'linkedin',
  previewStatus: 'pending',
  previewVersion: 1,
  sharedBy: { userId: 'u1', displayName: 'Ana' },
  sharedAt: '2026-09-17T10:00:00.000Z',
};

const note = { text: 'Esta es la que te dije', createdAt: '2026-09-17T10:00:00.000Z' };

function commentWith(
  id: string,
  text: string,
  displayName: string,
  authorLeft = false,
): GroupLinkComment {
  return {
    id,
    author: { userId: `u-${displayName}`, displayName },
    authorLeft,
    text,
    createdAt: '2026-09-19T09:00:00.000Z',
  };
}

function summaryOf(count: number, latest: GroupLinkComment[]): CommentsSummary {
  return { count, revision: count, sharedAt: bare.sharedAt, latest };
}

/** Nota y comentarios en la tarjeta del grupo (spec web/group-comments, "Nota y comentarios en la tarjeta del grupo"). */
describe('LinkCard: nota y comentarios del grupo', () => {
  let fixture: ComponentFixture<LinkCard>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    fixture = TestBed.createComponent(LinkCard);
  });

  async function render(link: JobLinkSummary, inputs: Record<string, unknown> = {}): Promise<void> {
    fixture.componentRef.setInput('link', link);
    fixture.componentRef.setInput('groupView', true);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    await fixture.whenStable();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function all(testId: string): HTMLElement[] {
    return Array.from(host().querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  }

  function one(testId: string): HTMLElement | null {
    return host().querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  }

  function action(): string {
    return one('link-comments-open')?.textContent?.trim() ?? '';
  }

  it('Tarjeta con nota y comentarios', async () => {
    await render({
      ...bare,
      note,
      comments: summaryOf(3, [
        commentWith('c3', 'Ya cerró', 'Carla'),
        commentWith('c2', 'Piden inglés C1', 'Beto'),
      ]),
    });

    expect(one('link-note-author')?.textContent?.trim()).toBe('Nota de Ana');
    expect(one('link-note-text')?.textContent).toBe('Esta es la que te dije');
    expect(all('comment-text').map((element) => element.textContent)).toEqual([
      'Piden inglés C1',
      'Ya cerró',
    ]);
    expect(all('comment-author').map((element) => element.textContent)).toEqual(['Beto', 'Carla']);
    expect(action()).toBe('Ver los 3 comentarios');
  });

  it('Tarjeta sin comentarios', async () => {
    await render(bare);

    expect(one('link-note')).toBeNull();
    expect(one('link-comments')).toBeNull();
    expect(action()).toBe('Comentar');
  });

  it('Tarjeta con pocos comentarios', async () => {
    await render({ ...bare, comments: summaryOf(1, [commentWith('c1', 'Piden inglés C1', 'Beto')]) });

    expect(all('comment-text').map((element) => element.textContent)).toEqual(['Piden inglés C1']);
    expect(action()).toBe('Responder');

    await render({
      ...bare,
      comments: summaryOf(2, [commentWith('c2', 'Ya cerró', 'Carla'), commentWith('c1', 'Hola', 'Beto')]),
    });
    expect(action()).toBe('Responder');
  });

  it('Texto largo cortado en la tarjeta', async () => {
    await render({
      ...bare,
      note: { ...note, text: 'n'.repeat(280) },
      comments: summaryOf(1, [commentWith('c1', 'c'.repeat(400), 'Beto')]),
    });

    for (const element of [one('link-note-text'), one('comment-text')]) {
      expect(element?.classList).toContain('line-clamp-2');
      expect(element?.classList).toContain('whitespace-pre-line');
    }
    // El texto no se recorta: lo corta la vista, y el hilo lo muestra entero.
    expect(one('comment-text')?.textContent).toHaveLength(400);
  });

  it('Autor que se fue', async () => {
    await render({
      ...bare,
      comments: summaryOf(2, [
        commentWith('c2', 'Sigo aquí', 'Carla'),
        commentWith('c1', 'Me voy', 'Beto', true),
      ]),
    });

    const [first, second] = all('link-comment');
    expect(first?.textContent).toContain('Beto');
    expect(first?.querySelector('[data-testid="comment-author-left"]')?.textContent).toBe(
      'ya no está en el grupo',
    );
    expect(second?.querySelector('[data-testid="comment-author-left"]')).toBeNull();
  });

  it('HTML como texto en pantalla', async () => {
    await render({
      ...bare,
      comments: summaryOf(1, [commentWith('c1', '<b>ojo</b> https://ejemplo.test', 'Beto')]),
    });

    const text = one('comment-text');
    expect(text?.textContent).toBe('<b>ojo</b> https://ejemplo.test');
    expect(text?.querySelector('b')).toBeNull();
    expect(text?.querySelector('a')).toBeNull();
  });

  it('keeps the line breaks of a comment', async () => {
    await render({ ...bare, comments: summaryOf(1, [commentWith('c1', 'Piden:\ninglés C1', 'Beto')]) });

    expect(one('comment-text')?.textContent).toBe('Piden:\ninglés C1');
  });

  it('Sin comentarios en la lista privada', async () => {
    await render(
      { ...bare, note, comments: summaryOf(3, [commentWith('c3', 'Ya cerró', 'Carla')]) },
      { groupView: false },
    );

    expect(one('link-group-context')).toBeNull();
    expect(one('link-comments-open')).toBeNull();
    expect(host().textContent).not.toContain('Ya cerró');
    expect(host().textContent).not.toContain('Esta es la que te dije');
  });

  it('Quitar la nota', async () => {
    await render({ ...bare, note }, { canRemoveNote: true });
    let removed = 0;
    fixture.componentInstance.removeNote.subscribe(() => removed++);

    one('link-note-remove')?.click();

    expect(one('link-note-remove')?.textContent?.trim()).toBe('Quitar la nota');
    expect(removed).toBe(1);
  });

  it('offers no way to remove the note without permission, and never to edit it', async () => {
    await render({ ...bare, note });

    expect(one('link-note-text')).not.toBeNull();
    expect(one('link-note-remove')).toBeNull();
    expect(host().querySelector('[data-testid="link-note"] button')).toBeNull();
  });

  it('asks to open the thread', async () => {
    await render(bare);
    let opened = 0;
    fixture.componentInstance.openComments.subscribe(() => opened++);

    one('link-comments-open')?.click();

    expect(opened).toBe(1);
  });

  it('shows know-someone control and badge in group view', async () => {
    await render({
      ...bare,
      knowSomeone: { flaggedByMe: false, count: 2 },
    });
    let flagged: boolean | undefined;
    fixture.componentInstance.toggleKnowSomeone.subscribe((value) => {
      flagged = value;
    });

    expect(one('link-know-someone-toggle')?.textContent?.trim()).toBe('Conozco a alguien ahí');
    expect(one('link-know-someone-count')?.textContent?.replace(/\s+/g, ' ').trim()).toContain(
      '2 personas conocen a alguien ahí',
    );

    one('link-know-someone-toggle')?.click();
    expect(flagged).toBe(true);
  });

  it('shows flagged state without losing the count badge', async () => {
    await render({
      ...bare,
      knowSomeone: { flaggedByMe: true, count: 1 },
    });

    expect(one('link-know-someone-toggle')?.getAttribute('aria-pressed')).toBe('true');
    expect(one('link-know-someone-toggle')?.textContent?.trim()).toBe(
      'Ya marqué que conozco a alguien',
    );
    expect(one('link-know-someone-count')).not.toBeNull();
  });

  it('hides know-someone on the private list', async () => {
    await render(
      { ...bare, knowSomeone: { flaggedByMe: true, count: 3 } },
      { groupView: false },
    );

    expect(one('link-know-someone')).toBeNull();
    expect(one('link-know-someone-toggle')).toBeNull();
  });

  it('shows pin control and tags in group view', async () => {
    await render({
      ...bare,
      pinned: false,
      tags: ['remoto', 'senior'],
    });
    let pinned: boolean | undefined;
    let savedTags: string[] | undefined;
    fixture.componentInstance.togglePinned.subscribe((value) => {
      pinned = value;
    });
    fixture.componentInstance.saveTags.subscribe((value) => {
      savedTags = value;
    });

    expect(one('link-pin-toggle')?.textContent?.trim()).toBe('Fijar');
    expect(one('link-pin-hint')?.textContent?.trim()).toContain('no sube al inicio');
    expect(all('link-tag-chip').map((chip) => chip.textContent?.trim())).toEqual([
      'remoto',
      'senior',
    ]);

    one('link-pin-toggle')?.click();
    expect(pinned).toBe(true);

    one('link-tags-edit')?.click();
    await fixture.whenStable();
    const input = one('link-tags-input') as HTMLInputElement;
    expect(input.value).toBe('remoto, senior');
    input.value = 'remoto, mid';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    one('link-tags-save')?.click();
    expect(savedTags).toEqual(['remoto', 'mid']);
  });

  it('shows pinned state with aria-pressed', async () => {
    await render({ ...bare, pinned: true, tags: [] });

    expect(one('link-pin-toggle')?.getAttribute('aria-pressed')).toBe('true');
    expect(one('link-pin-toggle')?.textContent?.trim()).toBe('Fijado');
  });

  it('hides pin and tags on the private list', async () => {
    await render(
      { ...bare, pinned: true, tags: ['remoto'] },
      { groupView: false },
    );

    expect(one('link-pinned')).toBeNull();
    expect(one('link-pin-toggle')).toBeNull();
    expect(one('link-tags')).toBeNull();
    expect(one('link-tags-edit')).toBeNull();
  });
});
