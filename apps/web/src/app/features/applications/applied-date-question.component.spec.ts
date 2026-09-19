import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { buttonWithText, settle, typeInto } from '../../../testing/auth-testing';
import { askAppliedDate } from './applied-date.dialog';
import type { AppliedDateAnswer } from './applied-date-question.component';
import { localDay, localMidnightIso } from './applied-date-question.component';

/** El día 12 más reciente que no es futuro: el de este mes o, si todavía no ha llegado, el del anterior. */
function latestTwelfth(): Date {
  const now = new Date();
  return now.getDate() >= 12
    ? new Date(now.getFullYear(), now.getMonth(), 12)
    : new Date(now.getFullYear(), now.getMonth() - 1, 12);
}

describe('AppliedDateQuestion', () => {
  let answer: Promise<AppliedDateAnswer | null>;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    answer = askAppliedDate(TestBed.inject(MatDialog));
    await settle();
    TestBed.tick();
  });

  afterEach(() => TestBed.inject(MatDialog).closeAll());

  function dialog(): HTMLElement {
    const container = document.body.querySelector<HTMLElement>('mat-dialog-container');
    if (!container) {
      throw new Error('Dialog not opened');
    }
    return container;
  }

  it('Hoy por defecto', async () => {
    const today = buttonWithText(dialog(), 'Hoy');

    expect(dialog().textContent).toContain('¿Cuándo postulaste?');
    // "Hoy" es el botón principal y el que tiene el foco: Enter lo pulsa.
    expect(today.getAttribute('mat-flat-button')).not.toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(today));
    today.click();

    expect(await answer).toEqual({});
  });

  it('Otro día', async () => {
    buttonWithText(dialog(), 'Otro día').click();
    await settle();
    TestBed.tick();
    const day = localDay(latestTwelfth());
    typeInto(dialog(), '[data-testid="applied-day"]', day);
    TestBed.tick();
    buttonWithText(dialog(), 'Usar ese día').click();

    const { appliedAt } = (await answer) ?? {};
    expect(appliedAt).toBe(localMidnightIso(day));
    expect(new Date(appliedAt ?? '').getDate()).toBe(12);
    expect(new Date(appliedAt ?? '').getHours()).toBe(0);
  });

  it('does not accept a future day', async () => {
    buttonWithText(dialog(), 'Otro día').click();
    await settle();
    TestBed.tick();
    const input = dialog().querySelector<HTMLInputElement>('[data-testid="applied-day"]');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    expect(input?.max).toBe(localDay(new Date()));
    typeInto(dialog(), '[data-testid="applied-day"]', localDay(tomorrow));
    TestBed.tick();

    expect(dialog().textContent).toContain('No puede ser un día futuro');
    expect(buttonWithText(dialog(), 'Usar ese día').disabled).toBe(true);
    buttonWithText(dialog(), 'Cancelar').click();
    expect(await answer).toBeNull();
  });
});
