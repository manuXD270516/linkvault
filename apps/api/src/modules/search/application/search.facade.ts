import { Injectable } from '@nestjs/common';
import type {
  SearchDeleteReason,
  SearchDocType,
  SearchUpsertReason,
} from '@linkvault/shared';
import type { TransactionSession } from '../../../infrastructure/outbox/transaction-session';
import { SearchIndexPurger } from './search-index-purger';
import { SearchOutboxEmitter } from './search-outbox-emitter';

/**
 * Única entrada pública de otros módulos a `search` (mismo patrón que GroupsFacade / LinksFacade).
 * Emisión outbox + purge Meili; la query HTTP vive en el controlador del módulo.
 */
@Injectable()
export class SearchFacade {
  constructor(
    private readonly emitter: SearchOutboxEmitter,
    private readonly purger: SearchIndexPurger,
  ) {}

  get enabled(): boolean {
    return this.emitter.enabled;
  }

  upsert(
    input: {
      readonly docType: SearchDocType;
      readonly aggregateId: string;
      readonly reason: SearchUpsertReason;
      readonly fingerprint: string;
    },
    session: TransactionSession,
  ): Promise<void> {
    return this.emitter.upsert(input, session);
  }

  delete(
    input: {
      readonly docType: SearchDocType;
      readonly aggregateId: string;
      readonly reason: SearchDeleteReason;
    },
    session: TransactionSession,
  ): Promise<void> {
    return this.emitter.delete(input, session);
  }

  purgeUser(userId: string, groupIds: readonly string[]): Promise<void> {
    return this.purger.purgeUser(userId, groupIds);
  }

  purgeGroup(groupId: string): Promise<void> {
    return this.purger.purgeGroup(groupId);
  }
}
