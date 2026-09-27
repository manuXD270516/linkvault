import type {
  DeleteObjectsCommandInput,
  DeleteObjectsCommandOutput,
  ListObjectsV2CommandInput,
  ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import {
  S3SnapshotBucket,
  type SnapshotBucketClient,
} from './s3-snapshot.bucket';

// Traducción de `ListObjectsV2` y `DeleteObjects` al puerto del barrido (design D7 de `object-store`). El cliente es un
// doble: ningún test habla con el almacén (la 8.7 ejecuta el barrido contra el elegido).

const BUCKET = 'linkvault-snapshots';
const OLD = new Date('2026-08-01T00:00:00.000Z');

function clientOf(
  pages: ListObjectsV2CommandOutput[],
  deleteOutput: Omit<DeleteObjectsCommandOutput, '$metadata'> = {},
): SnapshotBucketClient & {
  lists: ListObjectsV2CommandInput[];
  deletes: DeleteObjectsCommandInput[];
} {
  const lists: ListObjectsV2CommandInput[] = [];
  const deletes: DeleteObjectsCommandInput[] = [];
  return {
    lists,
    deletes,
    list: (input) => {
      lists.push(input);
      const page = pages[lists.length - 1];
      return page === undefined
        ? Promise.reject(new Error('unexpected list'))
        : Promise.resolve(page);
    },
    deleteObjects: (input) => {
      deletes.push(input);
      return Promise.resolve({ $metadata: {}, ...deleteOutput });
    },
  };
}

describe('S3SnapshotBucket', () => {
  it('lists a page with key and date, follows the continuation token and skips objects it cannot date', async () => {
    const client = clientOf([
      {
        $metadata: {},
        Contents: [
          { Key: 'a/1.html.gz', LastModified: OLD },
          { Key: 'b/1.html.gz' },
          { LastModified: OLD },
        ],
        IsTruncated: true,
        NextContinuationToken: 'token-2',
      },
      { $metadata: {}, IsTruncated: false },
    ]);
    const bucket = new S3SnapshotBucket(client);

    const first = await bucket.listPage(BUCKET, null);
    const last = await bucket.listPage(BUCKET, first.nextPageToken);

    expect(first).toEqual({
      objects: [{ key: 'a/1.html.gz', lastModified: OLD }],
      nextPageToken: 'token-2',
    });
    expect(last).toEqual({ objects: [], nextPageToken: null });
    expect(client.lists).toEqual([
      { Bucket: BUCKET },
      { Bucket: BUCKET, ContinuationToken: 'token-2' },
    ]);
  });

  it('deletes in one quiet batch and maps NoSuchKey to already gone and anything else to failed', async () => {
    const client = clientOf([], {
      Errors: [
        { Key: 'b/1.html.gz', Code: 'NoSuchKey' },
        { Key: 'c/1.html.gz', Code: 'AccessDenied' },
      ],
    });
    const bucket = new S3SnapshotBucket(client);

    const outcomes = await bucket.deleteMany(BUCKET, [
      'a/1.html.gz',
      'b/1.html.gz',
      'c/1.html.gz',
    ]);

    expect(outcomes).toEqual([
      { key: 'a/1.html.gz', outcome: 'deleted' },
      { key: 'b/1.html.gz', outcome: 'already-gone' },
      { key: 'c/1.html.gz', outcome: 'failed', code: 'AccessDenied' },
    ]);
    expect(client.deletes).toEqual([
      {
        Bucket: BUCKET,
        Delete: {
          Objects: [
            { Key: 'a/1.html.gz' },
            { Key: 'b/1.html.gz' },
            { Key: 'c/1.html.gz' },
          ],
          Quiet: true,
        },
      },
    ]);
  });

  it('sends nothing for an empty batch', async () => {
    const client = clientOf([]);

    expect(await new S3SnapshotBucket(client).deleteMany(BUCKET, [])).toEqual(
      [],
    );
    expect(client.deletes).toEqual([]);
  });
});
