import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes } from './app.routes';
import { HomePage } from './features/home/home.page';

describe('appRoutes', () => {
  it('lazily loads the home page at the root path', async () => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideRouter(appRoutes)],
    });
    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl('/', HomePage);
    expect(page).toBeInstanceOf(HomePage);
  });
});
