import enMessages from './messages.en.xlf' with { loader: 'text' };
import sourceMessages from './messages.xlf' with { loader: 'text' };

/** Unidades de un XLIFF 1.2 por id, con su `target` (null si falta). */
function translationUnits(xliff: string): Map<string, string | null> {
  const document = new DOMParser().parseFromString(xliff, 'application/xml');
  expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
  return new Map(
    Array.from(document.getElementsByTagName('trans-unit')).map((unit) => [
      unit.getAttribute('id') ?? '',
      unit.getElementsByTagName('target')[0]?.textContent ?? null,
    ]),
  );
}

describe('messages.en.xlf', () => {
  it('Traducciones completas', () => {
    const units = translationUnits(enMessages);

    expect(units.size).toBeGreaterThan(0);
    for (const [id, target] of units) {
      expect.soft(target?.trim(), `trans-unit "${id}" without target`).toBeTruthy();
    }
  });

  it('has exactly the units extracted from the Spanish source', () => {
    const source = [...translationUnits(sourceMessages).keys()].sort();
    const english = [...translationUnits(enMessages).keys()].sort();

    expect(english).toEqual(source);
  });
});
