import { apiErrorCodeSchema } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  AiQuotaExceeded,
  CommentDeletionForbidden,
  CommentNotFound,
  CommentsGroupNotFound,
  InvalidCommentText,
  InvalidExpiresAt,
  InvalidLinkField,
  InvalidShareNote,
  NoteRemovalForbidden,
  EnrichmentNotRetryable,
  ExtractionUnavailable,
  InvalidCursor,
  InvalidUrl,
  LinkNotFound,
  LinkRemovalForbidden,
  LinksError,
  NotAJobPosting,
  PreviewFieldUnknown,
  PublicShareForbidden,
  PublicShareNotFound,
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
  new NotAJobPosting(),
  new ExtractionUnavailable(60),
  new AiQuotaExceeded(86_400),
  new InvalidCommentText(),
  new InvalidShareNote(),
  new CommentNotFound(),
  new CommentDeletionForbidden(),
  new NoteRemovalForbidden(),
  new CommentsGroupNotFound(),
  new PublicShareForbidden(),
  new PublicShareNotFound(),
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
    [new NotAJobPosting(), 'not_a_job_posting'],
    [new ExtractionUnavailable(60), 'extraction_unavailable'],
    [new AiQuotaExceeded(86_400), 'ai_quota_exceeded'],
    [new InvalidCommentText(), 'validation_error'],
    [new InvalidShareNote(), 'validation_error'],
    [new CommentNotFound(), 'comment_not_found'],
    [new CommentDeletionForbidden(), 'forbidden'],
    [new NoteRemovalForbidden(), 'forbidden'],
    [new CommentsGroupNotFound(), 'group_not_found'],
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
      'NotAJobPosting',
      'ExtractionUnavailable',
      'AiQuotaExceeded',
      'InvalidCommentText',
      'InvalidShareNote',
      'CommentNotFound',
      'CommentDeletionForbidden',
      'NoteRemovalForbidden',
      'CommentsGroupNotFound',
      'PublicShareForbidden',
      'PublicShareNotFound',
    ]);
  });

  it('names the preview field that does not exist, so nobody has to guess', () => {
    expect(new PreviewFieldUnknown('image').field).toBe('image');
  });

  it('rounds the wait of the retry limit up to a whole second, never below one', () => {
    expect(new TooManyLinkAttempts(41.2).retryAfterSeconds).toBe(42);
    expect(new TooManyLinkAttempts(0).retryAfterSeconds).toBe(1);
    expect(new ExtractionUnavailable(0.5).retryAfterSeconds).toBe(1);
    expect(new AiQuotaExceeded(86_400).retryAfterSeconds).toBe(86_400);
  });

  it('names the field of the errors that come from a request field', () => {
    expect(new InvalidUrl().field).toBe('url');
    expect(new TextTooLong().field).toBe('text');
    expect(new InvalidCursor().field).toBe('cursor');
    expect(new InvalidCommentText()).toBeInstanceOf(InvalidLinkField);
    expect(new InvalidShareNote()).toBeInstanceOf(InvalidLinkField);
    expect(new InvalidExpiresAt()).toBeInstanceOf(InvalidLinkField);
    expect(new InvalidCommentText().field).toBe('text');
    expect(new InvalidShareNote().field).toBe('note');
    expect(new InvalidExpiresAt().field).toBe('expiresAt');
  });

  it('el enlace público responde forbidden y link_not_found, sin códigos nuevos', () => {
    expect(new PublicShareForbidden().code).toBe('forbidden');
    expect(new PublicShareNotFound().code).toBe('link_not_found');
    expect(new PublicShareNotFound().message).toBe(new LinkNotFound().message);
  });

  it('carries no url, imported text or cursor in the message', () => {
    for (const error of errors) {
      expect(error.message).not.toMatch(/https?:\/\//);
    }
  });
});
