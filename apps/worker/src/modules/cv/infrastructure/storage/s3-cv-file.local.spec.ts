import { cvFileKey } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  S3CvFileReader,
  createS3CvObjectClient,
} from './s3-cv-file.reader';

// **Paso local, no de CI** (ADR-028, "Pruebas"): la única comprobación de este change que habla con MinIO de verdad.
// El resto de la suite usa dobles, porque un test no debe necesitar un contenedor para correr.
//
// Se enciende con `CV_MINIO_LOCAL=1` y la infraestructura levantada:
//
//   docker compose up -d --wait
//   CV_MINIO_LOCAL=1 pnpm nx run worker:test -- s3-cv-file.local
//
// Lo que comprueba es justo lo que un doble no puede: que un `DeleteObject` sobre una clave que ya no está **no**
// falla, que es de lo que depende que consumir dos veces `CvDeleted.v1` sea inofensivo.

const enabled = process.env['CV_MINIO_LOCAL'] === '1';

const options = {
  endpoint: process.env['S3_ENDPOINT'] ?? 'http://localhost:9000',
  region: process.env['S3_REGION'] ?? 'us-east-1',
  accessKey: process.env['S3_ACCESS_KEY'] ?? 'linkvault',
  secretKey: process.env['S3_SECRET_KEY'] ?? 'linkvault-dev-secret',
  bucket: process.env['S3_BUCKET'] ?? 'cvs',
};

describe.skipIf(!enabled)('S3CvFileReader against the compose MinIO', () => {
  it('reads, deletes and deleting again is still a success', async () => {
    const client = createS3CvObjectClient(options);
    const reader = new S3CvFileReader(client);
    const key = cvFileKey(
      '66e9a0000000000000000a01',
      `local-${Date.now().toString(16)}`,
    );
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    await putForTest(options, key, bytes);

    await expect(reader.read(key)).resolves.toEqual(bytes);

    await reader.remove(key);
    await expect(reader.read(key)).resolves.toBeNull();
    await expect(reader.remove(key)).resolves.toBeUndefined();
  }, 30_000);
});

/** Sube el objeto de prueba. Es lo único que `CV_FILE_READER` no sabe hacer: en el worker nadie escribe. */
async function putForTest(
  settings: typeof options,
  key: string,
  bytes: Uint8Array,
): Promise<void> {
  const { PutObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: settings.accessKey,
      secretAccessKey: settings.secretKey,
    },
  });
  await client.send(
    new PutObjectCommand({
      Bucket: settings.bucket,
      Key: key,
      Body: bytes,
      ContentType: 'application/pdf',
    }),
  );
}
