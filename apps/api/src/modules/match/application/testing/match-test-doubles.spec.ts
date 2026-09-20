import { PROVIDER_ELIGIBILITY } from '@linkvault/ai';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ANALYSIS_REPOSITORY } from '../ports/analysis-repository.port';
import { MATCH_CLOCK } from '../ports/clock.port';
import { MATCH_CV_READER } from '../ports/cv-reader.port';
import { MATCH_JOB_READER } from '../ports/job-reader.port';
import {
  InMemoryAnalysisRepository,
  InMemoryMatchCvReader,
  InMemoryMatchJobReader,
  MovableMatchClock,
  StubProviderEligibility,
  sampleDegradedReport,
  sampleReport,
} from './match-test-doubles';

// Los dobles se prueban aparte porque son la base de los tests de casos de uso del grupo 9.

const ANA = '66e9a0000000000000000a01';
const LINK = '66e9a0000000000000000b01';
const CV = '66e9a0000000000000000c01';
const BETO = '66e9a0000000000000000d01';

describe('match application test doubles', () => {
  let clock: MovableMatchClock;
  let analyses: InMemoryAnalysisRepository;

  beforeEach(() => {
    clock = new MovableMatchClock();
    analyses = new InMemoryAnalysisRepository();
  });

  it('createRunning appends MatchRequested and exposes the running analysis', async () => {
    const saved = await analyses.createRunning({
      id: analyses.nextId(),
      userId: ANA,
      linkId: LINK,
      cvId: CV,
      previewVersion: 1,
      promptVersion: 'v1',
      requestedAt: clock.now(),
    });

    expect(saved.status).toBe('running');
    expect(analyses.appendedEvents()).toHaveLength(1);
    expect(analyses.appendedEvents()[0]?.payload).toMatchObject({
      analysisId: saved.id,
    });
  });

  it('createFailure leaves neither document nor event', async () => {
    analyses.createFailure = new Error('boom');

    await expect(
      analyses.createRunning({
        id: analyses.nextId(),
        userId: ANA,
        linkId: LINK,
        cvId: CV,
        previewVersion: 1,
        promptVersion: 'v1',
        requestedAt: clock.now(),
      }),
    ).rejects.toThrow('boom');

    expect(analyses.all()).toEqual([]);
    expect(analyses.appendedEvents()).toEqual([]);
  });

  it('countForQuota counts non-degraded done and in-deadline running', async () => {
    const finishedAt = new Date(clock.now().getTime() + 1_000);
    analyses.seed({
      id: analyses.nextId(),
      userId: ANA,
      linkId: LINK,
      cvId: CV,
      status: 'done',
      step: 'done',
      previewVersion: 1,
      promptVersion: 'v1',
      report: sampleReport(),
      degraded: false,
      consentRequired: false,
      wentExternal: false,
      requestedAt: clock.now(),
      finishedAt,
      durationMs: 1_000,
    });
    analyses.seed({
      id: analyses.nextId(),
      userId: ANA,
      linkId: LINK,
      cvId: CV,
      status: 'done',
      step: 'done-degraded',
      previewVersion: 1,
      promptVersion: 'v1',
      report: sampleDegradedReport('no_providers'),
      degraded: true,
      degradedReason: 'no_providers',
      consentRequired: false,
      wentExternal: false,
      requestedAt: clock.now(),
      finishedAt,
      durationMs: 1_000,
    });
    await analyses.createRunning({
      id: analyses.nextId(),
      userId: ANA,
      linkId: LINK,
      cvId: CV,
      previewVersion: 1,
      promptVersion: 'v1',
      requestedAt: clock.now(),
    });

    const quota = await analyses.countForQuota(
      ANA,
      86_400_000,
      60_000,
      new Date(clock.now().getTime() + 500),
    );

    expect(quota.count).toBe(2);
  });

  it('cv and job readers answer only what belongs to the person asking', async () => {
    const cvs = new InMemoryMatchCvReader();
    cvs.seed(ANA, [
      { id: CV, extractionStatus: 'extracted', isDefault: true },
    ]);
    const jobs = new InMemoryMatchJobReader();
    jobs.seed({
      id: LINK,
      previewVersion: 2,
      title: 'Backend',
      description: 'NestJS',
    });
    jobs.allow(ANA, LINK);

    await expect(cvs.defaultOf(ANA)).resolves.toMatchObject({ id: CV });
    await expect(jobs.canRead(ANA, LINK)).resolves.toBe(true);
    await expect(jobs.canRead(BETO, LINK)).resolves.toBe(false);
  });

  it('StubProviderEligibility can answer ready, empty or unavailable', async () => {
    const eligibility = new StubProviderEligibility();
    await expect(
      eligibility.hasEligibleProvider({
        task: { requires: {}, dataSensitivity: 'personal' },
        aiConsent: { externalProviders: true },
      }),
    ).resolves.toMatchObject({ status: 'ready', hasEligible: true });

    eligibility.setResult({ status: 'unavailable' });
    await expect(
      eligibility.hasEligibleProvider({
        task: { requires: {}, dataSensitivity: 'personal' },
        aiConsent: { externalProviders: true },
      }),
    ).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('match module ports (8.7)', () => {
  it('exports ANALYSIS_REPOSITORY, MATCH_CLOCK, MATCH_CV_READER, MATCH_JOB_READER and PROVIDER_ELIGIBILITY', () => {
    expect(ANALYSIS_REPOSITORY).toBeTypeOf('symbol');
    expect(MATCH_CLOCK).toBeTypeOf('symbol');
    expect(MATCH_CV_READER).toBeTypeOf('symbol');
    expect(MATCH_JOB_READER).toBeTypeOf('symbol');
    expect(PROVIDER_ELIGIBILITY).toBeTypeOf('symbol');
  });

  it('does not declare a limiter token or a refund operation in the module', () => {
    const moduleRoot = join(import.meta.dirname, '..', '..');
    const hits: string[] = [];

    function walk(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) {
          continue;
        }
        const source = readFileSync(path, 'utf8');
        if (
          /Symbol\(\s*['"]MATCH_LIMITER['"]\s*\)|export const MATCH_LIMITER\b|\.refund\s*\(/.test(
            source,
          )
        ) {
          hits.push(path);
        }
      }
    }

    walk(moduleRoot);
    expect(hits).toEqual([]);
  });
});
