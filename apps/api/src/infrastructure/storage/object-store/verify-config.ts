import {
  GetBucketEncryptionCommand,
  type GetBucketEncryptionCommandOutput,
  GetBucketLifecycleConfigurationCommand,
  type GetBucketLifecycleConfigurationCommandOutput,
  HeadBucketCommand,
  type LifecycleRule,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import type { CvBucketEncryptionMode } from '@linkvault/shared';
import type { ObjectStoreReport } from './object-store-report';
import {
  describeError,
  hasCode,
  isNotFound,
  isNotImplemented,
} from './s3-errors';
import type { ObjectStoreBuckets, S3Send } from './s3-send';

// `object-store verify`, parte de configuración (design D4 de `object-store`, spec `platform/object-store`). **Solo
// lee**: `HeadBucket`, `GetBucketLifecycleConfiguration`, `GetBucketEncryption` y `ListObjectsV2`. Es estricto, porque
// una comprobación laxa aprueba lo que no está:
//
// - los dos buckets existen;
// - **ninguna** regla de ciclo de vida en ninguno de los dos, sea cual sea su plazo, su estado o su filtro: la
//   retención de snapshots es el barrido del `worker` (design D7), y una regla cuya expiración nadie ha medido no se
//   deja puesta;
// - cifrado por defecto en el de CV cuando el modo es `server`;
// - ningún snapshot de más de 31 días (el barrido diario borra los de más de 30; un día de margen). Es también la única
//   alarma de un `worker` que ha dejado de barrer.

export const MAX_SNAPSHOT_AGE_DAYS = 31;
const DAY_MS = 86_400_000;
/** Cuántos snapshots viejos se nombran uno a uno; del resto se da la cuenta. */
const NAMED_OLD_SNAPSHOTS = 20;

export interface VerifyConfigDeps {
  readonly send: S3Send;
  readonly buckets: ObjectStoreBuckets;
  readonly encryptionMode: CvBucketEncryptionMode;
  readonly now: () => Date;
}

/** Qué buckets existen: la parte de acceso anónimo solo se comprueba en ellos. */
export interface ExistingBuckets {
  readonly cv: boolean;
  readonly snapshots: boolean;
}

export async function verifyObjectStoreConfig(
  deps: VerifyConfigDeps,
  report: ObjectStoreReport,
): Promise<ExistingBuckets> {
  const cv = await bucketExists(deps.send, report, deps.buckets.cv);
  const snapshots = await bucketExists(
    deps.send,
    report,
    deps.buckets.snapshots,
  );

  if (cv) {
    await checkNoLifecycleRules(deps.send, report, deps.buckets.cv);
    await checkDefaultEncryption(deps, report);
  }
  if (snapshots) {
    await checkNoLifecycleRules(deps.send, report, deps.buckets.snapshots);
    await checkSnapshotAges(deps, report);
  }
  return { cv, snapshots };
}

async function bucketExists(
  send: S3Send,
  report: ObjectStoreReport,
  bucket: string,
): Promise<boolean> {
  try {
    await send(new HeadBucketCommand({ Bucket: bucket }));
    report.ok(`${bucket}: bucket exists`);
    return true;
  } catch (error: unknown) {
    report.fail(
      isNotFound(error)
        ? `${bucket}: bucket missing`
        : `${bucket}: bucket: ${describeError(error)}`,
    );
    return false;
  }
}

function describeRule(rule: LifecycleRule, index: number): string {
  const id =
    rule.ID !== undefined && rule.ID !== '' ? `"${rule.ID}"` : `#${index + 1}`;
  const days = rule.Expiration?.Days;
  const expiration =
    days === undefined ? 'no expiration days' : `expires after ${days} days`;
  const prefix = rule.Filter?.Prefix ?? rule.Prefix;
  const hasFilter =
    rule.Filter !== undefined &&
    (rule.Filter.Prefix !== undefined ||
      rule.Filter.Tag !== undefined ||
      rule.Filter.And !== undefined ||
      rule.Filter.ObjectSizeGreaterThan !== undefined ||
      rule.Filter.ObjectSizeLessThan !== undefined);
  const filter =
    prefix !== undefined && prefix !== ''
      ? `prefix "${prefix}"`
      : hasFilter
        ? 'filtered'
        : 'no filter';
  return `rule ${id} (${rule.Status ?? 'no status'}, ${expiration}, ${filter})`;
}

async function checkNoLifecycleRules(
  send: S3Send,
  report: ObjectStoreReport,
  bucket: string,
): Promise<void> {
  let rules: readonly LifecycleRule[];
  try {
    const output = (await send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
    )) as GetBucketLifecycleConfigurationCommandOutput | undefined;
    rules = output?.Rules ?? [];
  } catch (error: unknown) {
    if (hasCode(error, 'NoSuchLifecycleConfiguration')) {
      report.ok(`${bucket}: no lifecycle rule`);
      return;
    }
    if (isNotImplemented(error)) {
      report.note(
        `${bucket}: the store does not implement lifecycle configuration (${describeError(error)}); no lifecycle rule`,
      );
      return;
    }
    report.fail(`${bucket}: lifecycle configuration: ${describeError(error)}`);
    return;
  }
  if (rules.length === 0) {
    report.ok(`${bucket}: no lifecycle rule`);
    return;
  }
  rules.forEach((rule, index) => {
    report.fail(
      `${bucket}: lifecycle ${describeRule(rule, index)} is set; snapshot retention is the worker sweep, run provision to remove it`,
    );
  });
}

