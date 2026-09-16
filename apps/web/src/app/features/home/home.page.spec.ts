import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HomePage } from './home.page';

describe('HomePage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  it('renders the placeholder text in Spanish', async () => {
    const fixture = TestBed.createComponent(HomePage);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('h1')?.textContent).toContain('LinkVault');
    expect(host.querySelector('p')?.textContent).toContain(
      'La aplicación está en construcción.',
    );
  });
});
