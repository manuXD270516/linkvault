import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractJobOutputSchema, scrubContactDetails } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extractPastedJobEvaluable } from '../evaluable-tasks';
import { goldenPath, loadGolden } from '../golden.schema';
import { normalizeName } from '../metrics/name-set';
import { personNamesIn } from './metrics';

// Tarea 4.2 de paste-job-description (D2): golden de `extract-pasted-job`. Sus inputs se guardan **ya pasados por
// `scrubContactDetails`** —en una sola línea, sin emails ni teléfonos—, porque es exactamente lo que recibe la tarea.
// Es sintético, así que todos los casos van etiquetados `placeholder`.
//
// ATENCIÓN: la suite de `apps/api` consume estos casos. Sus tests pegan **exactamente** estos textos (el sembrado, en
// su versión sin limpiar, `SEEDED_RAW_TEXT`) y en replay leen los fixtures que se graban con
// `nx run ai:record-fixtures --task=extract-pasted-job`: cambiar el `input` de uno de ellos cambia su clave y deja a
// `api` con `FixtureMissing`. Los casos que consume llevan la etiqueta `api-suite`, y son:
//
// - `linkedin-app-sin-cabecera`: "Oferta de LinkedIn completada pegando su texto" y "Pegar no deja huecos" (el
//   cuerpo copiado de la app no trae la empresa).
// - `linkedin-app-con-titulo-escrito`: "Cuerpo sin cabecera, con título y empresa escritos aparte".
// - `oferta-entre-chat`: "Estado tras completar con título y empresa" y los que necesiten una oferta completa.
// - `conversacion-no-es-oferta`: "Se pegó otra cosa".
// - `sembrado-contacto-reclutador`: "Texto con datos de contacto" (6.5).
//
// Quien cambie cualquiera de ellos tiene que cambiar a la vez los tests de `api` y regrabar sus fixtures.

const EVALS_DIR = join(import.meta.dirname, '..');
const FIXTURES_DIR = join(
  import.meta.dirname,
  '../../infrastructure/fixtures/extract-pasted-job',
);

const EXPECTED_IDS = [
  'linkedin-app-sin-cabecera',
  'linkedin-app-con-titulo-escrito',
  'oferta-entre-chat',
  'en-data-analyst',
  'conversacion-no-es-oferta',
  'sembrado-contacto-reclutador',
] as const;

/** Casos que consume la suite de `api` (ver el comentario de cabecera). */
const API_SUITE_IDS = [
  'linkedin-app-sin-cabecera',
  'linkedin-app-con-titulo-escrito',
  'oferta-entre-chat',
  'conversacion-no-es-oferta',
  'sembrado-contacto-reclutador',
] as const;

/** Marca única del caso sembrado: ningún fixture puede reproducirla (6.5). */
const SEEDED_MARK = 'LVSEED-Q7X4-K9M2';
const SEEDED_EMAIL = 'ximena.choque@transportes-altiplano.example';
const SEEDED_PHONE = '+591 72041938';
const SEEDED_RECRUITER = 'Ximena Choque Arancibia';

/**
 * El caso sembrado tal y como lo pega la suite de `api`, con el email y el teléfono del reclutador. Limpio, es el
 * `input.text` del golden: la entrada que recibe la IA ya no los contiene, y eso es lo correcto.
 */
const SEEDED_RAW_TEXT = [
  'Solicitud sencilla',
  'hace 3 días · 12 solicitantes',
  'Coordinador de Logística',
  'Transportes del Altiplano · El Alto, Bolivia · Híbrido',
  `Código interno de la publicación: ${SEEDED_MARK}`,
  'Coordinarás la flota de camiones y las rutas de distribución entre El Alto, Oruro y Cochabamba, y negociarás con los proveedores de transporte.',
  'Requisitos: tres años coordinando operaciones logísticas, manejo de Excel y de un sistema de gestión de flotas.',
  `Envía tu CV a ${SEEDED_RECRUITER}, reclutadora: ${SEEDED_EMAIL} o al ${SEEDED_PHONE}.`,
].join('\n');

