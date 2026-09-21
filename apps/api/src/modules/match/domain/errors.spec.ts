import { apiErrorCodeSchema } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  AnalysisNotFound,
  CvNotReadable,
  CvNotReady,
  JobNotReady,
  MatchError,
  NoCv,
  RoadmapNotEligible,
  TooManyAnalysisAttempts,
} from './errors';

describe('the domain errors of match', () => {
  const errors: readonly MatchError[] = [
    new AnalysisNotFound(),
    new NoCv(),
    new CvNotReady(),
    new CvNotReadable(),
    new JobNotReady(),
    new RoadmapNotEligible(),
    new TooManyAnalysisAttempts(900),
  ];

  it.each(errors.map((error) => [error.name, error] as const))(
    '%s carries a code of the API contract',
    (_name, error) => {
      expect(apiErrorCodeSchema.options).toContain(error.code);
    },
  );

  it('maps each error to the code the spec asks for', () => {
    expect(new AnalysisNotFound().code).toBe('analysis_not_found');
    expect(new NoCv().code).toBe('no_cv');
    expect(new CvNotReady().code).toBe('cv_not_ready');
    expect(new CvNotReadable().code).toBe('cv_not_readable');
    expect(new JobNotReady().code).toBe('job_not_ready');
    expect(new RoadmapNotEligible().code).toBe('roadmap_not_eligible');
    expect(new TooManyAnalysisAttempts(60).code).toBe('too_many_attempts');
  });

  it('carries the wait in the exhausted window', () => {
    expect(new TooManyAnalysisAttempts(742).retryAfterSeconds).toBe(742);
  });

  it.each(errors.map((error) => [error.name, error] as const))(
    '%s says nothing about the CV text or the job',
    (_name, error) => {
      expect(error.message).not.toMatch(/curriculum|vacante|prompt|sk-/i);
    },
  );
});
