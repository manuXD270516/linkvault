import {
  ANALYSIS_STEP_CHANNEL,
  analysisStepEvent,
  analysisStepEventSchema,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  RedisAnalysisStepNotifier,
  type AnalysisStepNotifierLogger,
  type AnalysisStepPublisherClient,
} from './redis-analysis-step-notifier';

// Adaptador ANALYSIS_STEP_NOTIFIER (tarea 3.1): payload cerrado, best-effort, sin tumbar el análisis.

class RecordingRedis implements AnalysisStepPublisherClient {
  readonly published: { channel: string; message: string }[] = [];

  publish(channel: string, message: string): Promise<number> {
    this.published.push({ channel, message });
    return Promise.resolve(1);
  }
}

class BrokenRedis implements AnalysisStepPublisherClient {
  publish(): Promise<number> {
    return Promise.reject(new Error('Connection is closed.'));
  }
}

class RecordingLogger implements AnalysisStepNotifierLogger {
  readonly warnings: string[] = [];

  warn(message: string): void {
    this.warnings.push(message);
  }
}

const EVENT = analysisStepEvent({
  analysisId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  linkId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  step: 'critiquing-suggestions',
  userId: 'cccccccccccccccccccccccc',
});

describe('RedisAnalysisStepNotifier', () => {
  it('publishes a closed AnalysisStep.v1 payload on the shared channel', async () => {
    const redis = new RecordingRedis();

    await new RedisAnalysisStepNotifier(redis, new RecordingLogger()).publish(
      EVENT,
    );

    expect(redis.published).toHaveLength(1);
    expect(redis.published[0]?.channel).toBe(ANALYSIS_STEP_CHANNEL);
    const parsed = analysisStepEventSchema.parse(
      JSON.parse(redis.published[0]?.message ?? '{}'),
    );
    expect(parsed).toEqual(EVENT);
    expect(Object.keys(parsed.payload).sort()).toEqual([
      'analysisId',
      'linkId',
      'step',
      'userId',
    ]);
  });

  it('does not put CV text, suggestions or score in the message', async () => {
    const redis = new RecordingRedis();
    const withCv = analysisStepEvent({
      ...EVENT.payload,
      // El schema no admite campos de más; el aviso se construye solo con ids y paso.
    });

    await new RedisAnalysisStepNotifier(redis).publish(withCv);

    const raw = redis.published[0]?.message ?? '';
    expect(raw).not.toContain('Incluir NestJS');
    expect(raw).not.toContain('cvFragment');
    expect(raw).not.toContain('judgeScore');
    expect(raw).not.toMatch(/"suggestions"/);
  });

  it('swallows Redis failures without throwing', async () => {
    const logger = new RecordingLogger();

    await expect(
      new RedisAnalysisStepNotifier(new BrokenRedis(), logger).publish(EVENT),
    ).resolves.toBeUndefined();
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toContain('could not announce');
  });

  it('warns once per outage streak', async () => {
    const logger = new RecordingLogger();
    const notifier = new RedisAnalysisStepNotifier(new BrokenRedis(), logger);

    await notifier.publish(EVENT);
    await notifier.publish(EVENT);

    expect(logger.warnings).toHaveLength(1);
  });
});
