import { EMBED_TEXTS, type EmbedTextsFn } from '@linkvault/ai';
import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import type { WorkerConfig } from '../../infrastructure/config/worker-config.schema';
import { APP_CONFIG } from '../../infrastructure/config/app-config.module';
import { ProcessSearchIndex } from './application/process-search-index.usecase';
import { MEILI_SEARCH_CLIENT } from './application/ports/meili-search-client.port';
import { SEARCH_AGGREGATE_LOADER } from './application/ports/search-aggregate-loader.port';
import { SEARCH_AI_CONSENT } from './application/ports/search-ai-consent.port';
import { SEARCH_EMBED_TEXTS } from './application/ports/search-embed-texts.port';
import { adaptEmbedTexts } from './infrastructure/adapt-embed-texts';
import { MeiliSearchClientAdapter } from './infrastructure/meili-search.client';
import { MongoSearchAggregateLoader } from './infrastructure/mongo-search-aggregate.loader';
import { MongoSearchAiConsent } from './infrastructure/mongo-search-ai-consent';
import { SearchIndexConsumer } from './infrastructure/queue/search-index.consumer';

@Module({})
export class SearchModule {
  /**
   * `aiModule` es el mismo DynamicModule de `AppModule` para resolver `EMBED_TEXTS` (ADR-036).
   */
  static register(config: WorkerConfig, aiModule: DynamicModule): DynamicModule {
    const providers = [
      {
        provide: MEILI_SEARCH_CLIENT,
        inject: [APP_CONFIG],
        useFactory: (cfg: WorkerConfig) =>
          new MeiliSearchClientAdapter({
            host: cfg.MEILI_HOST,
            apiKey: cfg.MEILI_MASTER_KEY,
            indexUid: cfg.MEILI_INDEX,
          }),
      },
      { provide: SEARCH_AI_CONSENT, useClass: MongoSearchAiConsent },
      {
        provide: SEARCH_EMBED_TEXTS,
        inject: [EMBED_TEXTS, SEARCH_AI_CONSENT],
        useFactory: (embedTexts: EmbedTextsFn, consent: MongoSearchAiConsent) =>
          adaptEmbedTexts(embedTexts, consent),
      },
      { provide: SEARCH_AGGREGATE_LOADER, useClass: MongoSearchAggregateLoader },
      ProcessSearchIndex,
      ...(config.NODE_ENV === 'test'
        ? []
        : [
            {
              provide: SearchIndexConsumer,
              inject: [ProcessSearchIndex, APP_CONFIG],
              useFactory: (
                useCase: ProcessSearchIndex,
                cfg: WorkerConfig,
              ) =>
                new SearchIndexConsumer(useCase, {
                  redisUrl: cfg.REDIS_URL,
                }),
            },
          ]),
    ];

    return {
      module: SearchModule,
      imports: [aiModule],
      providers,
    };
  }
}
