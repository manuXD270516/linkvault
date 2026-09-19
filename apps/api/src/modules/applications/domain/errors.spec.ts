import { apiErrorCodeSchema } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  ApplicationConflict,
  ApplicationNotFound,
  ApplicationsError,
  InvalidAppliedAt,
  InvalidApplicationField,
  InvalidNotes,
  InvalidStageLabel,
  TrackedLinkNotFound,
  TrackersGroupNotFound,
} from './errors';
import { normalizeStageLabel, STAGE_LABEL_MAX_LENGTH } from './stage-label';

describe('applications errors', () => {
  it.each([
    [new ApplicationNotFound(), 'application_not_found'],
    [new ApplicationConflict(), 'application_conflict'],
    [new TrackedLinkNotFound(), 'link_not_found'],
    [new TrackersGroupNotFound(), 'group_not_found'],
    [new InvalidAppliedAt(), 'validation_error'],
    [new InvalidStageLabel(), 'validation_error'],
    [new InvalidNotes(), 'validation_error'],
  ] as const)('%s carries a code of the API contract', (error, code) => {
    expect(error).toBeInstanceOf(ApplicationsError);
    expect(error.code).toBe(code);
    expect(apiErrorCodeSchema.options).toContain(error.code);
  });

  it.each([
    [new InvalidAppliedAt(), 'appliedAt'],
    [new InvalidStageLabel(), 'stageLabel'],
    [new InvalidNotes(), 'notes'],
  ] as const)('%s names its field', (error, field) => {
    expect(error).toBeInstanceOf(InvalidApplicationField);
    expect(error.field).toBe(field);
  });
});

describe('normalizeStageLabel', () => {
  it.each([
    ['  Prueba técnica ', 'Prueba técnica'],
    ['a'.repeat(STAGE_LABEL_MAX_LENGTH), 'a'.repeat(STAGE_LABEL_MAX_LENGTH)],
  ])('keeps %j as %j', (raw, label) => {
    expect(normalizeStageLabel(raw)).toBe(label);
  });

  it.each(['', '   ', 'a'.repeat(STAGE_LABEL_MAX_LENGTH + 1)])(
    'rejects %j',
    (raw) => {
      expect(() => normalizeStageLabel(raw)).toThrow(InvalidStageLabel);
    },
  );
});
