import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { Application } from '@linkvault/shared';
import { applicationWith } from '../../../testing/applications-testing';
import { ApplicationCard } from './application-card.component';

describe('ApplicationCard', () => {
  let fixture: ComponentFixture<ApplicationCard>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(ApplicationCard);
  });

  async function render(application: Application): Promise<HTMLElement> {
    fixture.componentRef.setInput('application', application);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function part(host: HTMLElement, testId: string): string | null {
    return host.querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  }

  it('shows the title, the company and the platform of the offer', async () => {
    const host = await render(applicationWith());

    expect(part(host, 'application-open')).toBe('Oferta l1');
    expect(part(host, 'application-company')).toBe('Acme');
    expect(part(host, 'application-platform')).toBe('LinkedIn');
    expect(part(host, 'application-stage')).toBeNull();
    expect(part(host, 'applied-ago')).toBeNull();
    expect(part(host, 'application-shared')).toBeNull();
    expect(part(host, 'application-closed')).toBeNull();
  });

  it('uses the label of the URL when the offer has no title', async () => {
    const base = applicationWith();
    const host = await render({
      ...base,
      link: {
        id: 'l1',
        displayUrl: 'https://co.computrabajo.com/trabajo-de-analista-de-datos-en-acme-1A2B3C',
        platform: 'computrabajo',
        previewStatus: 'failed',
      },
    });

    expect(part(host, 'application-open')).toBe('trabajo de analista de datos en acme 1A2B3C');
    expect(part(host, 'application-company')).toBeNull();
    expect(part(host, 'application-platform')).toBe('Computrabajo');
  });

  it('shows the stage, the date and the shared mark', async () => {
    const host = await render(
      applicationWith({
        status: 'in_process',
        stageLabel: 'Prueba técnica',
        appliedAt: new Date().toISOString(),
        visibility: 'group',
      }),
    );

    expect(part(host, 'application-stage')).toBe('Prueba técnica');
    expect(part(host, 'applied-ago')).toBe('Postulaste hoy');
    expect(part(host, 'application-shared')).toBe('Compartida con tus grupos');
  });

  it('El encaje de un análisis completo', async () => {
    const host = await render(applicationWith({ fitScore: 78, fitScoreDegraded: false }));
    expect(part(host, 'match-badge-score')).toBe('78');
    expect(part(host, 'match-badge-label')).toBeTruthy();
  });

  it('El encaje de un análisis básico no enseña número', async () => {
    const host = await render(applicationWith({ fitScoreDegraded: true }));
    expect(part(host, 'match-badge')).not.toBeNull();
    expect(part(host, 'match-badge-score')).toBeNull();
    expect(host.textContent).not.toContain('41');
  });

  it('Sin análisis no hay badge en el tablero', async () => {
    const host = await render(applicationWith());
    expect(host.querySelector('[data-testid="match-badge"]')).toBeNull();
    expect(host.textContent).not.toMatch(/\b0\b/);
  });

  it('names the closing in "Cerradas"', async () => {
    const host = await render(applicationWith({ status: 'withdrawn' }));

    expect(part(host, 'application-closed')).toBe('Retirada');
  });

  it('asks the board to open the panel', async () => {
    const host = await render(applicationWith());
    const opened = vi.fn();
    fixture.componentInstance.open.subscribe(opened);

    host.querySelector<HTMLButtonElement>('[data-testid="application-open"]')?.click();

    expect(opened).toHaveBeenCalledTimes(1);
  });
});
