import {
  type DiscoveryBoard,
  type DiscoveryBoardId,
  type DiscoveryHit,
  type DiscoverySearchResponse,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import {
  DiscoveryDisabled,
  TooManyDiscoveryAttempts,
} from '../domain/errors';
import type {
  DiscoveryBoardAdapter,
  DiscoveryBoardResult,
  DiscoverySearchParams,
} from '../domain/discovery-board';
import {
  DISCOVERY_BOARD_ADAPTERS,
  type DiscoveryBoardAdapters,
} from './ports/discovery-board-adapters.port';
import {
  DISCOVERY_LIMITER,
  type DiscoveryLimiter,
} from './ports/discovery-limiter.port';
import {
  DISCOVERY_USER_LANGUAGE,
  type DiscoveryUserLanguage,
} from './ports/discovery-user-language.port';

/** Timeout por board (D2). */
export const DISCOVERY_BOARD_TIMEOUT_MS = 8_000;

export interface SearchDiscoveryInput {
  readonly q: string;
  readonly board: DiscoveryBoard;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * `GET /api/discovery/search` (D2): rate-limit, flag, merge `all` con degradación parcial.
 */
@Injectable()
export class SearchDiscovery {
  constructor(
    @Inject(APP_CONFIG) private readonly config: ApiConfig,
    @Inject(DISCOVERY_BOARD_ADAPTERS)
    private readonly adapters: DiscoveryBoardAdapters,
    @Inject(DISCOVERY_LIMITER) private readonly limiter: DiscoveryLimiter,
    @Inject(DISCOVERY_USER_LANGUAGE)
    private readonly languages: DiscoveryUserLanguage,
  ) {}

  async execute(
    userId: string,
    input: SearchDiscoveryInput,
  ): Promise<DiscoverySearchResponse> {
    if (!this.config.FEATURE_DISCOVERY) {
      throw new DiscoveryDisabled();
    }

    const decision = await this.limiter.consume(userId);
    if (!decision.allowed) {
      throw new TooManyDiscoveryAttempts(decision.retryAfterSeconds);
    }

    const lang = await this.languages.getOutputLanguage(userId);
    const boards = boardsFor(input.board);
    const settled = await Promise.all(
      boards.map((boardId) =>
        this.runBoard(boardId, {
          q: input.q,
          page: input.page,
          pageSize: input.pageSize,
          lang,
        }),
      ),
    );

    const results: DiscoveryHit[] = [];
    const degraded: DiscoverySearchResponse['degraded'] = [];

    for (const item of settled) {
      if (item.result.kind === 'hits') {
        results.push(...item.result.hits);
      } else {
        degraded.push({ board: item.boardId, reason: item.result.reason });
      }
    }

    return {
      results,
      ...(degraded.length > 0 ? { degraded } : {}),
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  private async runBoard(
    boardId: DiscoveryBoardId,
    params: Omit<DiscoverySearchParams, 'signal'>,
  ): Promise<{ boardId: DiscoveryBoardId; result: DiscoveryBoardResult }> {
    const adapter = this.adapters.find((a) => a.id === boardId);
    if (adapter === undefined) {
      return {
        boardId,
        result: { kind: 'degraded', reason: 'network' },
      };
    }
    const result = await withBoardTimeout(adapter, {
      ...params,
    });
    return { boardId, result };
  }
}

function boardsFor(board: DiscoveryBoard): readonly DiscoveryBoardId[] {
  if (board === 'all') {
    return ['getonboard', 'remoteok'];
  }
  return [board];
}

async function withBoardTimeout(
  adapter: DiscoveryBoardAdapter,
  params: Omit<DiscoverySearchParams, 'signal'>,
): Promise<DiscoveryBoardResult> {
  const signal = AbortSignal.timeout(DISCOVERY_BOARD_TIMEOUT_MS);
  try {
    return await adapter.search({ ...params, signal });
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      return { kind: 'degraded', reason: 'timeout' };
    }
    return { kind: 'degraded', reason: 'network' };
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}
