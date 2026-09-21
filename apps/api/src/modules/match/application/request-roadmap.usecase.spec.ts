import { beforeEach, describe, expect, it } from 'vitest';
import { AnalysisNotFound, RoadmapNotEligible } from '../domain/errors';
import type { MatchAnalysis } from '../domain/analysis';
import {
  InMemoryAnalysisRepository,
  MovableMatchClock,
  sampleReport,
} from './testing/match-test-doubles';
import { InMemoryRoadmapRepository } from './testing/roadmap-test-doubles';
import { RequestRoadmap } from './request-roadmap.usecase';
import { GetRoadmap } from './get-roadmap.usecase';
import { GetRoadmapMarkdown } from './get-roadmap-markdown.usecase';

const ANA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const BETO = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ANALYSIS_ID = 'cccccccccccccccccccccccc';
const LINK_ID = 'dddddddddddddddddddddddd';
const CV_ID = 'eeeeeeeeeeeeeeeeeeeeeeee';

function doneAnalysis(
  overrides: Partial<MatchAnalysis> = {},
): MatchAnalysis {
  const now = new Date('2026-09-21T12:00:00.000Z');
  return {
    id: ANALYSIS_ID,
    userId: ANA,
    linkId: LINK_ID,
    cvId: CV_ID,
    status: 'done',
    step: 'done',
    previewVersion: 1,
    promptVersion: 'v1',
    report: sampleReport({
      missingSkills: [{ name: 'TypeScript', importance: 'must' }],
    }),
    degraded: false,
    consentRequired: false,
    wentExternal: false,
    requestedAt: now,
    finishedAt: now,
    durationMs: 1_000,
    ...overrides,
  };
}

describe('RequestRoadmap', () => {
  let analyses: InMemoryAnalysisRepository;
  let roadmaps: InMemoryRoadmapRepository;
  let clock: MovableMatchClock;
  let useCase: RequestRoadmap;

  beforeEach(() => {
    analyses = new InMemoryAnalysisRepository();
    roadmaps = new InMemoryRoadmapRepository();
    clock = new MovableMatchClock();
    useCase = new RequestRoadmap(analyses, roadmaps, clock);
    analyses.seed(doneAnalysis());
  });

  it('claims and accepts when eligible', async () => {
    const result = await useCase.execute(ANA, ANALYSIS_ID);
    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') {
      return;
    }
    expect(result.body.status).toBe('generating');
    expect(roadmaps.outbox).toHaveLength(1);
  });

  it('reuses an existing roadmap without a second outbox event', async () => {
    roadmaps.seedGenerating(ANALYSIS_ID, ANA);
    const result = await useCase.execute(ANA, ANALYSIS_ID);
    expect(result.outcome).toBe('reused');
    expect(roadmaps.outbox).toHaveLength(0);
  });

  it('rejects ownership of another user', async () => {
    await expect(useCase.execute(BETO, ANALYSIS_ID)).rejects.toBeInstanceOf(
      AnalysisNotFound,
    );
    expect(roadmaps.documents.size).toBe(0);
  });

  it('rejects degraded analyses', async () => {
    analyses.seed(
      doneAnalysis({
        report: sampleReport({
          degraded: true,
          degradedReason: 'no_providers',
          missingSkills: [{ name: 'TypeScript', importance: 'must' }],
          suggestions: [],
        }),
        degraded: true,
        degradedReason: 'no_providers',
      }),
    );
    await expect(useCase.execute(ANA, ANALYSIS_ID)).rejects.toBeInstanceOf(
      RoadmapNotEligible,
    );
  });

  it('rejects empty missingSkills', async () => {
    analyses.seed(
      doneAnalysis({
        report: sampleReport({ missingSkills: [] }),
      }),
    );
    await expect(useCase.execute(ANA, ANALYSIS_ID)).rejects.toBeInstanceOf(
      RoadmapNotEligible,
    );
  });

  it('second POST reuses without a second outbox event', async () => {
    const first = await useCase.execute(ANA, ANALYSIS_ID);
    expect(first.outcome).toBe('accepted');
    const second = await useCase.execute(ANA, ANALYSIS_ID);
    expect(second.outcome).toBe('reused');
    expect(roadmaps.documents.size).toBe(1);
    expect(roadmaps.outbox.length).toBe(1);
  });
});

describe('GetRoadmap / GetRoadmapMarkdown ownership', () => {
  let analyses: InMemoryAnalysisRepository;
  let roadmaps: InMemoryRoadmapRepository;

  beforeEach(() => {
    analyses = new InMemoryAnalysisRepository();
    roadmaps = new InMemoryRoadmapRepository();
    analyses.seed(doneAnalysis());
  });

  it('Beto cannot read Ana roadmap', async () => {
    roadmaps.seedGenerating(ANALYSIS_ID, ANA);
    const get = new GetRoadmap(analyses, roadmaps);
    await expect(get.execute(BETO, ANALYSIS_ID)).rejects.toBeInstanceOf(
      AnalysisNotFound,
    );
  });

  it('exports markdown only when ready', async () => {
    roadmaps.seedGenerating(ANALYSIS_ID, ANA);
    const md = new GetRoadmapMarkdown(analyses, roadmaps);
    await expect(md.execute(ANA, ANALYSIS_ID)).rejects.toBeInstanceOf(
      AnalysisNotFound,
    );

    roadmaps.documents.clear();
    roadmaps.seedReady(ANALYSIS_ID, ANA, [
      {
        skill: 'TypeScript',
        priority: 1,
        estimatedWeeks: 2,
        resources: [
          {
            type: 'doc',
            title: 'Handbook',
            url: 'https://www.typescriptlang.org/docs/',
            provider: 'typescriptlang.org',
            free: true,
            verified: true,
          },
        ],
      },
    ]);
    const text = await md.execute(ANA, ANALYSIS_ID);
    expect(text).toContain('# Study roadmap');
    expect(text).toContain('TypeScript');
  });
});

describe('cascade delete roadmaps with analyses', () => {
  it('removeByAnalysisIds clears roadmaps for those analyses', async () => {
    const analyses = new InMemoryAnalysisRepository();
    const roadmaps = new InMemoryRoadmapRepository();
    analyses.seed(doneAnalysis());
    roadmaps.seedGenerating(ANALYSIS_ID, ANA);

    const ids = await analyses.findIdsByCv(ANA, CV_ID, {} as never);
    expect(ids).toEqual([ANALYSIS_ID]);
    const removed = await roadmaps.removeByAnalysisIds(ids, {} as never);
    expect(removed).toBe(1);
    expect(roadmaps.documents.size).toBe(0);
  });
});
