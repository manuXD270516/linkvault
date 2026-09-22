import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import { OutboxModule } from '../../../infrastructure/outbox/outbox.module';
import { GroupsModule } from '../../groups/presentation/groups.module';
import { SearchContent } from '../application/search-content.usecase';
import { SearchIndexPurger } from '../application/search-index-purger';
import { SearchOutboxEmitter } from '../application/search-outbox-emitter';
import { SearchFacade } from '../application/search.facade';
import { MEILI_SEARCH_CLIENT } from '../application/ports/meili-search-client.port';
import { SEARCH_EMBED_TEXTS } from '../application/ports/search-embed-texts.port';
import { SEARCH_MEMBERSHIP } from '../application/ports/search-membership.port';
import { BackfillSearch } from '../application/backfill-search.usecase';
import { GroupsFacadeSearchMembership } from '../infrastructure/groups-facade-search-membership';
import { MeiliSearchClientAdapter } from '../infrastructure/meili-search.client';
import { createStubEmbedTexts } from '../infrastructure/stub-embed-texts';
import { SearchController } from './search.controller';

/**
 * Módulo search (api): query HTTP, emitters outbox, purge pre-delete, backfill.
 * Otros módulos entran solo por `SearchFacade` (lint de límites).
 */
@Module({})
export class SearchModule {
  static register(): DynamicModule {
    return {
      module: SearchModule,
      imports: [GroupsModule, OutboxModule],
      controllers: [SearchController],
      providers: [
        {
          provide: MEILI_SEARCH_CLIENT,
          inject: [APP_CONFIG],
          useFactory: (config: ApiConfig) =>
            new MeiliSearchClientAdapter({
              host: config.MEILI_HOST,
              apiKey: config.MEILI_MASTER_KEY,
              indexUid: config.MEILI_INDEX,
            }),
        },
        {
          provide: SEARCH_EMBED_TEXTS,
          useFactory: () => createStubEmbedTexts(),
        },
        { provide: SEARCH_MEMBERSHIP, useClass: GroupsFacadeSearchMembership },
        SearchOutboxEmitter,
        SearchIndexPurger,
        SearchFacade,
        SearchContent,
        BackfillSearch,
      ],
      exports: [SearchFacade, MEILI_SEARCH_CLIENT],
    };
  }
}
