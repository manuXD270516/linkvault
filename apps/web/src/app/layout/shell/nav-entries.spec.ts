import { NAV_ENTRIES } from './nav-entries';

describe('NAV_ENTRIES', () => {
  it('lists the entries in the agreed order', () => {
    expect(NAV_ENTRIES.map((entry) => [entry.label, entry.route])).toEqual([
      ['Grupos', '/grupos'],
      ['Solo para mí', '/mis-links'],
      ['Postulaciones', '/postulaciones'],
      ['Mi CV', '/mi-cv'],
      ['Buscar', '/buscar'],
      ['Descubrir', '/descubrir'],
      ['Perfil', '/perfil'],
    ]);
  });

  it('only Buscar and Descubrir require a capability', () => {
    expect(
      NAV_ENTRIES.filter((entry) => entry.capability !== undefined).map(
        (entry) => [entry.label, entry.capability],
      ),
    ).toEqual([
      ['Buscar', 'search'],
      ['Descubrir', 'discovery'],
    ]);
  });
});
