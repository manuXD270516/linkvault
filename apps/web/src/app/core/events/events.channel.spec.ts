import { HttpEventType } from '@angular/common/http';
import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  AnalysisStepMessage,
  GroupLinkCommentsMessage,
  JobLinkSummary,
  LinkEnrichedMessage,
} from '@linkvault/shared';
import { providePageTesting, sessionWith, settle } from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { EVENTS_FIRST_RETRY_DELAY_MS, EventsChannel } from './events.channel';

const link: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://ejemplo.test/ofertas/1',
  displayUrl: 'https://ejemplo.test/ofertas/ingeniera-de-datos',
  platform: 'generic',
  previewStatus: 'enriched',
  previewVersion: 2,
  preview: { title: 'Ingeniera de datos', company: 'Acme' },
  sharedAt: '2026-09-18T10:00:00.000Z',
};

const commentsMessage: GroupLinkCommentsMessage = {
  groupId: 'g1',
  linkId: 'l1',
  change: 'created',
  commentId: 'c3',
  comments: {
    count: 3,
    revision: 3,
    sharedAt: '2026-09-18T10:00:00.000Z',
    latest: [
      {
        id: 'c3',
        author: { userId: 'u2', displayName: 'Beto' },
        authorLeft: false,
        text: 'Ya cerró',
        createdAt: '2026-09-19T10:00:00.000Z',
      },
    ],
  },
};

