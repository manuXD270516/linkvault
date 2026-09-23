import type {
  DiscoveryBoardId,
  DiscoveryDegradeReason,
  DiscoveryHit,
} from '@linkvault/shared';

/** Resultado exitoso de un adapter. */
export interface DiscoveryBoardHits {
  readonly kind: 'hits';
  readonly hits: readonly DiscoveryHit[];
}

/** Board degradado sin tumbar la respuesta agregada. */
export interface DiscoveryBoardDegraded {
  readonly kind: 'degraded';
  readonly reason: DiscoveryDegradeReason;
}

export type DiscoveryBoardResult = DiscoveryBoardHits | DiscoveryBoardDegraded;

export interface DiscoverySearchParams {
  readonly q: string;
  readonly page: number;
  readonly pageSize: number;
  readonly lang: 'es' | 'en';
  readonly signal: AbortSignal;
}

/**
 * Puerto de un board de discovery (D3). Domain/application no conocen HTTP ni Redis.
 * `id` identifica el board; el caso de uso filtra por `board` / `all`.
 */
export interface DiscoveryBoardAdapter {
  readonly id: DiscoveryBoardId;
  search(params: DiscoverySearchParams): Promise<DiscoveryBoardResult>;
}
