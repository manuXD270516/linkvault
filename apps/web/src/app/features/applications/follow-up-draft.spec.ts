import { useEnglishTranslations } from '../../../testing/english-translations';
import { followUpDraft } from './follow-up-draft';

const APPLIED_AT = '2026-11-10T12:00:00.000Z';

describe('followUpDraft', () => {
  it('draft with appliedAt names title, company and date', () => {
    const draft = followUpDraft({ title: 'Mobile Developer', company: 'Startup Andes', appliedAt: APPLIED_AT }, 'es');

    expect(draft.split('\n')).toEqual([
      'Hola:',
      'Me postulé a Mobile Developer en Startup Andes el 10 de noviembre de 2026. Sigo con mucho interés en el puesto.',
      '¿Me podrían contar en qué estado está el proceso de selección?',
    ]);
  });

  it('draft without appliedAt says a while ago', () => {
    const draft = followUpDraft({ title: 'Mobile Developer', company: 'Startup Andes' }, 'es');

    expect(draft.split('\n')[1]).toBe(
      'Hace un tiempo me postulé a Mobile Developer en Startup Andes. Sigo con mucho interés en el puesto.',
    );
  });

  it('draft falls back to generic words without title or company', () => {
    const draft = followUpDraft({ title: '  ', appliedAt: undefined }, 'es');

    expect(draft).toContain('Hace un tiempo me postulé a la vacante en su empresa.');
  });

  it('draft ends with the open question about the process', () => {
    const lines = followUpDraft({ title: 'Dev' }, 'es').split('\n');

    expect(lines.at(-1)).toBe('¿Me podrían contar en qué estado está el proceso de selección?');
  });

  it('draft never says attached CV or as we discussed', () => {
    const drafts = [
      followUpDraft({ title: 'Dev', company: 'Acme', appliedAt: APPLIED_AT }, 'es'),
      followUpDraft({}, 'es'),
    ];

    for (const draft of drafts) {
      expect(draft).not.toMatch(/adjunto|como conversamos|mailto/i);
    }
  });

  describe('in English', () => {
    let restore: () => void;
    beforeEach(() => {
      restore = useEnglishTranslations();
    });
    afterEach(() => {
      restore();
    });

    it('reads the exact English lines of D9 with appliedAt', () => {
      const draft = followUpDraft({ title: 'Mobile Developer', company: 'Startup Andes', appliedAt: APPLIED_AT }, 'en');

      expect(draft.split('\n')).toEqual([
        'Hello,',
        'I applied for Mobile Developer at Startup Andes on November 10, 2026. I am still very interested in the role.',
        'Could you tell me where the selection process currently stands?',
      ]);
    });

    it('reads the exact English lines of D9 without appliedAt and without title or company', () => {
      const draft = followUpDraft({}, 'en');

      expect(draft.split('\n')).toEqual([
        'Hello,',
        'I applied for the position at your company a while ago. I am still very interested in the role.',
        'Could you tell me where the selection process currently stands?',
      ]);
      expect(draft).not.toMatch(/mailto|attached|as we discussed/i);
    });
  });
});
