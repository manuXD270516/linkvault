import { LOCALE_ID } from '@angular/core';
import { HttpTestingController } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { type GroupWeeklyBriefResponse, groupWeeklyBriefResponseSchema } from '@linkvault/shared';
import {
  apiError,
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { EMPTY_GROUP_BRIEF, briefOfferWith, groupBriefResponse } from '../../../testing/group-brief-testing';
import { SessionStore } from '../../core/auth/session.store';
import { GroupWeeklyBriefCard } from './group-weekly-brief-card.component';

const URL = '/api/groups/g1/weekly-brief';

describe('GroupWeeklyBriefCard', () => {
  let fixture: ComponentFixture<GroupWeeklyBriefCard>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...providePageTesting(), { provide: LOCALE_ID, useValue: 'es' }] });
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => verifyNoPendingRequests(http));

  async function render(response: GroupWeeklyBriefResponse): Promise<HTMLElement> {
    fixture = TestBed.createComponent(GroupWeeklyBriefCard);
    fixture.componentRef.setInput('groupId', 'g1');
    await fixture.whenStable();
    http.expectOne(URL).flush(response);
    await settle();
    await fixture.whenStable();
    return host();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function byId(testId: string): HTMLElement[] {
    return Array.from(host().querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  }

  function text(testId: string): string | null {
    return byId(testId)[0]?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  }

  async function click(element: HTMLElement | undefined): Promise<void> {
    if (element === undefined) {
      throw new Error('Element not found');
    }
    element.click();
    await settle();
    await fixture.whenStable();
  }

  /** Respuesta con una sola viñeta de habilidad y las ofertas dadas. */
  function withSkillBullet(
    overrides: Partial<NonNullable<GroupWeeklyBriefResponse['brief']>['bullets'][number]>,
  ): GroupWeeklyBriefResponse {
    return {
      weekKey: '2026-W48',
      brief: {
        asOf: '2026-11-23',
        openOffers: 7,
        bullets: [
          {
            factId: 'skill_demand:docker',
            fact: { kind: 'skill_demand', skillLabel: 'Docker', count: 4, total: 7 },
            offers: [],
            moreCount: 0,
            missingCount: 0,
            ...overrides,
          },
        ],
      },
    };
  }

  it('fixture satisfies the response contract', () => {
    expect(() => groupWeeklyBriefResponseSchema.parse(groupBriefResponse())).not.toThrow();
    expect(() => groupWeeklyBriefResponseSchema.parse(EMPTY_GROUP_BRIEF)).not.toThrow();
    expect(() =>
      groupWeeklyBriefResponseSchema.parse(
        withSkillBullet({ offers: [briefOfferWith(1), briefOfferWith(2)], moreCount: 3, missingCount: 1 }),
      ),
    ).not.toThrow();
  });

  it('shows three bullets and the header', async () => {
    await render(groupBriefResponse());

    expect(text('group-weekly-brief')).toContain('La semana del grupo');
    expect(text('group-weekly-brief-header')).toBe('Actualizada el lunes, 23 de noviembre · 7 ofertas abiertas');
    expect(byId('group-weekly-brief-bullet-text').map((bullet) => bullet.textContent?.trim())).toEqual([
      '2 ofertas cierran en los próximos días; la primera, el jueves, 26 de noviembre.',
      'Docker aparece en 4 de las 7 ofertas abiertas con habilidades detectadas.',
      'Se compartieron 3 ofertas en el grupo la semana pasada.',
    ]);
    expect(text('group-weekly-brief-footer')).toBe('Solo cuenta datos de las ofertas, nunca lo que hace cada miembro.');
  });

  it('shows the loading skeleton with aria-busy until the brief arrives', () => {
    fixture = TestBed.createComponent(GroupWeeklyBriefCard);
    fixture.componentRef.setInput('groupId', 'g1');
    fixture.detectChanges();

    expect(byId('group-weekly-brief-loading')[0]?.getAttribute('aria-busy')).toBe('true');
    http.expectOne(URL).flush(EMPTY_GROUP_BRIEF);
  });

  it('empty state text', async () => {
    await render(EMPTY_GROUP_BRIEF);

    expect(text('group-weekly-brief-empty')).toContain('Todavía no hay novedades para resumir esta semana.');
    expect(text('group-weekly-brief-empty-hint')).toBe(
      'Aparecen cuando una oferta del grupo cierra de hoy a 7 días, dos o más mencionan la misma habilidad o se compartieron ofertas la semana pasada. Se revisa cada mañana.',
    );
    expect(byId('group-weekly-brief-bullet')).toHaveLength(0);
    expect(byId('group-weekly-brief-footer')).toHaveLength(0);
  });

  it('error state with retry', async () => {
    fixture = TestBed.createComponent(GroupWeeklyBriefCard);
    fixture.componentRef.setInput('groupId', 'g1');
    await fixture.whenStable();
    const { body, options } = apiError('internal_error', 500);
    http.expectOne(URL).flush(body, { status: options.status, statusText: options.statusText });
    await settle();
    await fixture.whenStable();

    expect(text('group-weekly-brief-error')).toContain('No pudimos cargar la semana del grupo.');
    expect(byId('group-weekly-brief-error')[0]?.querySelector('[role="alert"]')).not.toBeNull();

    await click(byId('group-weekly-brief-retry')[0]);
    http.expectOne(URL).flush(groupBriefResponse());
    await settle();
    await fixture.whenStable();

    expect(byId('group-weekly-brief-error')).toHaveLength(0);
    expect(byId('group-weekly-brief-bullet')).toHaveLength(3);
  });

  it('shows no member names or statuses', async () => {
    await render(groupBriefResponse());

    expect(host().querySelectorAll('img, mat-icon, [data-testid*="avatar"]')).toHaveLength(0);
    expect(text('group-weekly-brief')).toBe(
      'La semana del grupo Actualizada el lunes, 23 de noviembre · 7 ofertas abiertas' +
        '2 ofertas cierran en los próximos días; la primera, el jueves, 26 de noviembre. Ver ofertas (2) ' +
        'Docker aparece en 4 de las 7 ofertas abiertas con habilidades detectadas. Ver ofertas (4) ' +
        'Se compartieron 3 ofertas en el grupo la semana pasada. Ver ofertas (3) ' +
        'Solo cuenta datos de las ofertas, nunca lo que hace cada miembro.',
    );
  });

  it('expands two offers as external links', async () => {
    await render(
      withSkillBullet({
        offers: [briefOfferWith(1, { company: 'Acme' }), briefOfferWith(2, { title: undefined })],
      }),
    );
    const toggle = byId('group-weekly-brief-toggle')[0];
    expect(toggle?.textContent?.trim()).toBe('Ver ofertas (2)');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(byId('group-weekly-brief-offer-link')).toHaveLength(0);

    await click(toggle);

    const links = byId('group-weekly-brief-offer-link');
    expect(links.map((link) => link.textContent?.trim())).toEqual(['Oferta 1', 'https://example.com/jobs/2']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://example.com/jobs/1',
      'https://example.com/jobs/2',
    ]);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(text('group-weekly-brief-offer-company')).toBe('Acme');
    expect(byId('group-weekly-brief-toggle')[0]?.textContent?.trim()).toBe('Ocultar ofertas');
    expect(byId('group-weekly-brief-toggle')[0]?.getAttribute('aria-expanded')).toBe('true');
    const controls = byId('group-weekly-brief-toggle')[0]?.getAttribute('aria-controls') ?? '';
    expect(host().querySelector(`#${controls}`)).toBe(byId('group-weekly-brief-offers')[0]);

    await click(byId('group-weekly-brief-toggle')[0]);
    expect(byId('group-weekly-brief-offer-link')).toHaveLength(0);
    expect(byId('group-weekly-brief-toggle')[0]?.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows more and missing lines', async () => {
    const offers = Array.from({ length: 10 }, (_, index) => briefOfferWith(index + 1));
    await render(withSkillBullet({ offers, moreCount: 4, missingCount: 1 }));
    expect(byId('group-weekly-brief-toggle')[0]?.textContent?.trim()).toBe('Ver ofertas (14)');

    await click(byId('group-weekly-brief-toggle')[0]);

    expect(byId('group-weekly-brief-offer-link')).toHaveLength(10);
    expect(text('group-weekly-brief-more')).toBe('y 4 más en el listado del grupo');
    expect(text('group-weekly-brief-missing')).toBe('1 ya no está en el grupo');
  });

  it('no toggle when every offer left the group', async () => {
    await render(withSkillBullet({ offers: [], moreCount: 0, missingCount: 2 }));

    expect(byId('group-weekly-brief-toggle')).toHaveLength(0);
    expect(text('group-weekly-brief-missing')).toBe('2 ya no están en el grupo');
  });

  it('closing offers show their own date', async () => {
    await render(groupBriefResponse());

    await click(byId('group-weekly-brief-toggle')[0]);

    expect(byId('group-weekly-brief-offer-closes').map((closes) => closes.textContent?.trim())).toEqual([
      'cierra el jueves, 26 de noviembre',
      'cierra el sábado, 28 de noviembre',
    ]);
  });

  it('toggle has min height class', async () => {
    await render(groupBriefResponse());

    const toggles = byId('group-weekly-brief-toggle');
    expect(toggles).toHaveLength(3);
    for (const toggle of toggles) {
      expect(toggle.classList.contains('min-h-11')).toBe(true);
    }
  });
});