async function checkDefaultEncryption(
  deps: VerifyConfigDeps,
  report: ObjectStoreReport,
): Promise<void> {
  const bucket = deps.buckets.cv;
  if (deps.encryptionMode === 'customer-key') {
    report.note(`${bucket}: customer-key encryption: not checkable per bucket`);
    return;
  }
  try {
    const output = (await deps.send(
      new GetBucketEncryptionCommand({ Bucket: bucket }),
    )) as GetBucketEncryptionCommandOutput | undefined;
    const algorithms = (output?.ServerSideEncryptionConfiguration?.Rules ?? [])
      .map((rule) => rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm)
      .filter(
        (algorithm): algorithm is NonNullable<typeof algorithm> =>
          algorithm !== undefined && String(algorithm) !== '',
      );
    if (algorithms.length === 0) {
      report.fail(`${bucket}: no default encryption`);
      return;
    }
    report.ok(`${bucket}: default encryption (${algorithms.join(', ')})`);
  } catch (error: unknown) {
    report.fail(
      hasCode(error, 'ServerSideEncryptionConfigurationNotFoundError')
        ? `${bucket}: no default encryption`
        : `${bucket}: default encryption: ${describeError(error)}`,
    );
  }
}

async function checkSnapshotAges(
  deps: VerifyConfigDeps,
  report: ObjectStoreReport,
): Promise<void> {
  const bucket = deps.buckets.snapshots;
  const now = deps.now().getTime();
  const limitMs = MAX_SNAPSHOT_AGE_DAYS * DAY_MS;
  const old: { key: string; days: number }[] = [];
  let listed = 0;
  let token: string | undefined;
  try {
    do {
      const page = (await deps.send(
        new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
      )) as ListObjectsV2CommandOutput | undefined;
      for (const object of page?.Contents ?? []) {
        listed += 1;
        const modified = object.LastModified?.getTime();
        if (object.Key === undefined || modified === undefined) {
          continue;
        }
        if (now - modified > limitMs) {
          old.push({
            key: object.Key,
            days: Math.floor((now - modified) / DAY_MS),
          });
        }
      }
      token =
        page?.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (token !== undefined);
  } catch (error: unknown) {
    report.fail(`${bucket}: snapshot listing: ${describeError(error)}`);
    return;
  }
  if (old.length === 0) {
    report.ok(
      `${bucket}: no snapshot older than ${MAX_SNAPSHOT_AGE_DAYS} days (${listed} listed)`,
    );
    return;
  }
  for (const { key, days } of old.slice(0, NAMED_OLD_SNAPSHOTS)) {
    report.fail(
      `${bucket}: snapshot ${key} is ${days} days old (more than ${MAX_SNAPSHOT_AGE_DAYS}); is the worker sweep running?`,
    );
  }
  if (old.length > NAMED_OLD_SNAPSHOTS) {
    report.fail(
      `${bucket}: ${old.length - NAMED_OLD_SNAPSHOTS} more snapshots older than ${MAX_SNAPSHOT_AGE_DAYS} days`,
    );
  }
}
