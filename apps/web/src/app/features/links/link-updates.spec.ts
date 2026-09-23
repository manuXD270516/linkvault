import { HttpEventType } from '@angular/common/http';
import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { JobLinkSummary, LinkPage } from '@linkvault/shared';
import {
  flushPendingApplicationStates,
  providePageTesting,
  sessionWith,
  settle,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { EventsChannel } from '../../core/events/events.channel';
import { LinksStore } from '../../core/links/links.store';
import { LinkList, type LinkListScope } from './link-list.component';

const GROUP_PAGE = '/api/groups/g1/links?limit=20';

/** Una oferta recién importada: se pidió su lectura y todavía no ha llegado nada. */
function waiting(id: string): JobLinkSummary {
  return {
    id,
    normalizedUrl: `https://ejemplo.test/ofertas/${id}`,
    displayUrl: `https://ejemplo.test/ofertas/${id}`,
    platform: 'generic',
    previewStatus: 'pending',
    previewVersion: 1,
    previewRequestedAt: '2026-09-18T10:00:00.000Z',
    sharedBy: { userId: 'u2', displayName: 'Beto' },
    sharedAt: '2026-09-18T10:00:00.000Z',
  };
}

/** La misma oferta ya leída, tal y como viaja dentro del aviso del canal. */
function enriched(id: string, title: string): JobLinkSummary {
  return {
    ...waiting(id),
    previewStatus: 'enriched',
    previewVersion: 2,
    preview: { title, company: 'Acme' },
  };
}

@Component({
  selector: 'lv-link-updates-host',
  imports: [LinkList],
  template: `<lv-link-list [links]="items()" [scope]="scope()" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class UpdatesHost {
  readonly items = inject(LinksStore).items;
  readonly scope = signal<LinkListScope>('group');
}

describe('La tarjeta se actualiza sola', () => {
  let fixture: ComponentFixture<UpdatesHost>;
  let http: HttpTestingController;
  let store: LinksStore;
  let channel: EventsChannel;
  let events: TestRequest;
  let stream = '';

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    store = TestBed.inject(LinksStore);
    channel = TestBed.inject(EventsChannel);
    stream = '';
    // Reloj fijo: "Sin vista previa todavía" depende de cuánto hace que se pidió la lectura, no de la fecha real.
    vi.setSystemTime(new Date('2026-09-18T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    channel.disconnect();
    flushPendingApplicationStates(http);
    http.verify({ ignoreCancelled: true });
  });

  /** Abre la lista del grupo con esos links y el canal de eventos, como hacen las pantallas de links. */
  async function open(links: JobLinkSummary[], total = links.length): Promise<void> {
    channel.connect();
    events = http.expectOne({ method: 'GET', url: '/api/events' });
    const opening = store.open({ kind: 'group', groupId: 'g1' });
    http.expectOne(GROUP_PAGE).flush({ items: links, total } satisfies LinkPage);
    await opening;
    fixture = TestBed.createComponent(UpdatesHost);
    await fixture.whenStable();
  }

  /** Manda un aviso por el canal, como lo escribe la API: el link ya actualizado dentro del evento. */
  async function notify(link: JobLinkSummary): Promise<void> {
    stream += `event: link.enriched\ndata: ${JSON.stringify({ link })}\n\n`;
    events.event({ type: HttpEventType.DownloadProgress, loaded: stream.length, partialText: stream });
    await settle();
    await fixture.whenStable();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('Preview que llega mientras miras', async () => {
    await open([waiting('l1')]);
    expect(text()).toContain('Sin vista previa todavía');

    await notify(enriched('l1', 'Ingeniera de datos'));

    // Sin recargar: la lista no se vuelve a pedir y la tarjeta ya dice lo que trae el aviso.
    http.expectNone(GROUP_PAGE);
    expect(text()).toContain('Ingeniera de datos');
    expect(text()).toContain('Acme');
    expect(text()).not.toContain('Sin vista previa todavía');
  });

  /** Cierre en vivo (ADR-037): el mismo canal `link.enriched` trae `closedAt` y la tarjeta pinta el badge sin reload. */
  it('Badge de oferta cerrada al aviso SSE', async () => {
    await open([enriched('l1', 'Ingeniera de datos')]);
    expect(text()).not.toContain('Oferta cerrada');

    await notify({
      ...enriched('l1', 'Ingeniera de datos'),
      closedAt: '2026-09-22T12:00:00.000Z',
      closedReason: 'calendar',
    });

    http.expectNone(GROUP_PAGE);
    expect(store.items()[0]?.closedAt).toBe('2026-09-22T12:00:00.000Z');
    expect(store.items()[0]?.closedReason).toBe('calendar');
    expect(text()).toContain('Oferta cerrada');
    expect(text()).toContain('Ingeniera de datos');
    expect(text()).toContain('Acme');
  });

  /** Reopen en vivo (ADR-041): el aviso omite `closedAt` y el badge desaparece sin refetch. */
  it('Badge desaparece al aviso SSE tras reopen', async () => {
    await open([
      {
        ...enriched('l1', 'Ingeniera de datos'),
        closedAt: '2026-09-22T12:00:00.000Z',
        closedReason: 'recheck',
      },
    ]);
    expect(text()).toContain('Oferta cerrada');

    await notify(enriched('l1', 'Ingeniera de datos'));

    http.expectNone(GROUP_PAGE);
    expect(store.items()[0]?.closedAt).toBeUndefined();
    expect(text()).not.toContain('Oferta cerrada');
    expect(text()).toContain('Ingeniera de datos');
  });

  it('Progreso de una importación', async () => {
    // Diez ofertas importadas; la página trae las diez primeras del listado, que son diez.
    await open(
      Array.from({ length: 10 }, (_, index) => waiting(`l${index + 1}`)),
      10,
    );
    expect(text()).toContain('Leyendo ofertas: 0 de 10 listas');

    await notify(enriched('l1', 'Primera'));
    await notify(enriched('l2', 'Segunda'));
    await notify(enriched('l3', 'Tercera'));

    expect(text()).toContain('Leyendo ofertas: 3 de 10 listas');
  });

  /** El contador cuenta el listado entero, no los links de la página: veinte caben en una, cincuenta no. */
  it('counts the whole listing, not the loaded page', async () => {
    await open([waiting('l1'), waiting('l2')], 50);

    expect(text()).toContain('Leyendo ofertas: 0 de 50 listas');
  });

  it('stops counting once nothing is left to read', async () => {
    await open([waiting('l1')]);
    expect(text()).toContain('Leyendo ofertas: 0 de 1 lista');

    await notify(enriched('l1', 'Ingeniera de datos'));

    expect(text()).not.toContain('Leyendo ofertas');
  });

  /** Un aviso de un link que no está en la lista abierta (otro grupo) no pinta nada ni cuenta. */
  it('ignores a notice about a link that is not on screen', async () => {
    await open([waiting('l1')]);

    await notify(enriched('otro', 'De otro grupo'));

    expect(text()).not.toContain('De otro grupo');
    expect(text()).toContain('Leyendo ofertas: 0 de 1 lista');
  });

  it('vuelve a pedir la lista al recuperar el foco de la pestaña', async () => {
    await open([waiting('l1')]);

    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    http.expectOne(GROUP_PAGE).flush({
      items: [enriched('l1', 'Ingeniera de datos')],
      total: 1,
    } satisfies LinkPage);
    await settle();
    await fixture.whenStable();

    // La recarga sustituye lo cargado, no lo añade: el link sigue siendo uno.
    expect(fixture.nativeElement.querySelectorAll('li')).toHaveLength(1);
    expect(text()).toContain('Ingeniera de datos');
  });
});
