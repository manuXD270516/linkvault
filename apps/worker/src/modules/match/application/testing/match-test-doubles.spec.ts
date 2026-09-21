import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_REPOSITORY,
} from '../ports/analysis-repository.port';
import { AI_CONTEXT_READER } from '../ports/ai-context-reader.port';
import { MATCH_CLOCK } from '../ports/clock.port';
import { CV_TEXT_READER } from '../ports/cv-text-reader.port';
import { JOB_READER } from '../ports/job-reader.port';
import {
  ANALYSIS_ID,
  CV_ID,
  InMemoryAiContextReader,
  InMemoryAnalysisRepository,
  InMemoryCvTextReader,
  InMemoryJobReader,
  LINK_ID,
  MovableClock,
  USER_ID,
  sampleJob,
  sampleRunningAnalysis,
} from './match-test-doubles';

describe('match test doubles', () => {
  it('exports the five port tokens', () => {
    expect(ANALYSIS_REPOSITORY).toBeTypeOf('symbol');
    expect(CV_TEXT_READER).toBeTypeOf('symbol');
    expect(JOB_READER).toBeTypeOf('symbol');
    expect(AI_CONTEXT_READER).toBeTypeOf('symbol');
    expect(MATCH_CLOCK).toBeTypeOf('symbol');
  });

  it('seeds and completes a running analysis in memory', async () => {
    const clock = new MovableClock();
    const analyses = new InMemoryAnalysisRepository();
    analyses.clock = clock;
    analyses.seed(
      sampleRunningAnalysis({
        id: ANALYSIS_ID,
        userId: USER_ID,
        linkId: LINK_ID,
        cvId: CV_ID,
        requestedAt: clock.now(),
      }),
    );

    const written = await analyses.complete(ANALYSIS_ID, {
      step: 'done',
      report: {
        score: 50,
        matchedSkills: [],
        missingSkills: [],
        suggestions: [],
        degraded: false,
      },
      promptVersion: 'v1',
      previewVersion: 1,
      degraded: false,
      consentRequired: false,
      wentExternal: false,
      finishedAt: clock.now(),
      durationMs: 0,
    });

    expect(written).toBe(true);
    expect((await analyses.findById(ANALYSIS_ID))?.status).toBe('done');
  });

  it('reads CV text, job and AI context from the doubles', async () => {
    const cvs = new InMemoryCvTextReader().with(CV_ID, USER_ID, {
      kind: 'ready',
      text: 'hola',
    });
    const jobs = new InMemoryJobReader().with(sampleJob());
    const ai = new InMemoryAiContextReader().with(USER_ID, {
      aiConsent: { externalProviders: true },
      personName: 'Ana',
    });

    expect(await cvs.read(CV_ID, USER_ID)).toEqual({
      kind: 'ready',
      text: 'hola',
    });
    expect(await jobs.read(LINK_ID)).toMatchObject({ title: 'Backend Engineer' });
    expect((await ai.read(USER_ID)).aiConsent.externalProviders).toBe(true);
  });
});
