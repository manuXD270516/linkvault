import type { WeeklyPlanReason } from '@linkvault/shared';
import { useEnglishTranslations } from '../../../testing/english-translations';
import { weeklyPlanReasonText } from './weekly-plan-reason';

const closing = (daysLeft: number): WeeklyPlanReason => ({ kind: 'closing_soon', expiresAt: '2026-11-28', daysLeft });
const quiet = (daysQuiet: number): WeeklyPlanReason => ({ kind: 'quiet', daysQuiet, status: 'applied' });
const knowSomeone = (count: number): WeeklyPlanReason => ({ kind: 'know_someone', count, groupId: 'g1' });

describe('weeklyPlanReasonText', () => {
  it('closing today reads Cierra hoy', () => {
    expect(weeklyPlanReasonText(closing(0))).toBe('Cierra hoy: postula hoy.');
  });

  it('closing in one day is singular', () => {
    expect(weeklyPlanReasonText(closing(1))).toBe('Cierra en 1 día: postula antes.');
  });

  it('closing in four days is plural', () => {
    expect(weeklyPlanReasonText(closing(4))).toBe('Cierra en 4 días: postula antes.');
  });

  it('high fit names the score', () => {
    expect(weeklyPlanReasonText({ kind: 'high_fit', score: 82 })).toBe('Encaja 82/100 según tu análisis: postula.');
  });

  it('quiet names the days', () => {
    expect(weeklyPlanReasonText(quiet(12))).toBe('12 días sin novedades: manda un seguimiento.');
  });

  it('know someone is singular for one and plural for two', () => {
    expect(weeklyPlanReasonText(knowSomeone(1))).toBe(
      '1 persona de tu grupo conoce a alguien ahí: pregunta en el grupo.',
    );
    expect(weeklyPlanReasonText(knowSomeone(2))).toBe(
      '2 personas de tu grupo conocen a alguien ahí: pregunta en el grupo.',
    );
  });

  describe('in English', () => {
    let restore: () => void;
    beforeEach(() => {
      restore = useEnglishTranslations();
    });
    afterEach(() => {
      restore();
    });

    it('reads the exact English texts of D10', () => {
      expect(weeklyPlanReasonText(closing(0))).toBe('Closes today: apply today.');
      expect(weeklyPlanReasonText(closing(1))).toBe('Closes in 1 day: apply before then.');
      expect(weeklyPlanReasonText(closing(4))).toBe('Closes in 4 days: apply before then.');
      expect(weeklyPlanReasonText({ kind: 'high_fit', score: 82 })).toBe(
        'Fits 82/100 according to your analysis: apply.',
      );
      expect(weeklyPlanReasonText(quiet(12))).toBe('12 days with no news: send a follow-up.');
      expect(weeklyPlanReasonText(knowSomeone(1))).toBe('1 person in your group knows someone there: ask in the group.');
      expect(weeklyPlanReasonText(knowSomeone(2))).toBe('2 people in your group know someone there: ask in the group.');
    });
  });
});
