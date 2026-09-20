import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatchBadge } from './match-badge.component';

describe('MatchBadge', () => {
  let fixture: ComponentFixture<MatchBadge>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(MatchBadge);
  });

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('Encaje alto', async () => {
    fixture.componentRef.setInput('score', 82);
    fixture.componentRef.setInput('degraded', false);
    await fixture.whenStable();

    expect(text()).toContain('82');
    expect(text()).toContain('Encaje alto');
    expect(text()).toContain('Cuánto de lo que pide esta oferta ya aparece en tu CV.');
  });

  it('Encaje bajo es un tramo de la misma escala', async () => {
    fixture.componentRef.setInput('score', 31);
    await fixture.whenStable();

    expect(text()).toContain('31');
    expect(text()).toContain('Encaje bajo');
    expect(text()).not.toMatch(/falta|error|avería/i);
  });

  it('Un análisis básico no enseña número', async () => {
    fixture.componentRef.setInput('score', 64);
    fixture.componentRef.setInput('degraded', true);
    await fixture.whenStable();

    expect(text()).toContain('Encaje aproximado — comparamos listas de habilidades');
    expect(text()).not.toContain('64');
    expect(text()).not.toContain('Encaje medio');
  });

  it('El color no es la única señal', async () => {
    fixture.componentRef.setInput('score', 50);
    await fixture.whenStable();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="match-badge-label"]')
        ?.textContent,
    ).toContain('Encaje medio');
  });
});
