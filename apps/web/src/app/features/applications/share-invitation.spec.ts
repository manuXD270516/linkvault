import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import type { Application } from '@linkvault/shared';
import { ApplicationsStore } from '../../core/applications/applications.store';
import { ShareInvitation } from './share-invitation';

@Component({
  selector: 'lv-blank-page',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class BlankPage {}

/** Promesa que se resuelve a mano: sostiene una respuesta de la API o una guarda del router. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const privateApplication = {
  id: 'a1',
  linkId: 'l1',
  visibility: 'private',
} as unknown as Application;

describe('ShareInvitation', () => {
  let update: ReturnType<typeof vi.fn>;
  let router: Router;
  let invitation: ShareInvitation;
  let gate: ReturnType<typeof deferred<boolean>>;

  beforeEach(async () => {
    update = vi.fn(async () => ({}));
    gate = deferred<boolean>();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([
          { path: 'grupos/:id', component: BlankPage },
          { path: 'postulaciones', component: BlankPage },
          // Una ruta cuya guarda retiene la navegación hasta que el test la suelta.
          {
            path: 'lenta',
            component: BlankPage,
            canActivate: [() => gate.promise],
          },
        ]),
        { provide: ApplicationsStore, useValue: { update } },
      ],
    });
    router = TestBed.inject(Router);
    invitation = TestBed.inject(ShareInvitation);
    await router.navigateByUrl('/grupos/g1');
  });

  afterEach(async () => {
    gate.resolve(true);
    TestBed.inject(MatSnackBar).dismiss();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  function notice(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>('lv-share-notice');
  }

  function noticeText(): string {
    return notice()?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  async function noticeShown(text: string): Promise<void> {
    await vi.waitFor(() => expect(noticeText()).toContain(text));
  }

  async function noticeGone(): Promise<void> {
    await vi.waitFor(() => expect(notice()).toBeNull());
  }

  function press(testId: string): void {
    notice()
      ?.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
      ?.click();
  }

  function visibilities(): string[] {
    return update.mock.calls.map(
      (call) => (call[1] as { visibility: string }).visibility,
    );
  }

  const INVITE = '¿Que tus grupos vean que postulaste a esta oferta?';

  it('navigating away closes the invite and the application stays private', async () => {
    const offered = invitation.offer(privateApplication, 'applied');
    await noticeShown(INVITE);

    await router.navigateByUrl('/postulaciones');
    await offered;

    await noticeGone();
    expect(update).not.toHaveBeenCalled();
  });

  it('navigating away closes the shared notice and the application stays shared', async () => {
    const offered = invitation.offer(privateApplication, 'applied');
    await noticeShown(INVITE);
    press('share-notice-share');
    await noticeShown('Compartido');

    await router.navigateByUrl('/postulaciones');
    await offered;

    await noticeGone();
    expect(visibilities()).toEqual(['group']);
  });

  it('a query-only change keeps the notice open', async () => {
    const offered = invitation.offer(privateApplication, 'applied');
    await noticeShown(INVITE);
    press('share-notice-share');
    await noticeShown('Compartido');

    await router.navigateByUrl('/grupos/g1?plataforma=linkedin');
    await router.navigateByUrl('/grupos/g1?plataforma=linkedin#lista');

    expect(noticeText()).toContain('Compartido');
    press('share-notice-undo');
    await offered;
    expect(visibilities()).toEqual(['group', 'private']);
  });

  it('navigating during setVisibility does not open the shared notice', async () => {
    const response = deferred<object>();
    update.mockImplementationOnce(() => response.promise);
    const offered = invitation.offer(privateApplication, 'applied');
    await noticeShown(INVITE);
    press('share-notice-share');

    await router.navigateByUrl('/postulaciones');
    response.resolve({});
    await offered;

    expect(notice()).toBeNull();
    expect(visibilities()).toEqual(['group']);
  });

  it('a setVisibility response between NavigationStart and NavigationEnd does not open the shared notice', async () => {
    const response = deferred<object>();
    update.mockImplementationOnce(() => response.promise);
    const offered = invitation.offer(privateApplication, 'applied');
    await noticeShown(INVITE);
    press('share-notice-share');

    // La navegación ya empezó, pero la guarda la retiene: la URL todavía es la del grupo.
    const navigating = router.navigateByUrl('/lenta');
    await vi.waitFor(() => expect(router.currentNavigation()).not.toBeNull());
    expect(router.url).toBe('/grupos/g1');
    response.resolve({});
    await offered;

    expect(notice()).toBeNull();
    gate.resolve(true);
    await navigating;
    expect(router.url).toBe('/lenta');
    expect(notice()).toBeNull();
    expect(visibilities()).toEqual(['group']);
  });
});
