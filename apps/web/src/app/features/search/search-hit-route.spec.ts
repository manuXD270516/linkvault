import type { SearchHit } from '@linkvault/shared';
import { searchHitRoute } from './search-hit-route';

function hit(partial: Partial<SearchHit> & Pick<SearchHit, 'docType'>): SearchHit {
  return {
    id: partial.id ?? `${partial.docType}:1`,
    title: partial.title ?? 'Título',
    score: partial.score ?? 1,
    ...partial,
  };
}

describe('searchHitRoute', () => {
  it('routes job_preview to the group or private list', () => {
    expect(searchHitRoute(hit({ docType: 'job_preview', groupId: 'g1' }))).toBe('/grupos/g1');
    expect(searchHitRoute(hit({ docType: 'job_preview' }))).toBe('/mis-links');
  });

  it('routes application, cv and roadmap to existing screens', () => {
    expect(searchHitRoute(hit({ docType: 'application' }))).toBe('/postulaciones');
    expect(searchHitRoute(hit({ docType: 'cv' }))).toBe('/mi-cv');
    expect(searchHitRoute(hit({ docType: 'roadmap', analysisId: 'a1' }))).toBe('/plan/a1');
    expect(searchHitRoute(hit({ docType: 'roadmap' }))).toBeNull();
  });

  it('routes group comment and note to the group', () => {
    expect(searchHitRoute(hit({ docType: 'group_comment', groupId: 'g2' }))).toBe('/grupos/g2');
    expect(searchHitRoute(hit({ docType: 'group_link_note', groupId: 'g2' }))).toBe('/grupos/g2');
    expect(searchHitRoute(hit({ docType: 'group_comment' }))).toBeNull();
  });
});
