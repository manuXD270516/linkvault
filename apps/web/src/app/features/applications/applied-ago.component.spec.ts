import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppliedAgo } from './applied-ago.component';
import { daysSinceApplied } from './application-status.labels';

describe('AppliedAgo', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  async function textFor(appliedAt: string, now: Date): Promise<string> {
    const fixture = TestBed.createComponent(AppliedAgo);
    fixture.componentRef.setInput('appliedAt', appliedAt);
    fixture.componentRef.setInput('now', now);
    await fixture.whenStable();
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('Fecha de postulación legible', async () => {
    const now = new Date(2026, 8, 19, 9, 30);

    expect(await textFor(new Date(2026, 8, 19, 8, 0).toISOString(), now)).toBe('Postulaste hoy');
    expect(await textFor(new Date(2026, 8, 18, 23, 50).toISOString(), now)).toBe('Postulaste ayer');
    expect(await textFor(new Date(2026, 8, 13, 0, 0).toISOString(), now)).toBe(
      'Postulaste hace 6 días',
    );
  });

  it('counts calendar days of whoever looks and never goes negative', () => {
    const now = new Date(2026, 8, 19, 0, 5);

    expect(daysSinceApplied(new Date(2026, 8, 18, 23, 55).toISOString(), now)).toBe(1);
    expect(daysSinceApplied(new Date(2026, 8, 20, 10, 0).toISOString(), now)).toBe(0);
  });
});
