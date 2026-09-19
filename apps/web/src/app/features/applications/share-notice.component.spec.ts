import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar, type MatSnackBarRef } from '@angular/material/snack-bar';
import { SHARE_NOTICE_MIN_MS, ShareNotice, type ShareNoticeData } from './share-notice.component';

describe('ShareNotice', () => {
  let ref: MatSnackBarRef<ShareNotice>;
  let dismiss: ReturnType<typeof vi.spyOn>;
  let dismissWithAction: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  afterEach(() => {
    TestBed.inject(MatSnackBar).dismiss();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  async function show(data: ShareNoticeData): Promise<void> {
    ref = TestBed.inject(MatSnackBar).openFromComponent(ShareNotice, { data, politeness: 'polite' });
    // El componente cierra con su propia referencia, que es esta: se espía en el momento en que decide cerrarse, no
    // cuando termina la animación de salida.
    dismiss = vi.spyOn(ref, 'dismiss');
    dismissWithAction = vi.spyOn(ref, 'dismissWithAction');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
  }

  function notice(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>('lv-share-notice');
  }

  function button(testId: string): HTMLButtonElement {
    const element = notice()?.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    if (!element) {
      throw new Error(`Button "${testId}" not rendered`);
    }
    return element;
  }

  it('is announced politely to screen readers', async () => {
    await show({ kind: 'invite', gesture: 'interested' });

    const live = document.body.querySelector('[aria-live]');
    expect(live?.getAttribute('aria-live')).toBe('polite');
  });

  it('El aviso espera', async () => {
    await show({ kind: 'invite', gesture: 'interested' });

    button('share-notice-share').focus();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(notice()).not.toBeNull();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('does not close before 10 seconds and closes after them without the focus', async () => {
    await show({ kind: 'invite', gesture: 'applied' });

    await vi.advanceTimersByTimeAsync(SHARE_NOTICE_MIN_MS - 1);
    expect(dismiss).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(dismissWithAction).not.toHaveBeenCalled();
  });

  it('closes when the focus leaves once the minimum has passed', async () => {
    await show({ kind: 'shared' });

    const undo = button('share-notice-undo');
    undo.focus();
    await vi.advanceTimersByTimeAsync(SHARE_NOTICE_MIN_MS + 5_000);
    expect(dismiss).not.toHaveBeenCalled();

    undo.blur();
    await vi.advanceTimersByTimeAsync(0);

    expect(dismiss).toHaveBeenCalled();
  });

  it('closes with its action', async () => {
    await show({ kind: 'shared' });

    button('share-notice-undo').click();

    expect(dismissWithAction).toHaveBeenCalledTimes(1);
  });
});