/** Un evento del canal tal y como lo escribe la API: nombre, cuerpo y la línea en blanco que lo cierra. */
function sse(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe('EventsChannel', () => {
  let http: HttpTestingController;
  let channel: EventsChannel;
  let received: LinkEnrichedMessage[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      // La espera de la reconexión se acorta: lo que se comprueba es que vuelva a intentarlo y que la espera crezca,
      // no que el reloj funcione.
      providers: [...providePageTesting(), { provide: EVENTS_FIRST_RETRY_DELAY_MS, useValue: 5 }],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    channel = TestBed.inject(EventsChannel);
    received = [];
    channel.linkEnriched.subscribe((message) => received.push(message));
  });

  afterEach(() => {
    channel.disconnect();
    // El canal es una petición que no termina nunca: al apagarlo queda cancelada, no pendiente.
    http.verify({ ignoreCancelled: true });
  });

  function openChannel(): TestRequest {
    channel.connect();
    return http.expectOne({ method: 'GET', url: '/api/events' });
  }

  /** Entrega un trozo del cuerpo como lo hace el navegador: `partialText` es todo lo recibido hasta ese momento. */
  function push(request: TestRequest, body: string): void {
    request.event({
      type: HttpEventType.DownloadProgress,
      loaded: body.length,
      partialText: body,
    });
  }

  it('Preview que llega mientras miras', async () => {
    const request = openChannel();
    push(request, sse('link.enriched', { link }));
    await settle();

    expect(received).toEqual([{ link }]);
    expect(channel.connected()).toBe(true);
  });

  /** El token va en la cabecera, nunca en la URL: es lo que `EventSource` no sabe hacer y por lo que no se usa. */
  it('sends the session token in the header', () => {
    const request = openChannel();

    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    expect(request.request.urlWithParams).toBe('/api/events');
  });

  it('discards the heartbeat and anything it does not understand', async () => {
    const request = openChannel();
    push(request, ':\n\n:latido\n\n');
    push(request, ':\n\n:latido\n\nevent: otra.cosa\ndata: {}\n\n');
    push(request, ':\n\n:latido\n\nevent: otra.cosa\ndata: {}\n\nevent: link.enriched\ndata: no-es-json\n\n');
    await settle();

    expect(received).toEqual([]);
    expect(channel.connected()).toBe(true);
  });

  /** El cuerpo llega a trozos: un evento partido por la mitad no se reparte hasta que termina. */
  it('waits for a block to be complete before dispatching it', async () => {
    const request = openChannel();
    const complete = sse('link.enriched', { link });
    push(request, complete.slice(0, 20));
    await settle();
    expect(received).toEqual([]);

    push(request, complete);
    await settle();
    expect(received).toEqual([{ link }]);

    // Y lo ya repartido no se repite cuando llega el evento siguiente.
    push(request, `${complete}${sse('link.enriched', { link })}`);
    await settle();
    expect(received).toHaveLength(2);
  });

  it('Sin canal disponible', async () => {
    const request = openChannel();
    request.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await settle();

    // Ni excepción ni nada que mostrar: la lista sigue con lo que devolvió la API.
    expect(received).toEqual([]);
    expect(channel.connected()).toBe(false);

    // Y se vuelve a intentar sola, esperando cada vez un poco más.
    expect(channel.nextRetryDelayMs()).toBe(10);
    const retry = await vi.waitFor(() => http.expectOne({ method: 'GET', url: '/api/events' }));
    retry.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await settle();

    expect(channel.nextRetryDelayMs()).toBe(20);
  });

  /** Recibir datos da el canal por bueno: la espera vuelve al principio para que la caída siguiente no tarde minutos. */
  it('starts the wait over once the channel works again', async () => {
    const request = openChannel();
    request.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await settle();
    expect(channel.nextRetryDelayMs()).toBe(10);

    const retry = await vi.waitFor(() => http.expectOne({ method: 'GET', url: '/api/events' }));
    push(retry, ':latido\n\n');
    await settle();

    expect(channel.nextRetryDelayMs()).toBe(5);
  });

  it('reopens the channel when the server closes the stream', async () => {
    const request = openChannel();
    request.flush('', { status: 200, statusText: 'OK' });
    await settle();

    await vi.waitFor(() => http.expectOne({ method: 'GET', url: '/api/events' }));
  });

  it('does not open a second connection', () => {
    openChannel();
    channel.connect();

    http.expectNone({ method: 'GET', url: '/api/events' });
  });

  /** Al apagarlo, la petición se cancela de verdad: el navegador deja de tener un canal abierto contra la API. */
  it('stops listening when it is shut down', async () => {
    const request = openChannel();
    push(request, sse('link.enriched', { link }));
    await settle();
    expect(received).toHaveLength(1);

    channel.disconnect();
    await settle();

    expect(request.cancelled).toBe(true);
    expect(channel.connected()).toBe(false);
    expect(received).toHaveLength(1);
  });

  describe('group-link.comments', () => {
    let comments: GroupLinkCommentsMessage[];

    beforeEach(() => {
      comments = [];
      channel.groupLinkComments.subscribe((message) => comments.push(message));
    });

    it('dispatches a valid comments notice apart from the link notices', async () => {
      const request = openChannel();
      push(request, sse('group-link.comments', commentsMessage));
      await settle();

      expect(comments).toEqual([commentsMessage]);
      expect(received).toEqual([]);
    });

    it('discards a malformed comments notice', async () => {
      const request = openChannel();
      const { comments: summary } = commentsMessage;
      const { latest } = summary;
      const malformed: unknown[] = [
        { ...commentsMessage, change: 'edited' },
        { ...commentsMessage, groupId: '' },
        { ...commentsMessage, comments: { ...summary, revision: -1 } },
        { ...commentsMessage, comments: { ...summary, sharedAt: undefined } },
        { ...commentsMessage, comments: { ...summary, latest: [...latest, ...latest, ...latest] } },
        { ...commentsMessage, comments: { ...summary, latest: [{ id: 'c3', text: 'sin autor' }] } },
      ];
      push(
        request,
        'event: group-link.comments\ndata: no-es-json\n\n' +
          malformed.map((data) => sse('group-link.comments', data)).join(''),
      );
      await settle();

      expect(comments).toEqual([]);
    });

    it('does not take a notice with another name for a comments notice', async () => {
      const request = openChannel();
      push(request, sse('group-link.comments.v2', commentsMessage) + sse('link.enriched', commentsMessage));
      await settle();

      expect(comments).toEqual([]);
      expect(received).toEqual([]);
    });
  });

  describe('analysis.step', () => {
    let steps: AnalysisStepMessage[];

    const stepMessage: AnalysisStepMessage = {
      analysisId: 'a1',
      linkId: 'l1',
      step: 'critiquing-suggestions',
    };

    beforeEach(() => {
      steps = [];
      channel.analysisStep.subscribe((message) => steps.push(message));
    });

    it('dispatches a valid analysis step notice', async () => {
      const request = openChannel();
      push(request, sse('analysis.step', stepMessage));
      await settle();

      expect(steps).toEqual([stepMessage]);
      expect(received).toEqual([]);
    });

    it('discards a malformed or oversized analysis step notice', async () => {
      const request = openChannel();
      const malformed: unknown[] = [
        { ...stepMessage, step: 'not-a-step' },
        { ...stepMessage, analysisId: '' },
        { ...stepMessage, score: 0.9 },
        { analysisId: 'a1', linkId: 'l1' },
      ];
      push(
        request,
        'event: analysis.step\ndata: no-es-json\n\n' +
          malformed.map((data) => sse('analysis.step', data)).join(''),
      );
      await settle();

      expect(steps).toEqual([]);
    });
  });
});
