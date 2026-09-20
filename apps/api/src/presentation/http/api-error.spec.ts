import { apiErrorCodeSchema, apiErrorResponseSchema } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_MESSAGES,
  API_ERROR_STATUS,
  apiErrorBody,
} from './api-error';

// Tablas del filtro de errores: un código sin estado o sin mensaje respondería `undefined` en tiempo de ejecución, así
// que se comprueba que las dos tablas cubren el contrato entero y que los códigos nuevos de `link-enrichment` traen el
// estado que fija D11.

describe('API_ERROR_STATUS and API_ERROR_MESSAGES', () => {
  it('cover every code of the API contract and nothing else', () => {
    const codes = [...apiErrorCodeSchema.options].sort();

    expect(Object.keys(API_ERROR_STATUS).sort()).toEqual(codes);
    expect(Object.keys(API_ERROR_MESSAGES).sort()).toEqual(codes);
  });

  it.each([
    ['preview_field_unknown', 400],
    ['too_many_attempts', 429],
    ['enrichment_not_retryable', 409],
    ['not_a_job_posting', 422],
    ['extraction_unavailable', 503],
    ['ai_quota_exceeded', 429],
    ['already_owner', 409],
    ['application_not_found', 404],
    ['application_conflict', 409],
    ['comment_not_found', 404],
    ['cv_not_found', 404],
    ['unsupported_file_type', 415],
    ['file_too_large', 413],
    ['too_many_cvs', 409],
  ] as const)('answers %s with %i', (code, status) => {
    expect(API_ERROR_STATUS[code]).toBe(status);
    expect(API_ERROR_MESSAGES[code]).not.toBe('');
  });

  it('keeps the unsupported media type message generic, now that two formats share it', () => {
    // `POST /api/cv` acepta `multipart/form-data` y el resto JSON: el mensaje no puede decir que el cuerpo deba ser
    // JSON sin mentirle a una de las dos.
    expect(API_ERROR_MESSAGES.unsupported_media_type).not.toMatch(/json/i);
    expect(API_ERROR_STATUS.unsupported_media_type).toBe(415);
  });

  it('keeps the unsupported file type apart from the unsupported body format', () => {
    expect(API_ERROR_MESSAGES.unsupported_file_type).toMatch(/PDF/);
    expect(API_ERROR_MESSAGES.unsupported_file_type).not.toBe(
      API_ERROR_MESSAGES.unsupported_media_type,
    );
  });

  it('names the unknown field of a preview edit without leaking its value', () => {
    const body = apiErrorBody('preview_field_unknown', ['image']);

    expect(apiErrorResponseSchema.parse(body)).toEqual({
      code: 'preview_field_unknown',
      message: expect.any(String),
      fields: ['image'],
    });
  });

  it('says why a link cannot be read again without naming the site', () => {
    const body = apiErrorBody('enrichment_not_retryable');

    expect(apiErrorResponseSchema.parse(body)).toEqual({
      code: 'enrichment_not_retryable',
      message: expect.any(String),
    });
    expect(body.message).not.toMatch(/http/i);
  });
});
