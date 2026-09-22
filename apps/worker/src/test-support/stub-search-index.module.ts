import { Module } from '@nestjs/common';
import { SEARCH_INDEX_JOB_PUBLISHER } from '../modules/search/application/ports/search-index-job-publisher.port';
import { NoopSearchIndexJobPublisher } from '../modules/search/infrastructure/queue/bullmq-search-index-job-publisher';

/** Stub mínimo de SearchModule para tests de cableado de cv/match (sin Meili ni Redis). */
@Module({
  providers: [
    {
      provide: SEARCH_INDEX_JOB_PUBLISHER,
      useClass: NoopSearchIndexJobPublisher,
    },
  ],
  exports: [SEARCH_INDEX_JOB_PUBLISHER],
})
export class StubSearchIndexModule {}
