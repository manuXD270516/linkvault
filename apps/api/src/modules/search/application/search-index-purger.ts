import { Inject, Injectable } from '@nestjs/common';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import { SearchPurgeFailed } from '../domain/errors';
import {
  MEILI_SEARCH_CLIENT,
  type MeiliSearchClient,
} from './ports/meili-search-client.port';

/**
 * Purga Meili antes del commit Mongo de borrado de cuenta / grupo (D9 / C2-ord).
 * FEATURE_SEARCH=false → no-op. Meili down → SearchPurgeFailed (cuenta intacta).
 */
@Injectable()
export class SearchIndexPurger {
  constructor(
    @Inject(APP_CONFIG) private readonly config: ApiConfig,
    @Inject(MEILI_SEARCH_CLIENT) private readonly meili: MeiliSearchClient,
  ) {}

  async purgeUser(userId: string, groupIds: readonly string[]): Promise<void> {
    if (!this.config.FEATURE_SEARCH) return;
    if (!this.meili.configured || !(await this.meili.healthy())) {
      throw new SearchPurgeFailed();
    }
    try {
      await this.meili.deleteByFilter(`ownerUserId = "${escape(userId)}"`);
      for (const groupId of groupIds) {
        await this.meili.deleteByFilter(`groupIds = "${escape(groupId)}"`);
      }
    } catch {
      throw new SearchPurgeFailed();
    }
  }

  async purgeGroup(groupId: string): Promise<void> {
    if (!this.config.FEATURE_SEARCH) return;
    if (!this.meili.configured || !(await this.meili.healthy())) {
      throw new SearchPurgeFailed();
    }
    try {
      await this.meili.deleteByFilter(`groupIds = "${escape(groupId)}"`);
    } catch {
      throw new SearchPurgeFailed();
    }
  }
}

function escape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
