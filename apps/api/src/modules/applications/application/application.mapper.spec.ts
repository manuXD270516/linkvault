import { applicationSchema } from '@linkvault/shared';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import type { ApplicationDocument } from '../infrastructure/application.schemas';
import { toApplication } from '../infrastructure/mongo-application.repository';
import { toApplicationResponse } from './application.mapper';

// "La respuesta no lleva la puntuación" (spec applications/tracking, "Puntuación de encaje reservada"; D9).

const DATE = new Date('2026-09-19T12:00:00.000Z');

describe('application.mapper', () => {
  it('La respuesta no lleva la puntuación', () => {
    const document: ApplicationDocument = {
      _id: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
      linkId: new mongoose.Types.ObjectId(),
      status: 'applied',
      visibility: 'private',
      notes: '',
      appliedAt: DATE,
      statusChangedAt: DATE,
      fitScore: 80,
      version: 1,
      createdAt: DATE,
      updatedAt: DATE,
    };
    const application = toApplication(document);
    expect(application.fitScore).toBe(80);

    const response = toApplicationResponse(application, {
      id: application.linkId,
      displayUrl: 'https://www.getonbrd.com/jobs/backend-acme',
      platform: 'getonboard',
      previewStatus: 'pending',
    });

    expect(response).not.toHaveProperty('fitScore');
    expect(response).not.toHaveProperty('userId');
    expect(applicationSchema.parse(response)).toEqual(response);
  });
});
