import type { DiscoveryBoardAdapter } from '../../domain/discovery-board';

/** Token de inyección: lista ordenada de adapters activos (según DISCOVERY_CHAIN). */
export const DISCOVERY_BOARD_ADAPTERS = Symbol('DISCOVERY_BOARD_ADAPTERS');

export type DiscoveryBoardAdapters = readonly DiscoveryBoardAdapter[];
