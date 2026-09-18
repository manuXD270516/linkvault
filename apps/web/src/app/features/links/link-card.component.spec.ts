import { LOCALE_ID } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { JobLinkSummary } from '@linkvault/shared';
import { providePageTesting } from '../../../testing/auth-testing';
import { LinkCard } from './link-card.component';

/** Link guardado hace tiempo y sin preview: lo único que hay de él es su URL. */
const bare: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  displayUrl:
    'https://www.linkedin.com/jobs/view/senior-backend-engineer-at-acme-3912345678/?utm_source=share',
  platform: 'linkedin',
  previewStatus: 'pending',
  previewVersion: 1,
  sharedBy: { userId: 'u1', displayName: 'Ana' },
  sharedAt: '2026-09-17T10:00:00.000Z',
};

/** La misma oferta ya leída: la tarjeta deja de enseñar el slug de la URL y dice lo que pone la vacante. */
const enriched: JobLinkSummary = {
  ...bare,
  previewStatus: 'enriched',
  previewVersion: 1,
  preview: {
    title: 'Ingeniera de datos',
    company: 'Acme',
    location: 'La Paz, Bolivia',
    modality: 'hybrid',
    seniority: 'senior',
  },
};

describe('LinkCard', () => {
  let fixture: ComponentFixture<LinkCard>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    fixture = TestBed.createComponent(LinkCard);
  });

  // Solo se falsea el reloj, no los temporizadores: "publicada hace tres días" se cuenta contra una fecha fija.
  afterEach(() => vi.useRealTimers());

  async function render(link: JobLinkSummary): Promise<void> {
    fixture.componentRef.setInput('link', link);
    await fixture.whenStable();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return host().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('Oferta enriquecida', async () => {
    await render(enriched);

    expect(text()).toContain('Ingeniera de datos');
    expect(text()).toContain('Acme');
    expect(text()).toContain('La Paz, Bolivia');
    expect(text()).toContain('Híbrido');
    expect(text()).toContain('Senior');
    expect(text()).not.toContain('senior backend engineer at acme');
  });

  it('falls back to the label derived from the URL while there is no preview', async () => {
    await render(bare);

    expect(text()).toContain('senior backend engineer at acme 3912345678');
    expect(text()).toContain('LinkedIn');
    expect(text()).toContain('Compartido por Ana');
  });

  /** Media oferta es media tarjeta: lo que la página no dijo no deja un hueco con una etiqueta vacía. */
  it('shows only the fields that were read', async () => {
    await render({
      ...bare,
      previewStatus: 'partial',
      previewVersion: 1,
      preview: { title: 'Ingeniera de datos', modality: 'unknown', seniority: 'unknown' },
    });

    expect(text()).toContain('Ingeniera de datos');
    expect(host().querySelector('[data-testid="link-company"]')).toBeNull();
    expect(host().querySelector('[data-testid="link-location"]')).toBeNull();
    expect(host().querySelector('[data-testid="link-modality"]')).toBeNull();
    expect(host().querySelector('[data-testid="link-seniority"]')).toBeNull();
  });

  /** Los miles se agrupan según el locale de la aplicación, así que el test los compone igual que la tarjeta. */
  function money(value: number): string {
    return new Intl.NumberFormat(TestBed.inject(LOCALE_ID), { useGrouping: true }).format(value);
  }

  it('Oferta con salario y fechas', async () => {
    vi.setSystemTime(new Date('2026-09-18T12:00:00.000Z'));
    await render({
      ...enriched,
      preview: {
        ...enriched.preview,
        salary: { min: 8000, max: 12000, currency: 'BOB', period: 'month' },
        postedAt: '2026-09-15',
        expiresAt: '2026-10-31',
      },
    });

    expect(text()).toContain(`${money(8000)} – ${money(12000)} BOB al mes`);
    expect(text()).toContain('Publicada hace 3 días');
    expect(text()).toContain('Cierra el 31/10/2026');
  });

  it('says a salary read from the page louder than one the AI guessed', async () => {
    const withSalary: JobLinkSummary = {
      ...enriched,
      preview: { ...enriched.preview, salary: { min: 8000, max: null, currency: 'BOB', period: 'month' } },
      previewSources: {
        salary: {
          value: { min: 8000, max: null, currency: 'BOB', period: 'month' },
          source: 'auto',
          extractor: 'json-ld',
          at: '2026-09-17T10:05:00.000Z',
        },
      },
    };
    await render(withSalary);
    const read = host().querySelector<HTMLElement>('[data-testid="link-salary"]');
    expect(read?.classList.contains('font-medium')).toBe(true);
    expect(read?.getAttribute('data-guess')).toBeNull();

    await render({
      ...withSalary,
      previewSources: {
        salary: {
          value: { min: 8000, max: null, currency: 'BOB', period: 'month' },
          source: 'auto',
          extractor: 'ai:extract-job',
          at: '2026-09-17T10:05:00.000Z',
        },
      },
    });
    const guessed = host().querySelector<HTMLElement>('[data-testid="link-salary"]');
    expect(guessed?.textContent).toContain('BOB');
    expect(guessed?.classList.contains('font-medium')).toBe(false);
    expect(guessed?.getAttribute('data-guess')).toBe('ai');
  });

  it.each([
    ['2026-09-18', 'Publicada hoy'],
    ['2026-09-17', 'Publicada ayer'],
  ])('says a fresh offer was published %s', async (postedAt, expected) => {
    vi.setSystemTime(new Date('2026-09-18T12:00:00.000Z'));
    await render({ ...enriched, preview: { ...enriched.preview, postedAt } });

    expect(text()).toContain(expected);
  });

  it('opens the URL a person wrote, in another tab', async () => {
    await render(enriched);

    const anchor = host().querySelector<HTMLAnchorElement>('[data-testid="link-open"]');
    expect(anchor?.getAttribute('href')).toBe(enriched.displayUrl);
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

/**
 * Los textos de estado salen de los campos, del motivo y de cuándo se pidió la lectura; nunca del nombre del estado
 * (spec web/links). Por eso los fixtures de aquí llevan el estado que tendrían de verdad, pero ninguna aserción lo mira.
 */
describe('LinkCard: lo que se dice del estado', () => {
  let fixture: ComponentFixture<LinkCard>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    fixture = TestBed.createComponent(LinkCard);
    vi.setSystemTime(new Date('2026-09-18T12:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  async function render(link: JobLinkSummary): Promise<void> {
    fixture.componentRef.setInput('link', link);
    fixture.componentRef.setInput('canRemove', true);
    await fixture.whenStable();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function status(): string {
    return host().querySelector('[data-testid="link-status"]')?.textContent?.trim() ?? '';
  }

  function action(name: 'complete' | 'retry' | 'remove'): HTMLButtonElement | null {
    return host().querySelector<HTMLButtonElement>(`[data-testid="link-${name}"]`);
  }

  it('Oferta recién guardada', async () => {
    await render({ ...bare, previewRequestedAt: '2026-09-18T11:58:00.000Z' });

    expect(status()).toBe('Leyendo la oferta…');
    expect(action('retry')).toBeNull();
    expect(action('complete')).toBeNull();
  });

  it('Lectura que nunca llegó', async () => {
    await render({ ...bare, previewRequestedAt: '2026-09-18T10:00:00.000Z' });

    expect(status()).toBe('Sin vista previa todavía');
    expect(action('complete')).not.toBeNull();
    expect(action('retry')).toBeNull();
  });

  it('Oferta que no se pudo leer', async () => {
    await render({
      ...bare,
      previewStatus: 'failed',
      previewRequestedAt: '2026-09-18T11:59:00.000Z',
      lastEnrichmentError: { reason: 'timeout', at: '2026-09-18T11:59:30.000Z' },
    });

    expect(status()).toBe('No pudimos leer esta oferta');
    expect(action('complete')).not.toBeNull();
    expect(action('retry')).not.toBeNull();
  });

  it('Bolsa que no permite la lectura', async () => {
    await render({
      ...bare,
      previewStatus: 'failed',
      lastEnrichmentError: { reason: 'robots_disallowed', at: '2026-09-18T11:00:00.000Z' },
    });

    expect(status()).toBe('Esta bolsa no permite la lectura automática de sus ofertas');
    expect(action('retry')).toBeNull();
    expect(action('complete')).not.toBeNull();
  });

  it('Lo compartido no era una oferta', async () => {
    await render({
      ...bare,
      previewStatus: 'failed',
      lastEnrichmentError: { reason: 'not_a_job', at: '2026-09-18T11:00:00.000Z' },
    });

    expect(status()).toBe('Esto no parece una oferta');
    expect(action('remove')).not.toBeNull();
    expect(action('retry')).toBeNull();
    expect(action('complete')).toBeNull();
  });

  it('says the site blocked us apart from what the site forbids', async () => {
    await render({
      ...bare,
      previewStatus: 'failed',
      lastEnrichmentError: { reason: 'blocked', at: '2026-09-18T11:00:00.000Z' },
    });

    expect(status()).toBe('Esta bolsa no nos deja leer esta oferta');
    expect(action('retry')).toBeNull();
  });

  it('asks for a hand when the offer was read with pieces missing', async () => {
    await render({
      ...bare,
      previewStatus: 'partial',
      preview: { title: 'Ingeniera de datos' },
    });

    expect(status()).toBe('Faltan datos de esta oferta');
    expect(action('complete')).not.toBeNull();
  });

  /** `manual` es procedencia, no completitud: una oferta terminada a mano está completa y no le falta nada. */
  it('says nothing about an offer someone finished by hand', async () => {
    await render({
      ...bare,
      previewStatus: 'manual',
      preview: { title: 'Ingeniera de datos', company: 'Acme' },
      previewSources: {
        title: {
          value: 'Ingeniera de datos',
          source: 'manual',
          by: { userId: 'u1', displayName: 'Ana' },
          at: '2026-09-18T11:00:00.000Z',
        },
      },
    });

    expect(host().querySelector('[data-testid="link-status"]')).toBeNull();
    expect(action('complete')).toBeNull();
  });

  /** Un link de antes de este change no trae `previewRequestedAt`: vale la fecha en que se guardó. */
  it('falls back to when the link was saved', async () => {
    await render(bare);

    expect(status()).toBe('Sin vista previa todavía');
  });
});

/** Lo que una persona corrige lo ven las demás, así que la tarjeta dice quién lo escribió (spec web/links). */
describe('LinkCard: quién escribió cada dato', () => {
  let fixture: ComponentFixture<LinkCard>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    fixture = TestBed.createComponent(LinkCard);
  });

  async function render(link: JobLinkSummary): Promise<void> {
    fixture.componentRef.setInput('link', link);
    await fixture.whenStable();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function note(field: string): string | null {
    return host().querySelector(`[data-testid="note-${field}"]`)?.textContent?.trim() ?? null;
  }

  it('Quién lo escribió, en la tarjeta', async () => {
    await render({
      ...enriched,
      previewStatus: 'manual',
      preview: { ...enriched.preview, salary: { min: 8000, max: null, currency: 'BOB', period: 'month' } },
      previewSources: {
        title: {
          value: 'Ingeniera de datos',
          source: 'manual',
          by: { userId: 'u9', displayName: 'Ana' },
          at: '2026-09-18T10:00:00.000Z',
        },
        company: {
          value: 'Acme',
          source: 'auto',
          extractor: 'json-ld',
          at: '2026-09-18T09:00:00.000Z',
        },
        salary: {
          value: { min: 8000, max: null, currency: 'BOB', period: 'month' },
          source: 'auto',
          extractor: 'ai:extract-job',
          at: '2026-09-18T09:00:00.000Z',
        },
      },
    });

    expect(note('title')).toBe('Escrito por Ana');
    expect(note('salary')).toBe('Deducido por la IA');
    // Lo leído de la página es el caso normal: anotarlo llenaría la tarjeta de ruido.
    expect(note('company')).toBeNull();
  });
});
