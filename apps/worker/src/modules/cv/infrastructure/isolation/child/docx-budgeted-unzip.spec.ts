import { describe, expect, it } from 'vitest';
import {
  docxWithText,
  docxWithTextDeflated,
} from '../../extractors/fixtures/cv-fixtures';
import {
  bombDocx,
  twoLargeEntriesDocx,
} from '../../extractors/fixtures/pathological-fixtures';
import { inflateWithinBudget } from './docx-budgeted-unzip';
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

describe('inflateWithinBudget', () => {
  it('inflates a deflated docx within budget', () => {
    const zip = docxWithTextDeflated();
    const inflated = inflateWithinBudget(zip, readZipEntries(zip));

    const document = inflated.find(
      (entry) => entry.name === 'word/document.xml',
    );
    expect(new TextDecoder().decode(document?.content)).toContain(
      'Nadia Quispe Almaraz',
    );
  });

  it('stops at the inflated budget even when the header lies', async () => {
    // Cabecera de 1 KiB para 80 MiB de espacios deflactados por streaming.
    const zip = await bombDocx(80, 1024);
    const entries = readZipEntries(zip);

    expect(
      entries.find((entry) => entry.name === 'word/document.xml')?.declaredSize,
    ).toBe(1024);
    expect(rejectionOf(() => inflateWithinBudget(zip, entries))).toBe(
      'input_budget',
    );
  });

  it('counts the budget across entries', async () => {
    const zip = await twoLargeEntriesDocx(40);

    expect(
      rejectionOf(() => inflateWithinBudget(zip, readZipEntries(zip))),
    ).toBe('input_budget');
  });

  it('stored entries count for the budget', () => {
    const zip = docxWithText();
    const entries = readZipEntries(zip);
    const total = entries.reduce((sum, entry) => sum + entry.compressedSize, 0);

    expect(inflateWithinBudget(zip, entries, total)).toHaveLength(3);
    expect(
      rejectionOf(() => inflateWithinBudget(zip, entries, total - 1)),
    ).toBe('input_budget');
  });

  it('does not inflate word/media entries', () => {
    const zip = docxWithText();
    const entries = readZipEntries(zip).map((entry) => ({
      ...entry,
      name:
        entry.name === 'word/document.xml'
          ? 'word/media/image1.png'
          : entry.name,
    }));

    expect(
      inflateWithinBudget(zip, entries).map((entry) => entry.name),
    ).not.toContain('word/media/image1.png');
  });
});
