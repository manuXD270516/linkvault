import { applicationSchema } from '@linkvault/shared';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import type { ApplicationDocument } from '../infrastructure/application.schemas';
import { toApplication } from '../infrastructure/mongo-application.repository';
import { fitScoreFields, toApplicationResponse } from './application.mapper';

// Spec applications/tracking "Puntuación de encaje reservada" (D11): derivar al mapear, nunca del documento.

const DATE = new Date('2026-09-19T12:00:00.000Z');
const CARD = {
  id: '66e9a0000000000000000001',
  displayUrl: 'https://www.getonbrd.com/jobs/backend-acme',
  platform: 'getonboard' as const,
  previewStatus: 'pending' as const,
};

function sampleDocument(): ApplicationDocument {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    linkId: new mongoose.Types.ObjectId(CARD.id),
    status: 'applied',
    visibility: 'private',
    notes: '',
    appliedAt: DATE,
    statusChangedAt: DATE,
    version: 1,
    createdAt: DATE,
    updatedAt: DATE,
  };
}

describe('application.mapper', () => {
  it('La respuesta no lleva la puntuación', () => {
    const application = toApplication(sampleDocument());
    expect(application).not.toHaveProperty('fitScore');

    const response = toApplicationResponse(application, CARD);

    expect(response).not.toHaveProperty('fitScore');
    expect(response).not.toHaveProperty('fitScoreDegraded');
    expect(response).not.toHaveProperty('userId');
    expect(JSON.stringify(response)).not.toContain('"fitScore":0');
    expect(applicationSchema.parse(response)).toEqual(response);
  });

  it('Un análisis básico puntúa y lo dice', () => {
    const response = toApplicationResponse(toApplication(sampleDocument()), CARD, {
      score: 41,
      degraded: true,
    });

    expect(response.fitScoreDegraded).toBe(true);
    expect(response).not.toHaveProperty('fitScore');
    expect(applicationSchema.parse(response)).toEqual(response);
  });

  it('La postulación no lleva el informe', () => {
    const response = toApplicationResponse(toApplication(sampleDocument()), CARD, {
      score: 78,
      degraded: false,
    });

    expect(response).toMatchObject({
      fitScore: 78,
      fitScoreDegraded: false,
    });
    expect(response).not.toHaveProperty('suggestions');
    expect(response).not.toHaveProperty('matchedSkills');
    expect(response).not.toHaveProperty('missingSkills');
    expect(response).not.toHaveProperty('report');
    expect(response).not.toHaveProperty('cvFragment');
    expect(response).not.toHaveProperty('provider');
    expect(applicationSchema.parse(response)).toEqual(response);
  });

  it.each([
    [undefined, {}],
    [{ score: 78, degraded: false }, { fitScore: 78, fitScoreDegraded: false }],
    [{ score: 41, degraded: true }, { fitScoreDegraded: true }],
  ] as const)('fitScoreFields(%j) → %j', (fit, expected) => {
    expect(fitScoreFields(fit)).toEqual(expected);
  });
});
