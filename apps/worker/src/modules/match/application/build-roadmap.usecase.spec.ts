import type {
  AiResult,
  BuildRoadmapOutput,
  RunTaskFn,
} from '@linkvault/ai';
import { beforeEach, describe, expect, it } from 'vitest';
import { BuildRoadmapUseCase } from './build-roadmap.usecase';
import type { AnalysisRepository } from './ports/analysis-repository.port';
import type { AiContextReader } from './ports/ai-context-reader.port';
import type { Clock } from './ports/clock.port';
import type { JobReader, MatchJobForAnalysis } from './ports/job-reader.port';
import type {
  ClaimOutcome,
  RoadmapRepository,
} from './ports/roadmap-repository.port';
import type { StudyRoadmap } from '../domain/roadmap';
import type { MatchAnalysis } from '../domain/analysis';
import {
  ANALYSIS_ID,
  CV_ID,
  LINK_ID,
  USER_ID,
  sampleReport,
  sampleRunningAnalysis,
} from './testing/match-test-doubles';

const PAYLOAD = { analysisId: ANALYSIS_ID, userId: USER_ID } as const;

class FakeClock implements Clock {
  constructor(public current = new Date('2026-09-21T12:00:00.000Z')) {}
  now(): Date {
    return this.current;
  }
}

