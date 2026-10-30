import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  providePageTesting,
  sessionWith,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import {
  CAPABILITIES_TIMEOUT_MS,
  CapabilitiesStore,
} from './capabilities.store';

describe('CapabilitiesStore', () => {
  let store: CapabilitiesStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    store = TestBed.inject(CapabilitiesStore);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => {
    vi.useRealTimers();
    verifyNoPendingRequests(http);
  });

  it('issues a single request for concurrent callers', async () => {
    const first = store.ensureLoaded();
    const second = store.ensureLoaded();

    expect(second).toBe(first);
    http.expectOne('/api/capabilities').flush({ search: true, discovery: true });
    await Promise.all([first, second]);
  });

  it('does not request again after ready', async () => {
    const first = store.ensureLoaded();
    http.expectOne('/api/capabilities').flush({ search: true, discovery: true });
    await first;

    await store.ensureLoaded();

    http.expectNone('/api/capabilities');
    expect(store.state()).toBe('ready');
  });

  it('does not request again after failed', async () => {
    const first = store.ensureLoaded();
    http
      .expectOne('/api/capabilities')
      .flush(null, { status: 500, statusText: 'Server Error' });
    await first;

    await store.ensureLoaded();

    http.expectNone('/api/capabilities');
    expect(store.state()).toBe('failed');
  });

  it('hides conditional entries while loading', () => {
    void store.ensureLoaded();

    expect(store.showSearch()).toBe(false);
    expect(store.showDiscovery()).toBe(false);
    http.expectOne('/api/capabilities').flush({ search: true, discovery: true });
  });

  it('follows each flag once ready', async () => {
    const loaded = store.ensureLoaded();
    http
      .expectOne('/api/capabilities')
      .flush({ search: false, discovery: true });
    await loaded;

    expect(store.showSearch()).toBe(false);
    expect(store.showDiscovery()).toBe(true);
    expect(store.searchOff()).toBe(true);
    expect(store.discoveryOff()).toBe(false);
  });

  it('shows them after a 500 (fails open)', async () => {
    const loaded = store.ensureLoaded();
    http
      .expectOne('/api/capabilities')
      .flush(null, { status: 500, statusText: 'Server Error' });
    await loaded;

    expect(store.showSearch()).toBe(true);
    expect(store.showDiscovery()).toBe(true);
  });

  it('shows them after an invalid body', async () => {
    const loaded = store.ensureLoaded();
    http.expectOne('/api/capabilities').flush({ search: 'maybe' });
    await loaded;

    expect(store.state()).toBe('failed');
    expect(store.showSearch()).toBe(true);
    expect(store.showDiscovery()).toBe(true);
  });

  it('off flags are false while loading and after a failure', async () => {
    const loaded = store.ensureLoaded();
    expect(store.searchOff()).toBe(false);
    expect(store.discoveryOff()).toBe(false);

    http
      .expectOne('/api/capabilities')
      .flush(null, { status: 500, statusText: 'Server Error' });
    await loaded;

    expect(store.searchOff()).toBe(false);
    expect(store.discoveryOff()).toBe(false);
  });

  it('state goes from loading to ready or failed', async () => {
    expect(store.state()).toBe('loading');
    const loaded = store.ensureLoaded();
    expect(store.state()).toBe('loading');
    http.expectOne('/api/capabilities').flush({ search: true, discovery: true });
    await loaded;
    expect(store.state()).toBe('ready');
  });

  it('fails open after the timeout', async () => {
    vi.useFakeTimers();
    const loaded = store.ensureLoaded();
    http.expectOne('/api/capabilities');

    vi.advanceTimersByTime(CAPABILITIES_TIMEOUT_MS);
    await loaded;

    expect(store.state()).toBe('failed');
    expect(store.showSearch()).toBe(true);
    expect(store.showDiscovery()).toBe(true);
  });

  it('cancels the request when the timeout expires', async () => {
    vi.useFakeTimers();
    const loaded = store.ensureLoaded();
    const request = http.expectOne('/api/capabilities');
    expect(request.cancelled).toBe(false);

    vi.advanceTimersByTime(5000);
    await loaded;

    expect(request.cancelled).toBe(true);
    expect(store.state()).toBe('failed');
  });
});
