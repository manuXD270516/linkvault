import { describe, expect, it, vi } from 'vitest';
import { SearchOutboxEmitter } from './search-outbox-emitter';
import type { Outbox } from '../../../infrastructure/outbox/outbox.port';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import {
  SEARCH_DELETE_EVENT_TYPE,
  SEARCH_UPSERT_EVENT_TYPE,
} from '@linkvault/shared';

describe('SearchOutboxEmitter', () => {
  const session = {};

  it('writes SearchUpsert when FEATURE_SEARCH=true', async () => {
    const appended: { type: string }[] = [];
    const outbox: Outbox = {
      append: async (event) => {
        appended.push(event);
      },
    };
    const emitter = new SearchOutboxEmitter(outbox, {
      FEATURE_SEARCH: true,
    } as ApiConfig);
    await emitter.upsert(
      {
        docType: 'job_preview',
        aggregateId: 'l1',
        reason: 'preview_updated',
        fingerprint: 'fp',
      },
      session,
    );
    expect(appended).toHaveLength(1);
    expect(appended[0]?.type).toBe(SEARCH_UPSERT_EVENT_TYPE);
  });

  it('writes zero Search* rows when FEATURE_SEARCH=false', async () => {
    const append = vi.fn();
    const outbox: Outbox = { append };
    const emitter = new SearchOutboxEmitter(outbox, {
      FEATURE_SEARCH: false,
    } as ApiConfig);
    await emitter.upsert(
      {
        docType: 'cv',
        aggregateId: 'c1',
        reason: 'cv_upsert',
        fingerprint: 'fp',
      },
      session,
    );
    await emitter.delete(
      {
        docType: 'cv',
        aggregateId: 'c1',
        reason: 'aggregate_deleted',
      },
      session,
    );
    expect(append).not.toHaveBeenCalled();
  });

  it('writes SearchDelete when enabled', async () => {
    const appended: { type: string }[] = [];
    const outbox: Outbox = {
      append: async (event) => {
        appended.push(event);
      },
    };
    const emitter = new SearchOutboxEmitter(outbox, {
      FEATURE_SEARCH: true,
    } as ApiConfig);
    await emitter.delete(
      {
        docType: 'group_comment',
        aggregateId: 'cm1',
        reason: 'aggregate_deleted',
      },
      session,
    );
    expect(appended[0]?.type).toBe(SEARCH_DELETE_EVENT_TYPE);
  });
});
