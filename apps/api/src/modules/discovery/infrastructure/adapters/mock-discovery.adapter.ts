import type { DiscoveryHit } from '@linkvault/shared';
import type {
  DiscoveryBoardAdapter,
  DiscoveryBoardResult,
  DiscoverySearchParams,
} from '../../domain/discovery-board';

/** Fixtures in-repo para `DISCOVERY_CHAIN=mock` (CI / sin red). */
export const MOCK_GETONBOARD_HITS: readonly DiscoveryHit[] = [
  {
    board: 'getonboard',
    title: 'Senior Backend Engineer',
    company: 'Witi',
    location: 'Remote LATAM',
    url: 'https://www.getonbrd.com/jobs/senior-backend-engineer-witi-remote-afcb',
    externalJobId: 'senior-backend-engineer-witi-remote-afcb',
    salaryText: 'USD 4k–6k',
  },
  {
    board: 'getonboard',
    title: 'React Developer',
    company: 'Acme',
    location: 'Santiago',
    url: 'https://www.getonbrd.com/jobs/react-developer-acme-santiago-2b3c',
    externalJobId: 'react-developer-acme-santiago-2b3c',
  },
  {
    board: 'getonboard',
    title: 'Product Designer',
    company: 'Nora',
    location: 'Remote',
    url: 'https://www.getonbrd.com/jobs/product-designer-nora-remote-3c4d',
    externalJobId: 'product-designer-nora-remote-3c4d',
  },
];

export const MOCK_REMOTEOK_HITS: readonly DiscoveryHit[] = [
  {
    board: 'remoteok',
    title: 'Customer Support Specialist',
    company: 'Example Co',
    location: 'Worldwide',
    url: 'https://remoteok.com/remote-jobs/1130248-customer-support-specialist-example-co',
    externalJobId: '1130248',
    salaryText: 'USD 55k–80k',
  },
  {
    board: 'remoteok',
    title: 'Senior React Engineer',
    company: 'Orbit',
    location: 'Remote',
    url: 'https://remoteok.com/remote-jobs/99001-senior-react-engineer-orbit',
    externalJobId: '99001',
  },
  {
    board: 'remoteok',
    title: 'DevOps Engineer',
    company: 'Cloudlet',
    location: 'Americas',
    url: 'https://remoteok.com/remote-jobs/88002-devops-engineer-cloudlet',
    externalJobId: '88002',
  },
];

/**
 * Adapter mock determinista. Filtra por `q` (case-insensitive en title/company) y pagina
 * en proceso. Con `q` vacío devuelve los primeros N (D2).
 */
export class MockDiscoveryAdapter implements DiscoveryBoardAdapter {
  constructor(
    readonly id: 'getonboard' | 'remoteok',
    private readonly fixtures: readonly DiscoveryHit[],
  ) {}

  search(params: DiscoverySearchParams): Promise<DiscoveryBoardResult> {
    if (params.signal.aborted) {
      return Promise.resolve({ kind: 'degraded', reason: 'timeout' });
    }
    const needle = params.q.trim().toLowerCase();
    const matched =
      needle.length === 0
        ? [...this.fixtures]
        : this.fixtures.filter(
            (hit) =>
              hit.title.toLowerCase().includes(needle) ||
              (hit.company?.toLowerCase().includes(needle) ?? false),
          );
    const start = (params.page - 1) * params.pageSize;
    const hits = matched.slice(start, start + params.pageSize);
    return Promise.resolve({ kind: 'hits', hits });
  }
}

export function mockDiscoveryAdapters(): readonly DiscoveryBoardAdapter[] {
  return [
    new MockDiscoveryAdapter('getonboard', MOCK_GETONBOARD_HITS),
    new MockDiscoveryAdapter('remoteok', MOCK_REMOTEOK_HITS),
  ];
}
