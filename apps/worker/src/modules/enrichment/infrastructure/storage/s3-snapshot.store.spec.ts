import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  S3SnapshotStore,
  snapshotKey,
  type SnapshotUploader,
} from './s3-snapshot.store';

// Requisito "Snapshot de la página" (specs/links/enrichment) y D12 de link-enrichment. La subida es un doble: ningún
// test habla con un almacén S3.

const gunzipAsync = promisify(gunzip);

const LINK_ID = '68c0f0f0f0f0f0f0f0f0f0f0';
const HTML = `<html><body><main>${'<p>Arquitecto(a) de Soluciones</p>'.repeat(20)}</main></body></html>`;

/** Almacenamiento en memoria con la forma del puerto de subida. */
function uploaderOf(): SnapshotUploader & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    put: (key, body) => {
      objects.set(key, body);
      return Promise.resolve();
    },
  };
}

/** El aviso de un almacenamiento caído es esperado aquí: se captura en vez de ensuciar la salida de la suite. */
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('Snapshot guardado', () => {
  it('stores the page compressed and answers with its key', async () => {
    const uploader = uploaderOf();

    const key = await new S3SnapshotStore(uploader).save(LINK_ID, 2, HTML);

    expect(key).toBe(`${LINK_ID}/2.html.gz`);
    const stored = uploader.objects.get(key ?? '');
    expect(stored).toBeDefined();
    expect(
      (await gunzipAsync(stored ?? new Uint8Array())).toString('utf8'),
    ).toBe(HTML);
    // Comprimido de verdad: si pesara lo mismo, el gzip no estaría haciendo nada.
    expect(stored?.byteLength).toBeLessThan(HTML.length);
  });

  it('names one object per link and version', () => {
    expect(snapshotKey(LINK_ID, 1)).toBe(`${LINK_ID}/1.html.gz`);
    expect(snapshotKey(LINK_ID, 17)).toBe(`${LINK_ID}/17.html.gz`);
  });
});

describe('Almacenamiento caído', () => {
  it('answers with no key instead of failing the enrichment', async () => {
    const broken: SnapshotUploader = {
      put: () => Promise.reject(new Error('connect ECONNREFUSED')),
    };

    await expect(
      new S3SnapshotStore(broken).save(LINK_ID, 2, HTML),
    ).resolves.toBeNull();
  });

  it('does not write the page or the address anywhere when it complains', async () => {
    const broken: SnapshotUploader = {
      put: () =>
        Promise.reject(new Error('https://bolsa.example/jobs/1 falló')),
    };

    await new S3SnapshotStore(broken).save(LINK_ID, 2, HTML);

    const logged = warn.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .join(' ');
    expect(logged).toContain(LINK_ID);
    expect(logged).not.toContain('bolsa.example');
    expect(logged).not.toContain('<html>');
  });
});
