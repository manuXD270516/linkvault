import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractJobEvaluable } from '../evaluable-tasks';
import { goldenPath, loadGolden } from '../golden.schema';
import { normalizeName } from '../metrics/name-set';

// Tarea 4.3 de link-enrichment (D8): golden sintético de `extract-job` con los siete casos acordados. Es sintético a
// propósito —las vacantes reales se graban después, con `/lv:golden`—, así que todos los casos van etiquetados
// `placeholder` para que el reporte no presente sus métricas como calidad medida.

const EVALS_DIR = join(import.meta.dirname, '..');

/** Los siete casos de D8, en orden de archivo. */
const EXPECTED_IDS = [
  'trabajopolis-jsonld',
  'getonbrd-open-graph',
  'empresa-generica',
  'en-data-engineer',
  'aviso-confidencial',
  'salario-en-rango',
  'pagina-de-listado',
] as const;

async function realGolden() {
  const golden = await loadGolden(extractJobEvaluable, EVALS_DIR);
  if (!golden.ok) {
    throw new Error(
      `invalid golden: ${golden.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return golden.cases;
}

describe('extract-job golden set', () => {
  it('Golden set válido', async () => {
    const cases = await realGolden();

    expect(cases.map((c) => c.id)).toEqual([...EXPECTED_IDS]);
    expect(new Set(cases.map((c) => c.key)).size).toBe(cases.length);
  });

  it('marca los casos como sintéticos y no fija idioma de salida en ninguno', async () => {
    for (const goldenCase of await realGolden()) {
      expect(goldenCase.tags, goldenCase.id).toContain('placeholder');
      // `outputLanguage` es fijo `es` para esta tarea (D7): ningún caso lo pone, ni siquiera el de la página inglesa.
      expect(goldenCase.outputLanguage, goldenCase.id).toBeUndefined();
      expect(
        goldenCase.input.text.length,
        goldenCase.id,
      ).toBeGreaterThanOrEqual(300);
      expect(goldenCase.input.text.length, goldenCase.id).toBeLessThanOrEqual(
        1_200,
      );
    }
  });

  it('cubre los siete casos de D8', async () => {
    const cases = await realGolden();
    const byId = new Map(cases.map((c) => [c.id, c]));

    // La página de listado es la trampa: lo único que se espera de ella es que la tarea diga que no es una vacante.
    expect(byId.get('pagina-de-listado')?.expected).toEqual({
      isJobPosting: false,
    });
    // Un aviso confidencial se acierta respondiendo `null`, no inventando una empresa.
    const confidential = byId.get('aviso-confidencial')?.expected;
    expect(confidential).toMatchObject({ isJobPosting: true, company: null });
    // Un salario en rango: el texto lo publica aunque la métrica no compare ese campo.
    expect(byId.get('salario-en-rango')?.input.text).toMatch(
      /Bs 9\.000 a Bs 13\.000/,
    );
    expect(
      cases.filter((c) => c.expected.isJobPosting && c.expected.modality),
    ).toHaveLength(6);
    expect(
      new Set(
        cases.flatMap((c) =>
          c.expected.isJobPosting ? [c.expected.modality] : [],
        ),
      ),
    ).toEqual(new Set(['onsite', 'remote', 'hybrid']));
  });

  it('espera la salida en español aunque la página esté en inglés', async () => {
    const byId = new Map((await realGolden()).map((c) => [c.id, c]));
    const english = byId.get('en-data-engineer');

    expect(english?.input.text).toContain('Senior Data Engineer');
    expect(english?.expected).toMatchObject({
      isJobPosting: true,
      // Traducido: `outputLanguage` es fijo `es`. La empresa es un nombre propio y se copia.
      title: 'Ingeniero de Datos Senior',
      company: 'Northwind Labs',
    });
    expect(
      english?.expected.isJobPosting === true ? english.expected.skills : [],
    ).toContain('Inglés');
  });

  it('solo espera habilidades que aparecen en el texto', async () => {
    for (const { id, input, expected } of await realGolden()) {
      if (!expected.isJobPosting) continue;
      const text = normalizeName(input.text);
      // "Inglés" aparece en el aviso en inglés como "English": es lo que la traducción al español debe producir.
      const absent = expected.skills.filter(
        (skill) =>
          !text.includes(normalizeName(skill)) &&
          !(skill === 'Inglés' && text.includes('english')),
      );
      expect(absent, id).toEqual([]);
    }
  });

  it('no lleva contactos ni URLs reales', async () => {
    const raw = await readFile(goldenPath(EVALS_DIR, 'extract-job'), 'utf8');

    expect(raw).not.toMatch(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
    expect(raw).not.toMatch(/https?:\/\//);
    expect(raw).not.toMatch(/\+?\d[\d\s-]{6,}\d/);
  });
});
