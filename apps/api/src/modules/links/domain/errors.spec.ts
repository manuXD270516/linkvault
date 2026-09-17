import { apiErrorCodeSchema } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  InvalidCursor,
  InvalidUrl,
  LinkNotFound,
  LinkRemovalForbidden,
  LinksError,
  TextTooLong,
} from './errors';

const errors = [
  new InvalidUrl(),
  new TextTooLong(),
  new LinkNotFound(),
  new LinkRemovalForbidden(),
  new InvalidCursor(),
];

describe('links domain errors', () => {
  it.each([
    [new InvalidUrl(), 'invalid_url'],
    [new TextTooLong(), 'text_too_long'],
    [new LinkNotFound(), 'link_not_found'],
    [new LinkRemovalForbidden(), 'forbidden'],
    [new InvalidCursor(), 'validation_error'],
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
    ]);
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
