import { HttpTestingController } from '@angular/common/http/testing';
import { LOCALE_ID } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { providePageTesting, sessionWith, settle, verifyNoPendingRequests } from '../../../testing/auth-testing';
import { useEnglishTranslations } from '../../../testing/english-translations';
import { EMPTY_GROUP_BRIEF } from '../../../testing/group-brief-testing';
import { SessionStore } from '../../core/auth/session.store';
import { GroupWeeklyBriefCard } from './group-weekly-brief-card.component';

/**
 * Aparte del spec en español porque Angular calcula los textos `i18n` de una plantilla la primera vez que se crea el
 * componente y los guarda: el catálogo inglés tiene que estar cargado antes de esa primera vez, y un fichero de spec
 * corre aislado de los demás.
 */
describe('GroupWeeklyBriefCard in English', () => {
  let fixture: ComponentFixture<GroupWeeklyBriefCard>;
  let http: HttpTestingController;
  let restore: () => void;

  beforeEach(() => {
    restore = useEnglishTranslations();
    TestBed.configureTestingModule({ providers: [...providePageTesting(), { provide: LOCALE_ID, useValue: 'en' }] });
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    verifyNoPendingRequests(http);
    restore();
  });

  it('empty state text', async () => {
    fixture = TestBed.createComponent(GroupWeeklyBriefCard);
    fixture.componentRef.setInput('groupId', 'g1');
    await fixture.whenStable();
    http.expectOne('/api/groups/g1/weekly-brief').flush(EMPTY_GROUP_BRIEF);
    await settle();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const text = (testId: string): string =>
      host.querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(text('group-weekly-brief')).toContain("The group's week");
    expect(text('group-weekly-brief-empty')).toContain('There is nothing to summarize for this week yet.');
    expect(text('group-weekly-brief-empty-hint')).toBe(
      'They appear when an offer in the group closes between today and 7 days from now, two or more mention the same skill, or offers were shared last week. It is checked every morning.',
    );
  });
});