async function realGolden() {
  const golden = await loadGolden(extractPastedJobEvaluable, EVALS_DIR);
  if (!golden.ok) {
    throw new Error(
      `invalid golden: ${golden.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return golden.cases;
}

async function byId() {
  return new Map((await realGolden()).map((c) => [c.id, c]));
}

describe('extract-pasted-job golden set', () => {
  it('Golden set válido', async () => {
    const cases = await realGolden();

    expect(cases.map((c) => c.id)).toEqual([...EXPECTED_IDS]);
    expect(new Set(cases.map((c) => c.key)).size).toBe(cases.length);
  });

  it('marca los casos como sintéticos y no fija idioma de salida en ninguno', async () => {
    for (const goldenCase of await realGolden()) {
      expect(goldenCase.tags, goldenCase.id).toContain('placeholder');
      // `outputLanguage` es fijo `es` (ADR-022 §6): ningún caso lo pone, ni siquiera el de la oferta en inglés.
      expect(goldenCase.outputLanguage, goldenCase.id).toBeUndefined();
    }
  });

  it('guarda los inputs ya limpios: limpiarlos otra vez no los cambia', async () => {
    for (const { id, input } of await realGolden()) {
      // Si limpiar cambiara el texto, la clave que calcula `api` tras su propia limpieza no coincidiría con esta.
      expect(scrubContactDetails(input.text), id).toBe(input.text);
      expect(input.text, id).not.toMatch(/\n/u);
    }
  });

  it('no lleva contactos ni URLs', async () => {
    const raw = await readFile(
      goldenPath(EVALS_DIR, 'extract-pasted-job'),
      'utf8',
    );

    expect(raw).not.toMatch(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/u);
    expect(raw).not.toMatch(/https?:\/\//u);
    expect(raw).not.toMatch(/\+?\d[\d\s-]{6,}\d/u);
  });

  it('etiqueta api-suite exactamente los casos que consume api', async () => {
    const tagged = (await realGolden())
      .filter((c) => c.tags.includes('api-suite'))
      .map((c) => c.id);

    expect(tagged).toEqual([...API_SUITE_IDS]);
  });

  it('el cuerpo copiado de la app llega sin título ni empresa, con su ruido y el nombre del reclutador', async () => {
    const linkedin = (await byId()).get('linkedin-app-sin-cabecera');

    expect(linkedin?.input).not.toHaveProperty('knownTitle');
    expect(linkedin?.input).not.toHaveProperty('knownCompany');
    for (const noise of [
      'Solicitud sencilla',
      'hace 2 semanas',
      '43 solicitantes',
      'Valentina Arce Salinas',
    ]) {
      expect(linkedin?.input.text).toContain(noise);
    }
    // La empresa no está en el texto: acertar es responder `null`.
    expect(linkedin?.expected).toMatchObject({
      isJobPosting: true,
      company: null,
      personNames: ['Valentina Arce Salinas'],
    });
  });

  it('el título y la empresa escritos aparte llegan como contexto', async () => {
    const written = (await byId()).get('linkedin-app-con-titulo-escrito');

    expect(written?.input).toMatchObject({
      knownTitle: 'Analista Contable Senior',
      knownCompany: 'Grupo Cordillera',
    });
    expect(written?.input.text).not.toContain('Analista Contable');
    expect(written?.input.text).not.toContain('Grupo Cordillera');
    expect(written?.expected).toMatchObject({
      title: 'Analista Contable Senior',
      company: 'Grupo Cordillera',
    });
  });

  it('una oferta con ruido de chat alrededor sigue siendo una oferta', async () => {
    const chat = (await byId()).get('oferta-entre-chat');

    expect(chat?.input.text).toMatch(/^\[10:41\] Fernanda Ticona: mira/u);
    expect(chat?.expected).toMatchObject({
      isJobPosting: true,
      title: 'Ingeniero de Soporte TI',
      company: 'Distribuidora Andina',
    });
  });

  it('espera la salida en español aunque la oferta esté en inglés', async () => {
    const english = (await byId()).get('en-data-analyst');

    expect(english?.input.text).toContain('We are looking for a Data Analyst');
    expect(english?.expected).toMatchObject({
      isJobPosting: true,
      // Traducido: `outputLanguage` es fijo `es`. La empresa es un nombre propio y se copia.
      title: 'Analista de Datos',
      company: 'Lakeside Analytics',
    });
  });

  it('una conversación espera isJobPosting: false', async () => {
    const conversation = (await byId()).get('conversacion-no-es-oferta');

    expect(conversation?.expected).toEqual({ isJobPosting: false });
  });

  it('el caso sembrado es el texto de la suite de api ya limpio: sin email ni teléfono, con la marca y el reclutador', async () => {
    const seeded = (await byId()).get('sembrado-contacto-reclutador');

    expect(seeded?.input).toEqual({
      text: scrubContactDetails(SEEDED_RAW_TEXT),
    });
    expect(seeded?.input.text).toContain(SEEDED_MARK);
    expect(seeded?.input.text).toContain(SEEDED_RECRUITER);
    expect(seeded?.input.text).not.toContain(SEEDED_EMAIL);
    expect(seeded?.input.text).not.toContain('72041938');
    expect(seeded?.expected).toMatchObject({
      isJobPosting: true,
      personNames: [SEEDED_RECRUITER],
    });
  });

  it('solo espera habilidades que aparecen en el texto', async () => {
    for (const { id, input, expected } of await realGolden()) {
      if (!expected.isJobPosting) continue;
      const text = normalizeName(input.text);
      const absent = expected.skills.filter(
        (skill) => !text.includes(normalizeName(skill)),
      );
      expect(absent, id).toEqual([]);
    }
  });

  it('los nombres sembrados están en el texto de su caso', async () => {
    for (const { id, input, expected } of await realGolden()) {
      if (!expected.isJobPosting || expected.personNames === undefined) {
        continue;
      }
      for (const name of expected.personNames) {
        expect(input.text, id).toContain(name);
      }
    }
  });
});

/** Lo que estos tests leen de un fixture de replay; el formato completo lo valida el mock al leerlo. */
const recordedFixtureSchema = z.object({
  source: z.string(),
  text: z.string(),
});

describe('extract-pasted-job fixtures', () => {
  async function fixtureOutput(key: string) {
    const raw = await readFile(join(FIXTURES_DIR, `${key}.json`), 'utf8');
    const fixture = recordedFixtureSchema.parse(JSON.parse(raw));
    return {
      raw,
      output: extractJobOutputSchema.parse(JSON.parse(fixture.text)),
    };
  }

  it('cada caso tiene su fixture grabado contra un proveedor local', async () => {
    for (const { id, key } of await realGolden()) {
      const { raw } = await fixtureOutput(key);
      const { source } = recordedFixtureSchema.parse(JSON.parse(raw));
      expect(source, id).toMatch(/^recorded:ollama:/u);
    }
  });

  it('ningún fixture reproduce en los campos de texto un nombre de persona sembrado', async () => {
    for (const { id, key, expected } of await realGolden()) {
      if (!expected.isJobPosting || expected.personNames === undefined) {
        continue;
      }
      const { output } = await fixtureOutput(key);
      const preview = output.preview;
      const fields = [preview?.summary, preview?.title, preview?.location];
      for (const field of fields) {
        expect(personNamesIn(field ?? '', expected.personNames), id).toEqual(
          [],
        );
      }
    }
  });

  it('ningún fixture reproduce la marca, el email ni el teléfono sembrados', async () => {
    for (const { id, key } of await realGolden()) {
      const { raw } = await fixtureOutput(key);
      expect(raw, id).not.toContain(SEEDED_MARK);
      expect(raw, id).not.toContain(SEEDED_EMAIL);
      expect(raw, id).not.toContain('72041938');
    }
  });
});
