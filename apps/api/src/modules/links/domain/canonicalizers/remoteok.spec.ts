import { describe, expect, it } from 'vitest';
import { normalizeUrl } from '../url';
import { canonicalize } from './registry';

/** Canonicalización de una URL real: primero se normaliza, como en producción. */
function canonicalizeRaw(raw: string) {
  const normalized = normalizeUrl(raw);
  expect(normalized).not.toBeNull();
  return canonicalize(normalized?.normalizedUrl ?? '');
}

describe('remoteokCanonicalizer', () => {
  it('reads the id from the canonical discovery form', () => {
    expect(
      canonicalizeRaw(
        'https://remoteok.com/remote-jobs/1130248-customer-support-specialist-acme',
      ),
    ).toEqual({ platform: 'remoteok', externalJobId: '1130248' });
  });

  it.each([
    [
      'https://remoteok.com/remote-jobs/1130248-customer-support-specialist-acme',
      '1130248',
    ],
    [
      'https://www.remoteok.com/remote-jobs/99001-senior-react-engineer-witi/',
      '99001',
    ],
    [
      'https://remoteok.com/remote-jobs/remote-customer-support-specialist-example-company-1130248',
      '1130248',
    ],
    [
      'https://remoteok.com/remote-jobs/42?utm_source=lv',
      '42',
    ],
  ])('reads the job id of %j', (raw, externalJobId) => {
    expect(canonicalizeRaw(raw)).toEqual({
      platform: 'remoteok',
      externalJobId,
    });
  });

  it.each([
    ['https://remoteok.com/remote-jobs'],
    ['https://remoteok.com/remote-jobs/'],
    ['https://remoteok.com/remote-dev-jobs'],
    ['https://remoteok.com.evil.example/remote-jobs/1130248-x'],
    ['https://remoteok.com/remote-jobs/not-a-numeric-id'],
  ])('leaves %j as generic', (raw) => {
    expect(canonicalizeRaw(raw)).toEqual({ platform: 'generic' });
  });
});
