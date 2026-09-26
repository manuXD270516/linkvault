import {
  CreateBucketCommand,
  DeleteBucketLifecycleCommand,
  DeleteBucketPolicyCommand,
  GetBucketPolicyCommand,
  type GetBucketPolicyCommandOutput,
  PutBucketEncryptionCommand,
} from '@aws-sdk/client-s3';
import type { CvBucketEncryptionMode } from '@linkvault/shared';
import { ObjectStoreReport } from './object-store-report';
import { describeError, hasCode, isNotImplemented } from './s3-errors';
import {
  DeadlineExceeded,
  type ObjectStoreBuckets,
  type S3Send,
  type StepRunner,
  withDeadline,
} from './s3-send';

// `object-store provision` (design D4 de `object-store`, spec `platform/object-store`, «Aprovisionamiento idempotente y
// separado de la salud»). Deja el almacén como la aplicación lo necesita, **solo por la API S3**:
//
// - los dos buckets creados (un `BucketAlreadyOwnedByYou` es éxito);
// - **ninguna** regla de ciclo de vida en ninguno de los dos: se envía `DeleteBucketLifecycle` y nunca
//   `PutBucketLifecycleConfiguration`, porque la retención de snapshots es el barrido del `worker` (design D7);
// - el cifrado por defecto del bucket de CV cuando el modo es `server`;
// - ninguna política de bucket.
//
// Cada bucket se prepara en su propio bloque: el fallo de uno no impide intentar el otro, y al final la salida nombra
// lo que no quedó. Un plazo global de 90 s corta un almacén que acepta la conexión y no responde.

export const PROVISION_DEADLINE_MS = 90_000;

export interface ProvisionDeps {
  readonly send: S3Send;
  readonly buckets: ObjectStoreBuckets;
  readonly encryptionMode: CvBucketEncryptionMode;
  /** Solo para tests; por defecto, `PROVISION_DEADLINE_MS`. */
  readonly deadlineMs?: number;
}

export async function provisionObjectStore(
  deps: ProvisionDeps,
): Promise<ObjectStoreReport> {
  const report = new ObjectStoreReport();
  const deadlineMs = deps.deadlineMs ?? PROVISION_DEADLINE_MS;
  try {
    await withDeadline(deadlineMs, async (runner) => {
      await prepareBucket(deps, runner, report, deps.buckets.cv, 'cv');
      await prepareBucket(
        deps,
        runner,
        report,
        deps.buckets.snapshots,
        'snapshots',
      );
    });
  } catch (error: unknown) {
    if (!(error instanceof DeadlineExceeded)) {
      throw error;
    }
    report.fail(error.message);
  }
  return report;
}

type BucketRole = 'cv' | 'snapshots';

/**
 * Un paso de un bucket. Devuelve `false` si falló (ya informado). Un plazo vencido se propaga sin informar: lo
 * informa `provisionObjectStore`, una vez, con el paso en curso.
 */
async function attempt(
  runner: StepRunner,
  report: ObjectStoreReport,
  name: string,
  run: (signal: AbortSignal) => Promise<void>,
): Promise<boolean> {
  try {
    await runner.step(name, run);
    return true;
  } catch (error: unknown) {
    if (error instanceof DeadlineExceeded) {
      throw error;
    }
    report.fail(`${name}: ${describeError(error)}`);
    return false;
  }
}

async function prepareBucket(
  deps: ProvisionDeps,
  runner: StepRunner,
  report: ObjectStoreReport,
  bucket: string,
  role: BucketRole,
): Promise<void> {
  const { send } = deps;

  const exists = await attempt(
    runner,
    report,
    `${bucket}: create bucket`,
    async (abortSignal) => {
      try {
        await send(new CreateBucketCommand({ Bucket: bucket }), {
          abortSignal,
        });
        report.ok(`${bucket}: bucket created`);
      } catch (error: unknown) {
        if (hasCode(error, 'BucketAlreadyOwnedByYou')) {
          report.ok(`${bucket}: bucket already exists`);
          return;
        }
        throw error;
      }
    },
  );
  if (!exists) {
    // Sin bucket, el resto de sus propiedades no se puede dejar: ya consta como fallo. El otro bucket sigue.
    return;
  }

  await attempt(
    runner,
    report,
    `${bucket}: lifecycle configuration`,
    async (abortSignal) => {
      try {
        await send(new DeleteBucketLifecycleCommand({ Bucket: bucket }), {
          abortSignal,
        });
        report.ok(
          `${bucket}: no lifecycle configuration (removed if there was one)`,
        );
      } catch (error: unknown) {
        if (hasCode(error, 'NoSuchLifecycleConfiguration')) {
          report.ok(`${bucket}: no lifecycle configuration`);
          return;
        }
        if (isNotImplemented(error)) {
          report.note(
            `${bucket}: the store does not implement lifecycle configuration (${describeError(error)}); nothing to remove`,
          );
          return;
        }
        throw error;
      }
    },
  );

  if (role === 'cv') {
    if (deps.encryptionMode === 'server') {
      await attempt(
        runner,
        report,
        `${bucket}: default encryption`,
        async (abortSignal) => {
          await send(
            new PutBucketEncryptionCommand({
              Bucket: bucket,
              ServerSideEncryptionConfiguration: {
                Rules: [
                  {
                    ApplyServerSideEncryptionByDefault: {
                      SSEAlgorithm: 'AES256',
                    },
                  },
                ],
              },
            }),
            { abortSignal },
          );
          report.ok(`${bucket}: default encryption set (AES256)`);
        },
      );
    } else {
      report.note(
        `${bucket}: customer-key encryption: not set per bucket (the application sends the key)`,
      );
    }
  }

  await attempt(
    runner,
    report,
    `${bucket}: bucket policy`,
    async (abortSignal) => {
      try {
        const current = (await send(
          new GetBucketPolicyCommand({ Bucket: bucket }),
          { abortSignal },
        )) as GetBucketPolicyCommandOutput | undefined;
        if (current?.Policy === undefined || current.Policy.trim() === '') {
          report.ok(`${bucket}: no bucket policy`);
          return;
        }
      } catch (error: unknown) {
        if (hasCode(error, 'NoSuchBucketPolicy')) {
          report.ok(`${bucket}: no bucket policy`);
          return;
        }
        if (isNotImplemented(error)) {
          report.note(
            `${bucket}: the store has no bucket policies (${describeError(error)}); anonymous access is checked by verify`,
          );
          return;
        }
        throw error;
      }
      try {
        await send(new DeleteBucketPolicyCommand({ Bucket: bucket }), {
          abortSignal,
        });
        report.ok(`${bucket}: bucket policy removed`);
      } catch (error: unknown) {
        if (isNotImplemented(error)) {
          report.note(
            `${bucket}: the store has no bucket policies (${describeError(error)}); anonymous access is checked by verify`,
          );
          return;
        }
        throw error;
      }
    },
  );
}
