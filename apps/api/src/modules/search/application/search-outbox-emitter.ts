import type {
  SearchDeletePayload,
  SearchUpsertPayload,
  SearchUpsertReason,
  SearchDeleteReason,
  SearchDocType,
} from '@linkvault/shared';
import {
  searchContentHash,
  searchDeleteEvent,
  searchUpsertEvent,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import { OUTBOX, type Outbox } from '../../../infrastructure/outbox/outbox.port';
import type { TransactionSession } from '../../../infrastructure/outbox/transaction-session';

/**
 * Emisor de SearchUpsert/Delete (D1 / D4). Solo escribe outbox si FEATURE_SEARCH=true.
 * Nunca llama a Meili: el worker indexa de forma asíncrona.
 */
@Injectable()
export class SearchOutboxEmitter {
  constructor(
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(APP_CONFIG) private readonly config: ApiConfig,
  ) {}

  get enabled(): boolean {
    return this.config.FEATURE_SEARCH;
  }

  async upsert(
    input: {
      readonly docType: SearchDocType;
      readonly aggregateId: string;
      readonly reason: SearchUpsertReason;
      readonly fingerprint: string;
    },
    session: TransactionSession,
  ): Promise<void> {
    if (!this.config.FEATURE_SEARCH) return;
    const payload: SearchUpsertPayload = {
      docType: input.docType,
      aggregateId: input.aggregateId,
      reason: input.reason,
      contentHash: searchContentHash(input.fingerprint),
    };
    await this.outbox.append(searchUpsertEvent(payload), session);
  }

  async delete(
    input: {
      readonly docType: SearchDocType;
      readonly aggregateId: string;
      readonly reason: SearchDeleteReason;
    },
    session: TransactionSession,
  ): Promise<void> {
    if (!this.config.FEATURE_SEARCH) return;
    const payload: SearchDeletePayload = {
      docType: input.docType,
      aggregateId: input.aggregateId,
      reason: input.reason,
    };
    await this.outbox.append(searchDeleteEvent(payload), session);
  }
}
