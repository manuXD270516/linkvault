import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { MongoHealthIndicator } from '../../infrastructure/health/mongo-health.indicator';
import { RedisHealthIndicator } from '../../infrastructure/health/redis-health.indicator';
import { RedisHealthModule } from '../../infrastructure/redis/redis-health.module';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule, RedisHealthModule],
  controllers: [HealthController],
  providers: [MongoHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
