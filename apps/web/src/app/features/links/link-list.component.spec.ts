import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { JobLinkSummary } from '@linkvault/shared';
import { LinkList, type LinkListScope, linkLabel } from './link-list.component';

const linkedin: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  displayUrl:
    'https://www.linkedin.com/jobs/view/senior-backend-engineer-at-acme-3912345678/?utm_source=share',
  platform: 'linkedin',
  previewStatus: 'pending',
  sharedBy: { userId: 'u1', displayName: 'Ana' },
  sharedAt: '2026-09-17T10:00:00.000Z',
};

const computrabajo: JobLinkSummary = {
  id: 'l2',
  normalizedUrl: 'https://co.computrabajo.com/trabajo/1A2B3C',
  displayUrl: 'https://co.computrabajo.com/trabajo-de-analista-de-datos-en-acme-1A2B3C',
  platform: 'computrabajo',
  previewStatus: 'pending',
  sharedBy: { userId: 'u2', displayName: 'Beto' },
  sharedAt: '2026-09-17T09:00:00.000Z',
};

/** Link de la lista privada: sin grupo no hay con quién compartir, así que no trae `sharedBy`. */
const priv: JobLinkSummary = {
  id: 'l3',
  normalizedUrl: 'https://ejemplo.test/ofertas/analista',
  displayUrl: 'https://ejemplo.test/ofertas/analista',
  platform: 'generic',
  previewStatus: 'pending',
  sharedAt: '2026-09-17T08:00:00.000Z',
};

describe('LinkList', () => {
  let fixture: ComponentFixture<LinkList>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(LinkList);
  });

  async function render(links: JobLinkSummary[], scope: LinkListScope = 'group'): Promise<void> {
    fixture.componentRef.setInput('links', links);
    fixture.componentRef.setInput('scope', scope);
    await fixture.whenStable();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return host().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function anchors(): HTMLAnchorElement[] {
    return Array.from(host().querySelectorAll<HTMLAnchorElement>('[data-testid="link-open"]'));
  }

  it('Grupo con links', async () => {
    await render([linkedin, computrabajo]);

    expect(anchors()).toHaveLength(2);
    expect(text()).toContain('senior backend engineer at acme 3912345678');
    expect(text()).toContain('trabajo de analista de datos en acme 1A2B3C');
    expect(text()).toContain('LinkedIn');
    expect(text()).toContain('Computrabajo');
    expect(text()).toContain('Compartido por Ana');
    expect(text()).toContain('Compartido por Beto');
    expect(text()).toContain('Sin vista previa todavía');
    expect(host().querySelector('[data-testid="links-empty"]')).toBeNull();
  });

  it('Grupo sin links', async () => {
    await render([]);

    expect(text()).toBe(
      'Todavía no hay ofertas aquí. Guarda un link o pega el chat donde las compartís.',
    );
    expect(host().querySelector('[data-testid="link-list"]')).toBeNull();
  });

  it('Abrir una oferta', async () => {
    await render([linkedin]);

    const [anchor] = anchors();
    expect(anchor.getAttribute('href')).toBe(linkedin.displayUrl);
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('Vista privada vacía', async () => {
    await render([], 'mine');

    expect(text()).toBe(
      'Aquí guardas ofertas solo para ti. Las que compartiste están en tus grupos.',
    );
  });

  it('shows a private link without saying who shared it', async () => {
    await render([priv], 'mine');

    expect(text()).toContain('analista');
    expect(text()).toContain('Otra web');
    expect(text()).toContain('Sin vista previa todavía');
    expect(text()).not.toContain('Compartido por');
  });

  it('hides the pending notice once the preview exists', async () => {
    await render([{ ...linkedin, previewStatus: 'enriched' }]);

    expect(text()).not.toContain('Sin vista previa todavía');
  });
});

describe('linkLabel', () => {
  it.each([
    [
      'https://www.linkedin.com/jobs/view/senior-backend-engineer-at-acme-3912345678/?utm_source=share',
      'senior backend engineer at acme 3912345678',
    ],
    [
      'https://co.computrabajo.com/trabajo-de-analista-de-datos-en-acme-1A2B3C',
      'trabajo de analista de datos en acme 1A2B3C',
    ],
    ['https://ejemplo.test/ofertas/analista.html', 'analista'],
    ['https://ejemplo.test/ofertas/desarrollador%20senior', 'desarrollador senior'],
    ['https://ejemplo.test/ofertas/analista/', 'analista'],
    ['https://www.getonboard.com/', 'getonboard.com'],
    ['https://ejemplo.test', 'ejemplo.test'],
    ['no-es-una-url', 'no-es-una-url'],
  ])('derives the label of %s', (url, expected) => {
    expect(linkLabel(url)).toBe(expected);
  });
});
