import { isApiFailureCode, type RequestFailure } from './api-error';

describe('isApiFailureCode', () => {
  it('isApiFailureCode matches by code whatever the status', () => {
    const conflict: RequestFailure = { kind: 'api', status: 409, code: 'no_cv', retryAfterMinutes: null };
    const unprocessable: RequestFailure = { kind: 'api', status: 422, code: 'no_cv', retryAfterMinutes: null };
    const other: RequestFailure = { kind: 'api', status: 409, code: 'cv_not_ready', retryAfterMinutes: null };

    expect(isApiFailureCode(conflict, 'no_cv')).toBe(true);
    expect(isApiFailureCode(unprocessable, 'no_cv')).toBe(true);
    expect(isApiFailureCode(other, 'no_cv')).toBe(false);
  });

  it('isApiFailureCode is false for offline and unknown failures', () => {
    expect(isApiFailureCode({ kind: 'offline' }, 'no_cv')).toBe(false);
    expect(isApiFailureCode({ kind: 'unknown' }, 'no_cv')).toBe(false);
    expect(isApiFailureCode(null, 'no_cv')).toBe(false);
  });
});
