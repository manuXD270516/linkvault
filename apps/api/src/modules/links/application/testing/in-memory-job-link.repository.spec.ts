import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_ORIGINAL_URLS } from '../../domain/job-link';
import { InMemoryJobLinkRepository } from './in-memory-job-link.repository';
import { jobLinkDraft, objectId } from './link-fixtures';
import { IN_MEMORY_SESSION } from './links-test-doubles';

const ANA = objectId(1);
const BETO = objectId(2);
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const SEARCH_PAGE =
  'https://www.linkedin.com/jobs/search/?currentJobId=3811111111';

let repository: InMemoryJobLinkRepository;

// Repositorio nuevo por test: cada uno cuenta sus propios links.
beforeEach(() => {
  repository = new InMemoryJobLinkRepository();
});

function resolve(url: string, createdBy = ANA, now?: Date) {
  return repository.withResolvedLink(
    jobLinkDraft(url, { createdBy, ...(now === undefined ? {} : { now }) }),
    (resolved) => Promise.resolve(resolved),
  );
}

describe('withResolvedLink', () => {
  it('creates the vacancy the first time it is saved', async () => {
    const { link, created } = await resolve(JOB_PAGE);

    expect(created).toBe(true);
    expect(link.previewStatus).toBe('pending');
    expect(link.dedupeKey).toBe('linkedin:3811111111');
    expect(repository.size).toBe(1);
  });

  it('upserts by dedupe key: the same vacancy with two urls is one link', async () => {
    const first = await resolve(JOB_PAGE, ANA);
    const second = await resolve(SEARCH_PAGE, BETO);

    expect(second.created).toBe(false);
    expect(second.link.id).toBe(first.link.id);
    expect(second.link.originalUrls).toEqual([JOB_PAGE, SEARCH_PAGE]);
    expect(repository.size).toBe(1);
  });

  it('keeps displayUrl and createdBy of whoever saved it first', async () => {
    const first = await resolve(JOB_PAGE, ANA);
    const second = await resolve(SEARCH_PAGE, BETO);

    expect(second.link.displayUrl).toBe(first.link.displayUrl);
    expect(second.link.createdBy).toBe(ANA);
  });

  it('creates two links for two vacancies of the same platform', async () => {
    await resolve(JOB_PAGE);
    const other = await resolve('https://www.linkedin.com/jobs/view/3822222222/');

    expect(other.created).toBe(true);
    expect(repository.size).toBe(2);
  });

  it('dedupes an unknown platform by its normalized url', async () => {
    const first = await resolve('https://empresa.example/careers/backend');
    const same = await resolve(
      'HTTP://WWW.Empresa.example/careers/backend/?utm_source=wa',
    );

    expect(same.link.id).toBe(first.link.id);
    expect(same.link.dedupeKey).toBe(`url:${first.link.urlHash}`);
    expect(repository.size).toBe(1);
  });

  it('does not repeat a url that was already in the history', async () => {
    await resolve(JOB_PAGE);
    const again = await resolve(JOB_PAGE);

    expect(again.link.originalUrls).toEqual([JOB_PAGE]);
  });

  it('keeps at most 20 urls without ever changing displayUrl', async () => {
    const first = await resolve(JOB_PAGE);
    for (let index = 0; index < 25; index += 1) {
      await resolve(`${SEARCH_PAGE}&ts=${index}`);
    }
    const link = await repository.findById(first.link.id);

    expect(link?.originalUrls).toHaveLength(MAX_ORIGINAL_URLS);
    expect(link?.displayUrl).toBe(first.link.displayUrl);
    expect(repository.size).toBe(1);
  });

  it('runs the work with the resolved link and the session', async () => {
    const seen: unknown[] = [];
    await repository.withResolvedLink(jobLinkDraft(JOB_PAGE), (resolved, session) => {
      seen.push(resolved.link.id, session);
      return Promise.resolve(null);
    });

    expect(seen[1]).toBe(IN_MEMORY_SESSION);
  });

  it('gives back what the work returns', async () => {
    const value = await repository.withResolvedLink(
      jobLinkDraft(JOB_PAGE),
      () => Promise.resolve('shared'),
    );

    expect(value).toBe('shared');
  });
});

describe('findById', () => {
  it('finds a link that exists', async () => {
    const { link } = await resolve(JOB_PAGE);

    expect(await repository.findById(link.id)).toEqual(link);
  });

  it('answers null for an unknown or malformed id', async () => {
    expect(await repository.findById(objectId(99))).toBeNull();
    expect(await repository.findById('no-es-un-id')).toBeNull();
  });

  it('returns copies, so a test cannot alter the stored link', async () => {
    const { link } = await resolve(JOB_PAGE);
    const found = await repository.findById(link.id);

    expect(found).not.toBe(link);
  });
});
