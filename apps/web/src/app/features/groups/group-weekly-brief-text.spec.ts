import type { GroupBriefFactView } from '@linkvault/shared';
import { useEnglishTranslations } from '../../../testing/english-translations';
import {
  formatUtcDate,
  groupBriefBulletText,
  groupBriefEmptyHintText,
  groupBriefEmptyText,
  groupBriefHeaderText,
  groupBriefMissingText,
  groupBriefMoreText,
  groupBriefOfferClosesText,
  groupBriefShowOffersText,
} from './group-weekly-brief-text';

const closing = (count: number): GroupBriefFactView => ({
  kind: 'closing_soon',
  count,
  from: '2026-11-23',
  until: '2026-11-30',
  firstExpiresAt: '2026-11-26',
});
const skill: GroupBriefFactView = { kind: 'skill_demand', skillLabel: 'Docker', count: 4, total: 7 };
const shared = (count: number): GroupBriefFactView => ({ kind: 'shared_last_week', count, weekKey: '2026-W47' });

describe('group weekly brief text', () => {
  it('formats a date without time in UTC with weekday', () => {
    expect(formatUtcDate('2026-11-23', 'es')).toBe('lunes, 23 de noviembre');
    expect(formatUtcDate('2026-11-23', 'en')).toBe('Monday, November 23');
  });

  it('skill bullet text', () => {
    expect(groupBriefBulletText(skill, 'es')).toBe(
      'Docker aparece en 4 de las 7 ofertas abiertas con habilidades detectadas.',
    );
  });

  it('closing singular names the date, plural names the first date', () => {
    expect(groupBriefBulletText(closing(1), 'es')).toBe('1 oferta cierra el jueves, 26 de noviembre.');
    expect(groupBriefBulletText(closing(2), 'es')).toBe(
      '2 ofertas cierran en los próximos días; la primera, el jueves, 26 de noviembre.',
    );
  });

  it('shared last week singular and plural', () => {
    expect(groupBriefBulletText(shared(1), 'es')).toBe('Se compartió 1 oferta en el grupo la semana pasada.');
    expect(groupBriefBulletText(shared(3), 'es')).toBe('Se compartieron 3 ofertas en el grupo la semana pasada.');
  });

  it('header with one open offer', () => {
    expect(groupBriefHeaderText('2026-11-23', 1, 'es')).toBe('Actualizada el lunes, 23 de noviembre · 1 oferta abierta');
    expect(groupBriefHeaderText('2026-11-23', 7, 'es')).toBe('Actualizada el lunes, 23 de noviembre · 7 ofertas abiertas');
  });

  it('empty state text', () => {
    expect(groupBriefEmptyText()).toBe('Todavía no hay novedades para resumir esta semana.');
    expect(groupBriefEmptyHintText()).toContain('Se revisa cada mañana.');
  });

  it('offer lines singular and plural', () => {
    expect(groupBriefOfferClosesText('2026-11-26', 'es')).toBe('cierra el jueves, 26 de noviembre');
    expect(groupBriefShowOffersText(14)).toBe('Ver ofertas (14)');
    expect(groupBriefMoreText(1)).toBe('y 1 más en el listado del grupo');
    expect(groupBriefMoreText(4)).toBe('y 4 más en el listado del grupo');
    expect(groupBriefMissingText(1)).toBe('1 ya no está en el grupo');
    expect(groupBriefMissingText(2)).toBe('2 ya no están en el grupo');
  });

  describe('in English', () => {
    let restore: () => void;
    beforeEach(() => {
      restore = useEnglishTranslations();
    });
    afterEach(() => {
      restore();
    });

    it('reads the exact English texts of D9', () => {
      expect(groupBriefBulletText(skill, 'en')).toBe('Docker appears in 4 of the 7 open offers with detected skills.');
      expect(groupBriefBulletText(shared(3), 'en')).toBe('3 offers were shared in the group last week.');
      expect(groupBriefBulletText(shared(1), 'en')).toBe('1 offer was shared in the group last week.');
      expect(groupBriefBulletText(closing(1), 'en')).toBe('1 offer closes on Thursday, November 26.');
      expect(groupBriefBulletText(closing(2), 'en')).toBe('2 offers close soon; the first on Thursday, November 26.');
      expect(groupBriefHeaderText('2026-11-23', 7, 'en')).toBe('Updated on Monday, November 23 · 7 open offers');
      expect(groupBriefHeaderText('2026-11-23', 1, 'en')).toBe('Updated on Monday, November 23 · 1 open offer');
      expect(groupBriefOfferClosesText('2026-11-26', 'en')).toBe('closes on Thursday, November 26');
      expect(groupBriefEmptyText()).toBe('There is nothing to summarize for this week yet.');
      expect(groupBriefEmptyHintText()).toBe(
        'They appear when an offer in the group closes between today and 7 days from now, two or more mention the same skill, or offers were shared last week. It is checked every morning.',
      );
      expect(groupBriefShowOffersText(2)).toBe('Show offers (2)');
      expect(groupBriefMoreText(1)).toBe('and 1 more in the group list');
      expect(groupBriefMoreText(4)).toBe('and 4 more in the group list');
      expect(groupBriefMissingText(1)).toBe('1 is no longer in the group');
      expect(groupBriefMissingText(2)).toBe('2 are no longer in the group');
    });
  });
});
