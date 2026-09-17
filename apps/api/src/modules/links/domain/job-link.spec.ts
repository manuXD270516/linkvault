import { describe, expect, it } from 'vitest';
import type { Canonicalization } from './canonicalizers/canonicalizer';
import {
  appendOriginalUrl,
  createJobLink,
  dedupeKeyOf,
  INITIAL_PREVIEW_VERSION,
  type JobLink,
  MAX_ORIGINAL_URLS,
  withOriginalUrl,
} from './job-link';
import { normalizeUrl } from './url';

const now = new Date('2026-09-17T10:00:00.000Z');
const later = new Date('2026-09-17T11:00:00.000Z');
const linkedin: Canonicalization = {
  platform: 'linkedin',
  externalJobId: '3811111111',
};
const unknown: Canonicalization = { platform: 'generic' };

function newJobLink(
  canonicalization: Canonicalization,
  raw = 'https://www.linkedin.com/jobs/view/3811111111/?utm_source=wa',
) {
  const normalized = normalizeUrl(raw);
  expect(normalized).not.toBeNull();
  return createJobLink({
    normalizedUrl: normalized?.normalizedUrl ?? '',
    urlHash: normalized?.urlHash ?? '',
    canonicalization,
    displayUrl: raw,
    createdBy: '66e9a0000000000000000001',
    now,
  });
}

describe('dedupeKeyOf', () => {
  it('uses platform and job id when the platform is recognized', () => {
    expect(dedupeKeyOf(linkedin, 'abc')).toBe('linkedin:3811111111');
  });

  it('falls back to the hash of the normalized url when it is not', () => {
    expect(dedupeKeyOf(unknown, 'abc')).toBe('url:abc');
  });

  it('gives the same key to the same vacancy shared with two urls', () => {
    const fromTheJobPage = normalizeUrl(
      'https://www.linkedin.com/jobs/view/3811111111/',
    );
    const fromTheSearch = normalizeUrl(
      'https://www.linkedin.com/jobs/search/?currentJobId=3811111111',
    );

    expect(dedupeKeyOf(linkedin, fromTheJobPage?.urlHash ?? '')).toBe(
      dedupeKeyOf(linkedin, fromTheSearch?.urlHash ?? ''),
    );
  });

  it('gives different keys to different vacancies of the same platform', () => {
    expect(dedupeKeyOf(linkedin, 'abc')).not.toBe(
      dedupeKeyOf({ platform: 'linkedin', externalJobId: '3822222222' }, 'abc'),
    );
  });

  it('gives different keys to two unknown urls', () => {
    const one = normalizeUrl('https://empresa.example/careers/backend');
    const other = normalizeUrl('https://empresa.example/careers/frontend');

    expect(dedupeKeyOf(unknown, one?.urlHash ?? '')).not.toBe(
      dedupeKeyOf(unknown, other?.urlHash ?? ''),
    );
  });
});

describe('createJobLink', () => {
  it('Link recién guardado', () => {
    const link = newJobLink(linkedin);

    expect(link.previewStatus).toBe('pending');
    expect(link.previewVersion).toBe(INITIAL_PREVIEW_VERSION);
    expect(link.previewVersion).toBe(1);
    expect(link.normalizedUrl).toBe(
      'https://linkedin.com/jobs/view/3811111111',
    );
    expect(link.displayUrl).toBe(
      'https://www.linkedin.com/jobs/view/3811111111/?utm_source=wa',
    );
    expect(link.platform).toBe('linkedin');
  });

  it('carries the dedupe key and the job id of the platform', () => {
    const link = newJobLink(linkedin);

    expect(link.dedupeKey).toBe('linkedin:3811111111');
    expect(link.externalJobId).toBe('3811111111');
  });

  it('carries no job id when the platform is unknown', () => {
    const link = newJobLink(unknown, 'https://empresa.example/careers/backend');

    expect(link.platform).toBe('generic');
    expect(link.externalJobId).toBeUndefined();
    expect('externalJobId' in link).toBe(false);
    expect(link.dedupeKey).toBe(`url:${link.urlHash}`);
  });

  it('starts the history with the url the person wrote, which is also displayUrl', () => {
    const link = newJobLink(linkedin);

    expect(link.originalUrls).toEqual([link.displayUrl]);
    expect(link.displayUrl).toBe(
      'https://www.linkedin.com/jobs/view/3811111111/?utm_source=wa',
    );
    expect(link.createdAt).toEqual(now);
    expect(link.updatedAt).toEqual(now);
  });
});

describe('appendOriginalUrl', () => {
  it('adds a url that was not in the history', () => {
    expect(appendOriginalUrl(['https://a.example/1'], 'https://b.example/2')).toEqual(
      ['https://a.example/1', 'https://b.example/2'],
    );
  });

  it('does not repeat a url that was already there', () => {
    const urls = ['https://a.example/1'];

    expect(appendOriginalUrl(urls, 'https://a.example/1')).toBe(urls);
  });

  it('keeps at most the last 20 urls', () => {
    let urls: readonly string[] = [];
    for (let index = 0; index < 25; index += 1) {
      urls = appendOriginalUrl(urls, `https://a.example/${index}`);
    }

    expect(urls).toHaveLength(MAX_ORIGINAL_URLS);
    expect(urls[0]).toBe('https://a.example/5');
    expect(urls[urls.length - 1]).toBe('https://a.example/24');
  });
});

describe('withOriginalUrl', () => {
  const link: JobLink = { ...newJobLink(linkedin), id: '66e9a0000000000000000002' };

  it('adds the url and moves updatedAt', () => {
    const updated = withOriginalUrl(link, 'https://lnkd.in/abc', later);

    expect(updated.originalUrls).toEqual([
      'https://www.linkedin.com/jobs/view/3811111111/?utm_source=wa',
      'https://lnkd.in/abc',
    ]);
    expect(updated.updatedAt).toEqual(later);
  });

  it('leaves the link untouched when the url was already there', () => {
    expect(withOriginalUrl(link, link.displayUrl, later)).toBe(link);
  });

  it('Historial acotado: keeps displayUrl after 25 urls', () => {
    let full: JobLink = link;
    for (let index = 0; index < 25; index += 1) {
      full = withOriginalUrl(full, `https://a.example/${index}`, later);
    }

    expect(full.originalUrls).toHaveLength(MAX_ORIGINAL_URLS);
    // El historial ya no contiene la primera URL, y aun así `displayUrl` es la misma.
    expect(full.originalUrls).not.toContain(link.displayUrl);
    expect(full.displayUrl).toBe(link.displayUrl);
  });
});
