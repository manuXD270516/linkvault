import { apiErrorCodeSchema } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  EnrichmentNotRetryable,
  InvalidCursor,
  InvalidUrl,
  LinkNotFound,
  LinkRemovalForbidden,
  LinksError,
  PreviewFieldUnknown,
  TextTooLong,
  TooManyLinkAttempts,
} from './errors';

const errors = [
  new InvalidUrl(),
  new TextTooLong(),
  new LinkNotFound(),
  new LinkRemovalForbidden(),
  new InvalidCursor(),
  new PreviewFieldUnknown('image'),
  new EnrichmentNotRetryable(),
  new TooManyLinkAttempts(30),
];

describe('links domain errors', () => {
  it.each([
    [new InvalidUrl(), 'invalid_url'],
    [new TextTooLong(), 'text_too_long'],
    [new LinkNotFound(), 'link_not_found'],
    [new LinkRemovalForbidden(), 'forbidden'],
    [new InvalidCursor(), 'validation_error'],
    [new PreviewFieldUnknown('image'), 'preview_field_unknown'],
    [new EnrichmentNotRetryable(), 'enrichment_not_retryable'],
    [new TooManyLinkAttempts(30), 'too_many_attempts'],
  ] as const)('%s carries the API code %s', (error, code) => {
    expect(error).toBeInstanceOf(LinksError);
    expect(error.code).toBe(code);
  });

  it('only uses codes of the shared error contract', () => {
    for (const error of errors) {
      expect(apiErrorCodeSchema.options).toContain(error.code);
    }
  });

  it('keeps the error name for the logs', () => {
    expect(errors.map((error) => error.name)).toEqual([
      'InvalidUrl',
      'TextTooLong',
      'LinkNotFound',
      'LinkRemovalForbidden',
      'InvalidCursor',
      'PreviewFieldUnknown',
      'EnrichmentNotRetryable',
      'TooManyLinkAttempts',
    ]);
  });

  it('names the preview field that does not exist, so nobody has to guess', () => {
    expect(new PreviewFieldUnknown('image').field).toBe('image');
  });

  it('rounds the wait of the retry limit up to a whole second, never below one', () => {
    expect(new TooManyLinkAttempts(41.2).retryAfterSeconds).toBe(42);
    expect(new TooManyLinkAttempts(0).retryAfterSeconds).toBe(1);
  });

  it('names the field of the errors that come from a request field', () => {
    expect(new InvalidUrl().field).toBe('url');
    expect(new TextTooLong().field).toBe('text');
    expect(new InvalidCursor().field).toBe('cursor');
  });

  it('carries no url, imported text or cursor in the message', () => {
    for (const error of errors) {
      expect(error.message).not.toMatch(/https?:\/\//);
    }
  });
});
