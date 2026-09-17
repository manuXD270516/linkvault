import type {
  HealthLiveResponse,
  HealthReadinessResponse,
  HealthStatus,
} from '@linkvault/shared';
import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  HealthCheckService,
  type HealthCheckResult,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { resolveAppVersion } from '../../infrastructure/app-version';
import type { ApiConfig } from '../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../infrastructure/config/app-config.module';
import { MongoHealthIndicator } from '../../infrastructure/health/mongo-health.indicator';
import { RedisHealthIndicator } from '../../infrastructure/health/redis-health.indicator';
import { withTimeout } from '../../infrastructure/health/with-timeout';
import { Public } from './auth-context/public.decorator';

export const HEALTH_SERVICE_NAME = 'api';
/** Tope de la respuesta completa de `GET /health` (D9). */
export const HEALTH_TOTAL_TIMEOUT_MS = 1_500;

interface ReadinessOutcome {
  readonly details: HealthIndicatorResult;
  readonly shuttingDown: boolean;
}

/**
 * Salud en dos niveles (ADR-017 §5), fuera del prefijo `/api` y sin autenticación. Adapta la salida de
 * terminus, incluida su `ServiceUnavailableException`, al contrato `HealthReadinessResponse` de
 * `@linkvault/shared`: solo estados `up`/`down`, nunca detalles de los indicadores. Pública: queda fuera del guard
 * global de access token (D3 de auth-users).
 */
@Public()
@Controller('health')
export class HealthController {
  private readonly version: string;

  constructor(
    private readonly health: HealthCheckService,
    private readonly mongo: MongoHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    @Inject(APP_CONFIG) config: ApiConfig,
  ) {
    this.version = resolveAppVersion(config.APP_VERSION);
  }

  @Get('live')
  live(): HealthLiveResponse {
    return {
      status: 'up',
      service: HEALTH_SERVICE_NAME,
      version: this.version,
    };
  }

  @Get()
  async readiness(): Promise<HealthReadinessResponse> {
    const outcome = await withTimeout(
      () => this.runChecks(),
      HEALTH_TOTAL_TIMEOUT_MS,
    ).catch((): ReadinessOutcome => ({ details: {}, shuttingDown: false }));

    const mongo = statusOf(outcome.details, 'mongo');
    const redis = statusOf(outcome.details, 'redis');
    const status: HealthStatus =
      !outcome.shuttingDown && mongo === 'up' && redis === 'up' ? 'up' : 'down';
    const body: HealthReadinessResponse = {
      status,
      service: HEALTH_SERVICE_NAME,
      version: this.version,
      checks: { mongo: { status: mongo }, redis: { status: redis } },
    };

    if (status === 'down') {
      throw new ServiceUnavailableException(body);
    }
    return body;
  }

  private async runChecks(): Promise<ReadinessOutcome> {
    try {
      const result = await this.health.check([
        () => this.mongo.isHealthy('mongo'),
        () => this.redis.isHealthy('redis'),
      ]);
      return { details: result.details, shuttingDown: false };
    } catch (error) {
      const response =
        error instanceof ServiceUnavailableException
          ? error.getResponse()
          : undefined;
      if (isHealthCheckResult(response)) {
        return {
          details: response.details,
          shuttingDown: response.status === 'shutting_down',
        };
      }
      return { details: {}, shuttingDown: false };
    }
  }
}

function statusOf(details: HealthIndicatorResult, key: string): HealthStatus {
  return details[key]?.status === 'up' ? 'up' : 'down';
}

function isHealthCheckResult(value: unknown): value is HealthCheckResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    'details' in value &&
    typeof value.details === 'object' &&
    value.details !== null
  );
}
