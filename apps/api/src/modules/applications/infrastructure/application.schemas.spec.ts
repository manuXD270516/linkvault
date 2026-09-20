import { describe, expect, it } from 'vitest';
import { applicationSchema } from './application.schemas';

// Schema tabular de la postulación (tarea 12.1): ningún campo de puntuación.

describe('applicationSchema', () => {
  it.each(['fitScore', 'fitScoreDegraded', 'score', 'degraded'] as const)(
    'does not declare %s on the persisted document',
    (field) => {
      expect(applicationSchema.path(field)).toBeUndefined();
      expect(Object.keys(applicationSchema.paths)).not.toContain(field);
    },
  );
});