class FakeAnalyses implements AnalysisRepository {
  doc: MatchAnalysis | null = null;
  findById(): Promise<MatchAnalysis | null> {
    return Promise.resolve(this.doc);
  }
  complete(): Promise<boolean> {
    return Promise.resolve(false);
  }
  fail(): Promise<boolean> {
    return Promise.resolve(false);
  }
  recordStep(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

class FakeJobs implements JobReader {
  job: MatchJobForAnalysis | null = {
    id: LINK_ID,
    previewVersion: 1,
    title: 'Backend engineer',
    text: 'TypeScript NestJS',
    skills: [{ name: 'TypeScript', importance: 'must' }],
  };
  read(): Promise<MatchJobForAnalysis | null> {
    return Promise.resolve(this.job);
  }
}

class FakeAiContext implements AiContextReader {
  external = true;
  read() {
    return Promise.resolve({
      aiConsent: { externalProviders: this.external },
      outputLanguage: 'es' as const,
      redactName: true,
      personName: '',
    });
  }
}

class FakeRoadmaps implements RoadmapRepository {
  docs = new Map<string, StudyRoadmap>();
  beginCount = 0;
  runTaskAllowed = true;

  nextId(): string {
    return '66e9c0000000000000000001';
  }

  findByAnalysisId(analysisId: string): Promise<StudyRoadmap | null> {
    return Promise.resolve(this.docs.get(analysisId) ?? null);
  }

  claimOrGet(input: {
    id: string;
    analysisId: string;
    userId: string;
    createdAt: Date;
  }): Promise<ClaimOutcome> {
    const existing = this.docs.get(input.analysisId);
    if (existing !== undefined) {
      if (existing.status === 'generating') {
        return Promise.resolve({
          kind: 'already_generating',
          roadmap: existing,
        });
      }
      return Promise.resolve({ kind: 'already_done' });
    }
    const roadmap: StudyRoadmap = {
      id: input.id,
      analysisId: input.analysisId,
      userId: input.userId,
      status: 'generating',
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.docs.set(input.analysisId, roadmap);
    return Promise.resolve({ kind: 'won', roadmap });
  }

  tryBeginBuild(analysisId: string): Promise<boolean> {
    this.beginCount += 1;
    if (!this.runTaskAllowed) {
      return Promise.resolve(false);
    }
    const doc = this.docs.get(analysisId);
    if (doc === undefined || doc.status !== 'generating') {
      return Promise.resolve(false);
    }
    return Promise.resolve(true);
  }

  markReady(
    analysisId: string,
    items: StudyRoadmap['items'],
    updatedAt: Date,
  ): Promise<boolean> {
    const doc = this.docs.get(analysisId);
    if (doc === undefined) {
      return Promise.resolve(false);
    }
    this.docs.set(analysisId, {
      ...doc,
      status: 'ready',
      items,
      updatedAt,
    });
    return Promise.resolve(true);
  }

  markFailed(analysisId: string, updatedAt: Date): Promise<boolean> {
    const doc = this.docs.get(analysisId);
    if (doc === undefined) {
      return Promise.resolve(false);
    }
    this.docs.set(analysisId, { ...doc, status: 'failed', updatedAt });
    return Promise.resolve(true);
  }
}

function doneWithMissing(): MatchAnalysis {
  const now = new Date('2026-09-21T12:00:00.000Z');
  return {
    ...sampleRunningAnalysis({
      id: ANALYSIS_ID,
      userId: USER_ID,
      linkId: LINK_ID,
      cvId: CV_ID,
      requestedAt: now,
    }),
    status: 'done',
    step: 'done',
    report: sampleReport({
      missingSkills: [{ name: 'TypeScript', importance: 'must' }],
    }),
    degraded: false,
    finishedAt: now,
    durationMs: 100,
  };
}

describe('BuildRoadmapUseCase', () => {
  let analyses: FakeAnalyses;
  let roadmaps: FakeRoadmaps;
  let jobs: FakeJobs;
  let aiContext: FakeAiContext;
  let runCalls: number;
  let useCase: BuildRoadmapUseCase;

  beforeEach(() => {
    analyses = new FakeAnalyses();
    roadmaps = new FakeRoadmaps();
    jobs = new FakeJobs();
    aiContext = new FakeAiContext();
    runCalls = 0;
    const runTask = (async () => {
      runCalls += 1;
      const output: BuildRoadmapOutput = {
        items: [
          {
            skill: 'ObscureSkill',
            priority: 1,
            estimatedWeeks: 2,
            resources: [
              {
                type: 'doc',
                title: 'Guide',
                url: null,
                provider: 'example',
                free: true,
                verified: false,
              },
            ],
          },
        ],
      };
      const result: AiResult<BuildRoadmapOutput> = {
        status: 'success',
        output,
        providerId: 'mock',
        model: 'm',
        promptVersion: 'v1',
        cached: false,
      };
      return result;
    }) as RunTaskFn;
    useCase = new BuildRoadmapUseCase(
      analyses,
      roadmaps,
      jobs,
      aiContext,
      runTask,
      new FakeClock(),
      { timeoutMs: 30_000 },
      { upsert: async () => undefined, delete: async () => undefined },
    );
    analyses.doc = doneWithMissing();
  });

  it('prefers catalog-only and skips runTask when catalog covers skills', async () => {
    // TypeScript is in resources.seed.json — catalog-only path.
    const result = await useCase.execute(PAYLOAD);
    expect(result.kind).toBe('ready');
    expect(runCalls).toBe(0);
    expect(roadmaps.docs.get(ANALYSIS_ID)?.status).toBe('ready');
  });

  it('does not call runTask when tryBeginBuild loses', async () => {
    roadmaps.runTaskAllowed = false;
    // Force LLM path: skill not in catalog
    analyses.doc = {
      ...doneWithMissing(),
      report: sampleReport({
        missingSkills: [{ name: 'ObscureSkillXYZ', importance: 'must' }],
      }),
    };
    const result = await useCase.execute(PAYLOAD);
    expect(result.kind).toBe('abandoned');
    expect(runCalls).toBe(0);
  });

  it('marks failed when runTask returns degraded (consent/quota)', async () => {
    analyses.doc = {
      ...doneWithMissing(),
      report: sampleReport({
        missingSkills: [{ name: 'ObscureSkillXYZ', importance: 'must' }],
      }),
    };
    const degradedRun = (async () => {
      runCalls += 1;
      return {
        status: 'degraded',
        reason: 'consent_required',
      };
    }) as RunTaskFn;
    useCase = new BuildRoadmapUseCase(
      analyses,
      roadmaps,
      jobs,
      aiContext,
      degradedRun,
      new FakeClock(),
      { timeoutMs: 30_000 },
      { upsert: async () => undefined, delete: async () => undefined },
    );
    const result = await useCase.execute(PAYLOAD);
    expect(result.kind).toBe('failed');
    expect(runCalls).toBe(1);
    expect(roadmaps.docs.get(ANALYSIS_ID)?.status).toBe('failed');
  });

  it('abandons when analysis is degraded', async () => {
    analyses.doc = {
      ...doneWithMissing(),
      degraded: true,
      report: sampleReport({
        degraded: true,
        degradedReason: 'no_providers',
        missingSkills: [{ name: 'TypeScript', importance: 'must' }],
        suggestions: [],
      }),
    };
    const result = await useCase.execute(PAYLOAD);
    expect(result.kind).toBe('abandoned');
    expect(roadmaps.docs.size).toBe(0);
  });
});
