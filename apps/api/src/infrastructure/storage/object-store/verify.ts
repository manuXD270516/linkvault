import type { CvBucketEncryptionMode } from '@linkvault/shared';
import { ObjectStoreReport } from './object-store-report';
import type { ObjectStoreBuckets, S3Send } from './s3-send';
import { type AnonymousFetch, verifyAnonymousAccess } from './verify-anonymous';
import { verifyObjectStoreConfig } from './verify-config';

// `object-store verify` (design D4 de `object-store`): la configuración de los buckets y, sobre los que existen, el
// acceso anónimo. Lee y compara sin escribir; la única escritura posible es borrar, con firma, la sonda que una
// escritura anónima ya aceptada haya creado.

export interface VerifyDeps {
  readonly send: S3Send;
  readonly endpoint: string;
  readonly buckets: ObjectStoreBuckets;
  readonly encryptionMode: CvBucketEncryptionMode;
  readonly now: () => Date;
  readonly fetch?: AnonymousFetch;
  readonly randomId?: () => string;
}

export async function verifyObjectStore(
  deps: VerifyDeps,
): Promise<ObjectStoreReport> {
  const report = new ObjectStoreReport();
  const existing = await verifyObjectStoreConfig(deps, report);
  const reachable = [
    ...(existing.cv ? [deps.buckets.cv] : []),
    ...(existing.snapshots ? [deps.buckets.snapshots] : []),
  ];
  await verifyAnonymousAccess(deps, reachable, report);
  return report;
}
