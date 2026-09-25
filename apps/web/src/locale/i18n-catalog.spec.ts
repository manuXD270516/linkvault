import { compareCatalogs, staleSources } from './i18n-catalog';

interface Unit {
  readonly id: string;
  /** Contenido de `source` tal cual se escribe en el XLIFF (puede llevar placeholders `<x/>`). */
  readonly source: string;
  readonly file?: string;
  readonly line?: number;
}

/** XLIFF 1.2 con la misma forma que escribe `@angular/build:extract-i18n`. */
function xliff(units: readonly Unit[]): string {
  const body = units
    .map(
      ({ id, source, file = 'apps/web/src/app/app.html', line = 1 }) => `      <trans-unit id="${id}" datatype="html">
        <source>${source}</source>
        <context-group purpose="location">
          <context context-type="sourcefile">${file}</context>
          <context context-type="linenumber">${line}</context>
        </context-group>
      </trans-unit>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="es" datatype="plaintext" original="ng2.template">
    <body>
${body}
    </body>
  </file>
</xliff>
`;
}

const parser = new DOMParser();

const committedUnits: readonly Unit[] = [
  { id: 'discovery.title', source: 'Descubrir', line: 3 },
  { id: 'discovery.submit', source: ' Buscar ', line: 40 },
  {
    id: 'links.count',
    source: '<x id="INTERPOLATION" equiv-text="{{ total }}"/> links',
    file: 'apps/web/src/app/features/links/links.page.html',
    line: 12,
  },
];

describe('compareCatalogs', () => {
  it('Catálogo al día', () => {
    const catalog = xliff(committedUnits);

    expect(compareCatalogs(parser, catalog, catalog)).toEqual({ equal: true });
  });

  it('Texto nuevo sin extraer', () => {
    const extracted = xliff([...committedUnits, { id: 'profile.byok.newHint', source: 'Nuevo aviso', line: 7 }]);

    expect(compareCatalogs(parser, extracted, xliff(committedUnits))).toEqual({
      equal: false,
      added: ['profile.byok.newHint'],
      removed: [],
      changed: [],
      unparseable: false,
    });
  });

  it('Texto nuevo en código sin extraer', () => {
    const extracted = xliff([
      ...committedUnits,
      { id: 'links.snack.newNotice', source: 'Link guardado', file: 'apps/web/src/app/features/links/links.store.ts', line: 88 },
    ]);

    expect(compareCatalogs(parser, extracted, xliff(committedUnits))).toMatchObject({
      equal: false,
      added: ['links.snack.newNotice'],
    });
  });

  it('Texto español cambiado sin extraer', () => {
    const extracted = xliff(
      committedUnits.map((unit) => (unit.id === 'discovery.submit' ? { ...unit, source: ' Buscar vacantes ' } : unit)),
    );

    expect(compareCatalogs(parser, extracted, xliff(committedUnits))).toEqual({
      equal: false,
      added: [],
      removed: [],
      changed: ['discovery.submit'],
      unparseable: false,
    });
  });

  it('Solo se movieron líneas', () => {
    const extracted = xliff(committedUnits.map((unit) => ({ ...unit, line: (unit.line ?? 1) + 4 })));

    expect(compareCatalogs(parser, extracted, xliff(committedUnits))).toEqual({
      equal: false,
      added: [],
      removed: [],
      changed: [],
      unparseable: false,
    });
  });

  it('solo cambia el orden de las unidades', () => {
    const extracted = xliff([...committedUnits].reverse());

    expect(compareCatalogs(parser, extracted, xliff(committedUnits))).toMatchObject({
      equal: false,
      added: [],
      removed: [],
      changed: [],
    });
  });

  it('Catálogo editado a mano', () => {
    const handEdited = xliff(
      committedUnits.map((unit) => (unit.id === 'discovery.submit' ? { ...unit, source: 'Buscar' } : unit)),
    );

    expect(compareCatalogs(parser, xliff(committedUnits), handEdited)).toMatchObject({
      equal: false,
      changed: ['discovery.submit'],
    });
  });

  it('names units the extraction no longer produces', () => {
    const extracted = xliff(committedUnits.filter((unit) => unit.id !== 'discovery.title'));

    expect(compareCatalogs(parser, extracted, xliff(committedUnits))).toMatchObject({
      equal: false,
      added: [],
      removed: ['discovery.title'],
    });
  });

  it('never reports a broken catalog as equal', () => {
    const broken = xliff(committedUnits).replace('</body>', '');

    expect(compareCatalogs(parser, xliff(committedUnits), broken)).toEqual({
      equal: false,
      added: [],
      removed: [],
      changed: [],
      unparseable: true,
    });
  });
});

describe('staleSources', () => {
  it('Texto español cambiado sin revisar la traducción', () => {
    const spanish = xliff([{ id: 'discovery.submit', source: 'Buscar vacantes' }]);
    const english = xliff([{ id: 'discovery.submit', source: 'Buscar' }]);

    expect(staleSources(parser, spanish, english)).toEqual(['discovery.submit']);
  });

  it('Solo cambian espacios', () => {
    const spanish = xliff([{ id: 'discovery.submit', source: ' Buscar ' }]);
    const english = xliff([{ id: 'discovery.submit', source: 'Buscar' }]);

    expect(staleSources(parser, spanish, english)).toEqual([]);
  });

  it('compares placeholders as part of the original', () => {
    const spanish = xliff([{ id: 'links.count', source: '<x id="INTERPOLATION" equiv-text="{{ count }}"/> links' }]);
    const english = xliff([{ id: 'links.count', source: '<x id="INTERPOLATION" equiv-text="{{ total }}"/> links' }]);

    expect(staleSources(parser, spanish, english)).toEqual(['links.count']);
  });

  it('ignores units missing from one of the catalogs', () => {
    const spanish = xliff([{ id: 'discovery.title', source: 'Descubrir' }]);
    const english = xliff([{ id: 'discovery.submit', source: 'Buscar' }]);

    expect(staleSources(parser, spanish, english)).toEqual([]);
  });

  it('throws on an invalid catalog', () => {
    expect(() => staleSources(parser, '<xliff>', xliff(committedUnits))).toThrow('Invalid XLIFF');
  });
});
