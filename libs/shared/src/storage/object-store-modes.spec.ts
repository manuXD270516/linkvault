import { describe, expect, it } from 'vitest';
import {
  CV_BUCKET_ENCRYPTION_MODE,
  CV_BUCKET_ENCRYPTION_MODES,
  SNAPSHOT_RETENTION_MODE,
  SNAPSHOT_RETENTION_MODES,
} from './object-store-modes';

describe('los modos del almacén de objetos', () => {
  it('tienen el cifrado del bucket de CV entre los dos modos posibles', () => {
    expect(CV_BUCKET_ENCRYPTION_MODES).toEqual(['server', 'customer-key']);
    expect(CV_BUCKET_ENCRYPTION_MODES).toContain(CV_BUCKET_ENCRYPTION_MODE);
  });

  it('tienen la retención por barrido como único modo', () => {
    expect(SNAPSHOT_RETENTION_MODES).toEqual(['sweep']);
    expect(SNAPSHOT_RETENTION_MODE).toBe('sweep');
  });
});
