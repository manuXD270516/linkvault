import { describe, expect, it } from 'vitest';
import enMessages from './messages.en.xlf' with { loader: 'text' };
import sourceMessages from './messages.xlf' with { loader: 'text' };
import { parseXlfUnits } from './privacy-text';

/**
 * Textos del aviso de indisponibilidad por vendor (spec `web/byok`, «Aviso de destino del dato»).
 *
 * Existe por una regla del change: **cualquier frase cuyo `source` cambie lleva identificador nuevo**. Una
 * traducción heredada es una promesa que sobrevive a su desmentido —ya pasó con una línea de privacidad que en
 * inglés seguía diciendo que ninguna IA leía el CV—, y aquí el desmentido es precisamente el punto: el aviso de
 * indisponibilidad niega el envío que el aviso de `data_collection` afirma. Por eso los ids nuevos no pueden
 * reutilizar `profile.byok.destination` ni `profile.byok.openrouterDataCollection`, y los de esos dos quedan
 * congelados abajo: reescribirlos rompe este test nombrándolos, y el arreglo es un id nuevo, no una edición.
 */

const NEW_UNIT_IDS = [
  'profile.byok.unavailable.reason',
  'profile.byok.unavailable.keyKept',
  'profile.byok.unavailable.notUsed',
  'profile.byok.unavailable.whatToDo',
] as const;

/** Ids cuyo texto NO describe la indisponibilidad y que por tanto no pueden reciclarse para ella. */
const INHERITED_UNIT_IDS = [
  'profile.byok.destination',
  'profile.byok.openrouterDataCollection',
  'profile.byok.keysInactive',
] as const;

/** `source` exacto (XML interno) de cada id heredado el día que entró este aviso. */
const FROZEN_SOURCES: Record<(typeof INHERITED_UNIT_IDS)[number], string> = {
  'profile.byok.destination':
    'Con el permiso de IA externa vigente, el texto de tu CV y de la oferta puede salir hacia <x id="INTERPOLATION" equiv-text="{{ label }}"/>.',
  'profile.byok.openrouterDataCollection':
    'Si el modelo configurado no es :free, LinkVault no fuerza data_collection: deny.',
  'profile.byok.keysInactive':
    'Tienes claves guardadas, pero no se usan mientras el permiso de IA externa esté desactivado. Retirar el permiso no las borró.',
};

/** `source` tal cual está en el XML (con sus `<x/>`), que es lo que identifica la frase. */
function rawSources(xliff: string): Map<string, string> {
  const units = new Map<string, string>();
  for (const unit of xliff.matchAll(
    /<trans-unit id="([^"]+)"[^>]*>\s*<source>([\s\S]*?)<\/source>/g,
  )) {
    units.set(unit[1], unit[2].replace(/\s+/g, ' ').trim());
  }
  return units;
}

const sourceUnits = parseXlfUnits(sourceMessages);
const enUnits = parseXlfUnits(enMessages);
const sourceRaw = rawSources(sourceMessages);
const enRaw = rawSources(enMessages);

describe('aviso de indisponibilidad por vendor (10-bis.7)', () => {
  it.each(NEW_UNIT_IDS)('%s existe en los dos ficheros y está traducida', (id) => {
    expect(sourceUnits.get(id)?.source, `falta en messages.xlf: ${id}`).toBeTruthy();
    const en = enUnits.get(id);
    expect(en, `falta en messages.en.xlf: ${id}`).toBeDefined();
    expect(en?.target?.trim(), `target inglés vacío: ${id}`).toBeTruthy();
  });

  it('los ids nuevos no reciclan ninguno de los heredados', () => {
    for (const id of NEW_UNIT_IDS) {
      expect(INHERITED_UNIT_IDS as readonly string[]).not.toContain(id);
      expect(id.startsWith('profile.byok.unavailable')).toBe(true);
    }
    expect(new Set(NEW_UNIT_IDS).size).toBe(NEW_UNIT_IDS.length);
  });

  it.each(INHERITED_UNIT_IDS)('%s conserva su source: cambiarlo exige un id nuevo', (id) => {
    expect(
      sourceRaw.get(id),
      `"${id}" cambió de texto sin cambiar de identificador; dale un id nuevo en vez de editarlo`,
    ).toBe(FROZEN_SOURCES[id]);
    expect(enRaw.get(id), `"${id}" tiene otro source en el fichero inglés`).toBe(
      FROZEN_SOURCES[id],
    );
  });

  it('el aviso dice las cuatro cosas, y ninguna culpa a la persona', () => {
    const es = (id: string): string => sourceUnits.get(id)?.source ?? '';
    const en = (id: string): string => enUnits.get(id)?.target ?? '';

    expect(es('profile.byok.unavailable.reason')).toMatch(/no está disponible/i);
    expect(es('profile.byok.unavailable.reason')).toMatch(/configuración de esta instancia/i);
    expect(en('profile.byok.unavailable.reason')).toMatch(/not available/i);
    expect(en('profile.byok.unavailable.reason')).toMatch(/configuration/i);

    expect(es('profile.byok.unavailable.keyKept')).toMatch(/sigue guardada y cifrada/i);
    expect(es('profile.byok.unavailable.keyKept')).toMatch(/no se ha borrado/i);
    expect(en('profile.byok.unavailable.keyKept')).toMatch(/stored and encrypted/i);
    expect(en('profile.byok.unavailable.keyKept')).toMatch(/not been deleted/i);

    expect(es('profile.byok.unavailable.notUsed')).toMatch(/no se usará/i);
    expect(es('profile.byok.unavailable.notUsed')).toMatch(/ni siquiera con el permiso/i);
    expect(en('profile.byok.unavailable.notUsed')).toMatch(/will not be used/i);
    expect(en('profile.byok.unavailable.notUsed')).toMatch(/not even with/i);

    expect(es('profile.byok.unavailable.whatToDo')).toMatch(/otro de los proveedores soportados/i);
    expect(es('profile.byok.unavailable.whatToDo')).toMatch(/administra la instancia/i);
    expect(en('profile.byok.unavailable.whatToDo')).toMatch(/another supported provider/i);
    expect(en('profile.byok.unavailable.whatToDo')).toMatch(/administers the instance/i);

    // Nada del aviso puede sugerir que el problema es la clave de la persona.
    for (const id of NEW_UNIT_IDS) {
      for (const text of [es(id), en(id)]) {
        expect(text, `"${id}" culpa a la clave de la persona`).not.toMatch(
          /cambia tu clave|revisa tu clave|clave (no válida|incorrecta)|change your key|check your key|invalid key/i,
        );
      }
    }
  });

  it('el aviso de indisponibilidad no promete que el permiso lo reactiva', () => {
    // «no se usan hasta que vuelvas a dar el permiso» es falso para un vendor sin configuración utilizable.
    for (const id of NEW_UNIT_IDS) {
      const texts = [sourceUnits.get(id)?.source ?? '', enUnits.get(id)?.target ?? ''];
      for (const text of texts) {
        expect(text, `"${id}" promete que el permiso lo activa`).not.toMatch(
          /hasta que vuelvas a dar el permiso|until you grant the permission again/i,
        );
      }
    }
  });
});
