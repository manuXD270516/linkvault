import type { CdkDragDrop } from '@angular/cdk/drag-drop';
import { CdkDropList } from '@angular/cdk/drag-drop';
import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { Application } from '@linkvault/shared';
import { applicationWith } from '../../../testing/applications-testing';
import {
  apiError,
  buttonWithText,
  providePageTesting,
  sessionWith,
  settle,
  typeInto,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import type { BoardColumnId } from './application-status.labels';
import { localDay, localMidnightIso } from './applied-date-question.component';
import { ApplicationsBoardPage } from './applications-board.page';

const BOARD_URL = '/api/applications';

function daysAgoIso(days: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days).toISOString();
}

describe('ApplicationsBoardPage', () => {
  let fixture: ComponentFixture<ApplicationsBoardPage>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => verifyNoPendingRequests(http));

  async function open(items: Application[]): Promise<void> {
    fixture = TestBed.createComponent(ApplicationsBoardPage);
    http.expectOne(BOARD_URL).flush({ items });
    await settle();
    await fixture.whenStable();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(element: Element | null = host()): string {
    return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function column(id: BoardColumnId): HTMLElement {
    const element = host().querySelector<HTMLElement>(`[data-column="${id}"]`);
    if (!element) {
      throw new Error(`Column "${id}" not rendered`);
    }
    return element;
  }

  function columnTitles(): string[] {
    return Array.from(host().querySelectorAll('[data-column] h2')).map((title) =>
      text(title).replace(/\s*\(\d+\)$/, ''),
    );
  }

  function dialog(): HTMLElement {
    const container = document.body.querySelector<HTMLElement>('mat-dialog-container');
    if (!container) {
      throw new Error('Dialog not opened');
    }
    return container;
  }

  function dialogCount(): number {
    return document.body.querySelectorAll('mat-dialog-container').length;
  }

  /** Cancela el diálogo abierto y espera a que se cierre del todo: el resultado llega tras su animación de cierre. */
  async function cancel(): Promise<void> {
    buttonWithText(dialog(), 'Cancelar').click();
    await vi.waitFor(() => expect(dialogCount()).toBe(0));
    await refresh();
  }

  async function refresh(): Promise<void> {
    await settle();
    await fixture.whenStable();
  }

  /** Suelta la tarjeta en otra columna como lo haría `cdk/drag-drop` al terminar un arrastre. */
  async function drop(application: Application, from: BoardColumnId, to: BoardColumnId): Promise<void> {
    const lists = fixture.debugElement
      .queryAll(By.directive(CdkDropList))
      .map((element) => element.injector.get(CdkDropList<BoardColumnId>));
    const source = lists.find((list) => list.data === from);
    const target = lists.find((list) => list.data === to);
    if (!source || !target) {
      throw new Error(`Columns "${from}" or "${to}" not rendered`);
    }
    const event = {
      previousContainer: source,
      container: target,
      item: { data: application },
      previousIndex: 0,
      currentIndex: 0,
      isPointerOverContainer: true,
    } as unknown as CdkDragDrop<BoardColumnId, BoardColumnId, Application>;
    target.dropped.emit(event);
    await refresh();
  }

  async function moveWithMenu(title: string, status: string): Promise<void> {
    const card = Array.from(host().querySelectorAll('[data-testid="application-card"]')).find((element) =>
      element.textContent?.includes(title),
    );
    card?.querySelector<HTMLButtonElement>('[data-testid="application-move"]')?.click();
    await refresh();
    const item = document.body.querySelector<HTMLButtonElement>(`.mat-mdc-menu-panel [data-status="${status}"]`);
    if (!item) {
      throw new Error(`Menu item "${status}" not found`);
    }
    item.click();
    await refresh();
  }

  async function statusRequest(id = 'a-l1'): Promise<TestRequest> {
    return await vi.waitFor(() =>
      http.expectOne({ method: 'PATCH', url: `/api/applications/${id}/status` }),
    );
  }

  describe('columns', () => {
    it('Tablero vacío', async () => {
      await open([]);

      expect(text()).toContain(
        'Aquí verás las ofertas que sigues. Pulsa «Me interesa» o «Postulé» en cualquier oferta de tus grupos o de tu lista.',
      );
      expect(host().querySelector('a[href="/grupos"]')).not.toBeNull();
      expect(host().querySelector('a[href="/mis-links"]')).not.toBeNull();
      expect(host().querySelector('[data-testid="board"]')).toBeNull();
    });

    it('Una tarjeta por postulación, en su columna', async () => {
      await open([
        applicationWith({ linkId: 'l1', status: 'interested' }),
        applicationWith({ linkId: 'l2', status: 'in_process', stageLabel: 'Prueba técnica', appliedAt: daysAgoIso(2) }),
        applicationWith({ linkId: 'l3', status: 'offer', appliedAt: daysAgoIso(9) }),
        applicationWith({ linkId: 'l4', status: 'rejected' }),
        applicationWith({ linkId: 'l5', status: 'saved' }),
      ]);

      expect(columnTitles()).toEqual([
        'Interés',
        'Postuladas',
        'En proceso',
        'Con oferta',
        'Aceptadas',
        'Cerradas',
      ]);
      expect(text(column('interest'))).toContain('Oferta l1');
      expect(text(column('interest'))).toContain('Oferta l5');
      expect(text(column('in_process'))).toContain('Oferta l2');
      expect(text(column('in_process'))).toContain('Prueba técnica');
      expect(text(column('offer'))).toContain('Oferta l3');
      expect(text(column('closed'))).toContain('Oferta l4');
      expect(column('closed').querySelector('[data-testid="application-closed"]')?.textContent).toContain(
        'Rechazada',
      );
      expect(text(column('applied'))).not.toContain('Oferta');
      expect(text()).not.toContain('Guardadas');
    });

    it('Fecha de postulación legible', async () => {
      await open([
        applicationWith({ linkId: 'l1', status: 'applied', appliedAt: daysAgoIso(0) }),
        applicationWith({ linkId: 'l2', status: 'applied', appliedAt: daysAgoIso(1) }),
        applicationWith({ linkId: 'l3', status: 'applied', appliedAt: daysAgoIso(6) }),
      ]);

      expect(text(column('applied'))).toContain('Postulaste hoy');
      expect(text(column('applied'))).toContain('Postulaste ayer');
      expect(text(column('applied'))).toContain('Postulaste hace 6 días');
    });

    it('shows the load failure', async () => {
      fixture = TestBed.createComponent(ApplicationsBoardPage);
      http.expectOne(BOARD_URL).flush(null, { status: 500, statusText: 'Error' });
      await refresh();

      expect(text()).toContain('Algo salió mal. Inténtalo de nuevo');
      expect(host().querySelector('[data-testid="board-empty"]')).toBeNull();
    });
  });

  describe('dragging', () => {
    it('Arrastrar a «Postuladas»', async () => {
      const interested = applicationWith({ status: 'interested' });
      await open([interested]);

      await drop(interested, 'interest', 'applied');
      expect(text(dialog())).toContain('¿Cuándo postulaste?');
      buttonWithText(dialog(), 'Hoy').click();

      const request = await statusRequest();
      expect(request.request.body).toEqual({ status: 'applied', version: 1 });
      // Hasta que la API confirma, la tarjeta sigue donde estaba.
      expect(text(column('interest'))).toContain('Oferta l1');
      request.flush(applicationWith({ status: 'applied', appliedAt: new Date().toISOString(), version: 2 }));
      await refresh();

      expect(text(column('applied'))).toContain('Oferta l1');
      expect(text(column('applied'))).toContain('Postulaste hoy');
      expect(text(column('interest'))).not.toContain('Oferta l1');
    });

    it('Con fecha previa no se pregunta', async () => {
      const applied = applicationWith({ status: 'applied', appliedAt: daysAgoIso(4) });
      await open([applied]);

      await drop(applied, 'applied', 'offer');

      expect(dialogCount()).toBe(0);
      const request = await statusRequest();
      expect(request.request.body).toEqual({ status: 'offer', version: 1 });
      request.flush({ ...applied, status: 'offer', version: 2 });
      await refresh();

      expect(text(column('offer'))).toContain('Oferta l1');
    });

    it('asks the date when jumping to "Aceptadas" without one', async () => {
      const interested = applicationWith({ status: 'interested' });
      await open([interested]);

      await drop(interested, 'interest', 'accepted');

      expect(text(dialog())).toContain('¿Cuándo postulaste?');
      await cancel();

      http.expectNone((request) => request.method === 'PATCH');
    });

    it('does nothing when dropped in its own column', async () => {
      const interested = applicationWith({ status: 'saved' });
      await open([interested]);

      await drop(interested, 'interest', 'interest');

      expect(dialogCount()).toBe(0);
      http.expectNone((request) => request.method === 'PATCH');
    });
  });

  describe('menu and dialogs', () => {
    it('Mover sin ratón a «En proceso»', async () => {
      await open([applicationWith({ status: 'applied', appliedAt: daysAgoIso(3) })]);

      await moveWithMenu('Oferta l1', 'in_process');
      expect(dialog().querySelector('[data-testid="applied-date-question"]')).toBeNull();
      typeInto(dialog(), '[data-testid="stage-input"]', 'Entrevista');
      buttonWithText(dialog(), 'Guardar').click();

      const request = await statusRequest();
      expect(request.request.body).toEqual({ status: 'in_process', stageLabel: 'Entrevista', version: 1 });
      request.flush(
        applicationWith({ status: 'in_process', stageLabel: 'Entrevista', appliedAt: daysAgoIso(3), version: 2 }),
      );
      await refresh();

      expect(text(column('in_process'))).toContain('Entrevista');
    });

    it('never offers "Guardada" in "Mover a…"', async () => {
      await open([applicationWith({ status: 'interested' })]);

      host().querySelector<HTMLButtonElement>('[data-testid="application-move"]')?.click();
      await refresh();
      const items = Array.from(document.body.querySelectorAll('.mat-mdc-menu-panel [data-status]')).map(
        (item) => item.getAttribute('data-status'),
      );

      expect(items).toEqual(['applied', 'in_process', 'offer', 'accepted', 'rejected', 'withdrawn', 'expired']);
      expect(document.body.querySelector('.mat-mdc-menu-panel')?.textContent).not.toContain('Guardada');
    });

    it('De «Interés» a «En proceso» en un solo diálogo', async () => {
      const interested = applicationWith({ status: 'interested' });
      await open([interested]);

      await drop(interested, 'interest', 'in_process');

      expect(dialogCount()).toBe(1);
      expect(dialog().querySelector('[data-testid="stage-input"]')).not.toBeNull();
      expect(text(dialog())).toContain('¿Cuándo postulaste?');
      typeInto(dialog(), '[data-testid="stage-input"]', 'Llamada con RR. HH.');
      buttonWithText(dialog(), 'Hoy').click();

      const request = await statusRequest();
      expect(request.request.body).toEqual({
        status: 'in_process',
        stageLabel: 'Llamada con RR. HH.',
        version: 1,
      });
      request.flush(applicationWith({ status: 'in_process', stageLabel: 'Llamada con RR. HH.', version: 2 }));
      await refresh();
    });

    it('sends no stage when it is left empty', async () => {
      const applied = applicationWith({ status: 'applied', appliedAt: daysAgoIso(1) });
      await open([applied]);

      await drop(applied, 'applied', 'in_process');
      buttonWithText(dialog(), 'Guardar').click();

      const request = await statusRequest();
      expect(request.request.body).toEqual({ status: 'in_process', stageLabel: null, version: 1 });
      request.flush({ ...applied, status: 'in_process', version: 2 });
      await refresh();
    });

    it('Cerrar como rechazada', async () => {
      const inProcess = applicationWith({ status: 'in_process', appliedAt: daysAgoIso(5) });
      await open([inProcess]);

      await drop(inProcess, 'in_process', 'closed');
      expect(text(dialog())).toContain('Rechazada');
      expect(text(dialog())).toContain('Retirada');
      expect(text(dialog())).toContain('Expirada');
      dialog().querySelector<HTMLButtonElement>('[data-status="rejected"]')?.click();

      const request = await statusRequest();
      expect(request.request.body).toEqual({ status: 'rejected', version: 1 });
      request.flush({ ...inProcess, status: 'rejected', version: 2 });
      await refresh();

      expect(text(column('closed'))).toContain('Oferta l1');
      expect(text(column('closed'))).toContain('Rechazada');
    });

    it('Postuladas hace días', async () => {
      await open([applicationWith({ status: 'interested' })]);

      await moveWithMenu('Oferta l1', 'applied');
      buttonWithText(dialog(), 'Otro día').click();
      await refresh();
      const day = localDay(new Date(daysAgoIso(3)));
      typeInto(dialog(), '[data-testid="applied-day"]', day);
      await refresh();
      buttonWithText(dialog(), 'Usar ese día').click();

      const request = await statusRequest();
      expect(request.request.body).toEqual({
        status: 'applied',
        appliedAt: localMidnightIso(day),
        version: 1,
      });
      request.flush(applicationWith({ status: 'applied', appliedAt: localMidnightIso(day), version: 2 }));
      await refresh();

      expect(text(column('applied'))).toContain('Postulaste hace 3 días');
    });
  });

  describe('undo and conflict', () => {
    it('El cambio falla', async () => {
      const interested = applicationWith({ status: 'interested' });
      await open([interested]);

      await drop(interested, 'interest', 'applied');
      buttonWithText(dialog(), 'Hoy').click();
      (await statusRequest()).flush(null, { status: 500, statusText: 'Error' });
      await refresh();

      expect(text(column('interest'))).toContain('Oferta l1');
      expect(text(column('applied'))).not.toContain('Oferta l1');
      expect(text()).toContain('Algo salió mal. Inténtalo de nuevo');
    });

    it('goes back without a request when a dialog is cancelled', async () => {
      const interested = applicationWith({ status: 'interested' });
      await open([interested]);

      await drop(interested, 'interest', 'in_process');
      await cancel();
      await drop(interested, 'interest', 'closed');
      await cancel();

      http.expectNone((request) => request.method === 'PATCH');
      expect(text(column('interest'))).toContain('Oferta l1');
    });

    it('Cambió en otra pestaña', async () => {
      const applied = applicationWith({ status: 'applied', appliedAt: daysAgoIso(2) });
      await open([applied]);

      await drop(applied, 'applied', 'offer');
      const { body, options } = apiError('application_conflict', 409);
      (await statusRequest()).flush(body, options);
      const reload = await vi.waitFor(() => http.expectOne(BOARD_URL));
      reload.flush({ items: [{ ...applied, status: 'in_process', stageLabel: 'Entrevista', version: 2 }] });
      await refresh();

      expect(text()).toContain(
        'Esta postulación cambió en otra pestaña. La hemos actualizado; muévela de nuevo si hace falta.',
      );
      expect(text(column('in_process'))).toContain('Oferta l1');
      expect(text(column('offer'))).not.toContain('Oferta l1');
    });

    it('Postulación que ya no existe', async () => {
      const applied = applicationWith({ status: 'applied', appliedAt: daysAgoIso(2) });
      await open([applied]);

      await drop(applied, 'applied', 'offer');
      const { body, options } = apiError('application_not_found', 404);
      (await statusRequest()).flush(body, options);
      await refresh();

      expect(text()).not.toContain('Oferta l1');
      expect(host().querySelector('[role="alert"]')).toBeNull();
    });
  });
});
