import { describe, expect, it } from 'vitest';
import {
  docxWithText,
  docxWithTextDeflated,
  docxWithZip64Extra,
} from '../../extractors/fixtures/cv-fixtures';
import {
  assembleZip,
  realZip64,
  storedEntry,
  zipWithEntries,
} from '../../extractors/fixtures/pathological-fixtures';
import { readZipEntries } from './docx-central-directory';
import { ZipRejection } from './zip-rejection';

function rejectionOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof ZipRejection) {
      return error.failure;
    }
    throw error;
  }
  return 'no rejection';
}

/** Copia el ZIP y deja cambiar bytes concretos con una vista. */
function mutate(
  zip: Uint8Array,
  change: (view: DataView, zip: Uint8Array) => void,
): Uint8Array {
  const copy = new Uint8Array(zip);
  change(new DataView(copy.buffer), copy);
  return copy;
}

function centralOffsetOf(zip: Uint8Array): number {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  return view.getUint32(zip.byteLength - 22 + 16, true);
}

describe('readZipEntries, central directory', () => {
  it('reads the entries of a stored and of a deflated docx', () => {
    for (const zip of [docxWithText(), docxWithTextDeflated()]) {
      expect(readZipEntries(zip).map((entry) => entry.name)).toEqual([
        '[Content_Types].xml',
        '_rels/.rels',
        'word/document.xml',
      ]);
    }
  });

  it('rejects more than 2000 entries', () => {
    expect(rejectionOf(() => readZipEntries(zipWithEntries(2001)))).toBe(
      'input_budget',
    );
    expect(readZipEntries(zipWithEntries(2000))).toHaveLength(2000);
  });

  it('rejects a real zip64 archive', () => {
    expect(rejectionOf(() => readZipEntries(realZip64()))).toBe('input_budget');
  });

  it('accepts a zip64 extra field whose values fit in 32 bits', () => {
    const entries = readZipEntries(docxWithZip64Extra());

    expect(entries).toHaveLength(3);
  });

  it('rejects an encrypted entry', () => {
    const zip = mutate(docxWithText(), (view, bytes) => {
      view.setUint16(centralOffsetOf(bytes) + 8, 0x1, true);
    });

    expect(rejectionOf(() => readZipEntries(zip))).toBe('password');
  });

  it('rejects a method other than stored or deflate', () => {
    const zip = mutate(docxWithText(), (view, bytes) => {
      view.setUint16(centralOffsetOf(bytes) + 10, 12, true);
    });

    expect(rejectionOf(() => readZipEntries(zip))).toBe('input_budget');
  });

  it('rejects an entry name with ..', () => {
    const zip = assembleZip([storedEntry('../outside.xml', 'x')]);

    expect(rejectionOf(() => readZipEntries(zip))).toBe('input_budget');
  });

  it('rejects an absolute entry name', () => {
    expect(
      rejectionOf(() =>
        readZipEntries(assembleZip([storedEntry('/etc/x', 'x')])),
      ),
    ).toBe('input_budget');
    expect(
      rejectionOf(() =>
        readZipEntries(assembleZip([storedEntry('C:/x', 'x')])),
      ),
    ).toBe('input_budget');
  });

  it('calls a file that is not a zip a parse error', () => {
    expect(rejectionOf(() => readZipEntries(new Uint8Array(100)))).toBe(
      'parse_error',
    );
    expect(rejectionOf(() => readZipEntries(new Uint8Array(3)))).toBe(
      'parse_error',
    );
  });
});

describe('readZipEntries, local header', () => {
  it('rejects an offset outside the file', () => {
    const zip = mutate(docxWithText(), (view, bytes) => {
      view.setUint32(
        centralOffsetOf(bytes) + 42,
        bytes.byteLength + 1000,
        true,
      );
    });

    expect(rejectionOf(() => readZipEntries(zip))).toBe('input_budget');
  });

  it('rejects a local header without its signature', () => {
    const zip = mutate(docxWithText(), (view) => {
      view.setUint32(0, 0, true);
    });

    expect(rejectionOf(() => readZipEntries(zip))).toBe('input_budget');
  });

  it('rejects a local header that disagrees with the central directory', () => {
    const otherName = mutate(docxWithText(), (_view, bytes) => {
      // El primer byte del nombre local ('[') cambia: el nombre ya no coincide.
      bytes[30] = 0x28;
    });
    const otherMethod = mutate(docxWithText(), (view) => {
      view.setUint16(8, 8, true);
    });

    expect(rejectionOf(() => readZipEntries(otherName))).toBe('input_budget');
    expect(rejectionOf(() => readZipEntries(otherMethod))).toBe('input_budget');
  });

  it('locates the data after the local header', () => {
    const zip = docxWithText();
    const [first] = readZipEntries(zip);
    const nameLength = new TextEncoder().encode(
      '[Content_Types].xml',
    ).byteLength;

    expect(first?.dataStart).toBe(30 + nameLength);
    // El primer byte de los datos del fixture sin comprimir es el inicio del XML.
    expect(String.fromCharCode(zip[first?.dataStart ?? 0] ?? 0)).toBe('<');
  });
});
