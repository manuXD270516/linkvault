import { describe, expect, it } from 'vitest';
import { buildSaveLinkRequest, mapSaveOutcome } from './save-link';

describe('buildSaveLinkRequest', () => {
  it('omite groupId cuando el destino es privado', () => {
    expect(buildSaveLinkRequest(' https://example.com/job ')).toEqual({
      url: 'https://example.com/job',
    });
    expect(buildSaveLinkRequest('https://example.com/job', null)).toEqual({
      url: 'https://example.com/job',
    });
    expect(buildSaveLinkRequest('https://example.com/job', '')).toEqual({
      url: 'https://example.com/job',
    });
  });

  it('incluye groupId cuando el usuario elige un grupo', () => {
    expect(buildSaveLinkRequest('https://example.com/job', 'g1')).toEqual({
      url: 'https://example.com/job',
      groupId: 'g1',
    });
  });
});

describe('mapSaveOutcome', () => {
  it('mapea un alta nueva a saveSuccess sin prometer preview', () => {
    expect(
      mapSaveOutcome({
        shared: 'created',
        alreadyInGroups: [],
      }),
    ).toEqual({
      kind: 'saved',
      primaryMessageKey: 'saveSuccess',
      alreadyInGroupNames: [],
    });
  });

  it('distingue already_there de un alta nueva', () => {
    expect(
      mapSaveOutcome({
        shared: 'already_there',
        alreadyInGroups: [{ name: 'Equipo' }],
      }),
    ).toEqual({
      kind: 'already_there',
      primaryMessageKey: 'saveAlreadyThere',
      sharerName: undefined,
      alreadyInGroupNames: ['Equipo'],
    });
  });

  it('incluye el nombre de quien compartió cuando viene sharedBy', () => {
    expect(
      mapSaveOutcome({
        shared: 'already_there',
        sharedBy: { displayName: 'Ana' },
        alreadyInGroups: [],
      }),
    ).toEqual({
      kind: 'already_there',
      primaryMessageKey: 'saveAlreadyThereNamed',
      sharerName: 'Ana',
      alreadyInGroupNames: [],
    });
  });
});
