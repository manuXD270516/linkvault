import { staleSources } from './i18n-catalog';
import enMessages from './messages.en.xlf' with { loader: 'text' };
import sourceMessages from './messages.xlf' with { loader: 'text' };

/** Unidades de un XLIFF 1.2 por id, con su elemento `target` (null si falta). */
function translationUnits(xliff: string): Map<string, Element | null> {
  const document = new DOMParser().parseFromString(xliff, 'application/xml');
  expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
  return new Map(
    Array.from(document.getElementsByTagName('trans-unit')).map((unit) => [
      unit.getAttribute('id') ?? '',
      unit.getElementsByTagName('target')[0] ?? null,
    ]),
  );
}

/**
 * Un `target` está traducido si tiene texto o, al menos, los marcadores del mensaje: el mensaje que solo envuelve un
 * plural (`{{ n }} {n, plural, …}`) es únicamente `<x/>`, y sus palabras viven en la unidad del ICU, que sí se comprueba.
 */
function isTranslated(target: Element | null): boolean {
  return (
    target !== null && ((target.textContent?.trim() ?? '') !== '' || target.childElementCount > 0)
  );
}

describe('messages.en.xlf', () => {
  it('Traducciones completas', () => {
    const units = translationUnits(enMessages);

    expect(units.size).toBeGreaterThan(0);
    for (const [id, target] of units) {
      expect.soft(isTranslated(target), `trans-unit "${id}" without target`).toBe(true);
    }
  });

  it('never says "owner" in Spanish', () => {
    // En español el rol es siempre "propietario" (spec web/groups); `owner` solo es el valor de `role` en la API.
    const document = new DOMParser().parseFromString(sourceMessages, 'application/xml');
    const sources = Array.from(document.getElementsByTagName('source'));

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect.soft(source.textContent ?? '').not.toMatch(/owner/i);
    }
  });

  // Escenarios «Unidad sin traducir» y «Unidad huérfana en inglés» (spec web/i18n). Que `messages.xlf` sea a su vez lo que
  // producen las fuentes lo comprueba `nx run web:i18n-check`, no esta prueba.
  it('has exactly the units extracted from the Spanish source', () => {
    const source = [...translationUnits(sourceMessages).keys()].sort();
    const english = [...translationUnits(enMessages).keys()].sort();

    expect(english).toEqual(source);
  });

  // Requirement «Traducción inglesa vigente» (spec web/i18n): cambiar un texto español obliga a actualizar su original en
  // messages.en.xlf, y con él a revisar la traducción. Los escenarios se prueban en i18n-catalog.spec.ts.
  it('translates the current Spanish text of every unit', () => {
    expect(staleSources(new DOMParser(), sourceMessages, enMessages)).toEqual([]);
  });
});
