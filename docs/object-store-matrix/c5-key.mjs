// Formas de una clave de cifrado para C5 (tarea 2.9 de `object-store`, design D2). Lo usan `find-plaintext.mjs`, que
// busca en el volumen los bytes de la clave **decodificada** y su forma **textual** tal como va en el fichero de
// entorno, y `c5-helpers.mjs`, que deriva la otra clave K2 de la prueba (b) con **el mismo formato** que K1: una K2
// mal formada haría que el producto no arrancara por el formato y no por la clave, y eso no probaría nada.
//
// Una clave textual es `<prefijo><contenido>`: el contenido es lo que va tras el último `:` si lo hay (MinIO:
// `<nombre>:<base64 de 32 bytes>`), o el texto entero; se reconoce en hexadecimal o en base64 (un contenido que
// cumple las dos se prueba de las dos maneras). Nunca imprime la clave.

import { randomBytes } from 'node:crypto';

const MIN_BYTES = 16;

function asHex(text) {
  if (!/^[0-9a-fA-F]+$/.test(text) || text.length % 2 !== 0) {
    return undefined;
  }
  const bytes = Buffer.from(text, 'hex');
  return bytes.length >= MIN_BYTES ? bytes : undefined;
}

function asBase64(text) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4 !== 0) {
    return undefined;
  }
  const bytes = Buffer.from(text, 'base64');
  return bytes.length >= MIN_BYTES && bytes.toString('base64') === text ? bytes : undefined;
}

/**
 * Descompone una clave textual.
 * @param {string} text
 * @returns {{ text: string, prefix: string, content: string, decoded: { encoding: 'hex' | 'base64', bytes: Buffer }[] }}
 */
export function parseKey(text) {
  const colon = text.lastIndexOf(':');
  const splits = colon >= 0 ? [colon + 1, 0] : [0];
  for (const at of splits) {
    const content = text.slice(at);
    const decoded = [];
    const hex = asHex(content);
    if (hex !== undefined) {
      decoded.push({ encoding: 'hex', bytes: hex });
    }
    const b64 = asBase64(content);
    if (b64 !== undefined) {
      decoded.push({ encoding: 'base64', bytes: b64 });
    }
    if (decoded.length > 0) {
      return { text, prefix: text.slice(0, at), content, decoded };
    }
  }
  return { text, prefix: '', content: text, decoded: [] };
}

/**
 * Las formas que se buscan en el volumen: la textual, el contenido codificado si difiere de ella, y cada lectura
 * decodificada.
 * @param {string} text
 * @returns {{ label: string, bytes: Buffer }[]}
 */
export function keyForms(text) {
  const parsed = parseKey(text);
  const forms = [{ label: 'textual', bytes: Buffer.from(text, 'utf8') }];
  if (parsed.content !== text) {
    forms.push({ label: 'contenido', bytes: Buffer.from(parsed.content, 'utf8') });
  }
  for (const { encoding, bytes } of parsed.decoded) {
    forms.push({ label: `decodificada (${encoding}, ${bytes.length} bytes)`, bytes });
  }
  return forms;
}

/**
 * Otra clave con el mismo formato: mismo prefijo, contenido aleatorio de la misma longitud y codificación.
 * @param {string} text
 * @returns {string}
 */
export function deriveOtherKey(text) {
  const parsed = parseKey(text);
  const first = parsed.decoded[0];
  if (first === undefined) {
    throw new Error('the key content is neither hex nor base64: set C5_K2 by hand');
  }
  for (;;) {
    const bytes = randomBytes(first.bytes.length);
    let content = first.encoding === 'hex' ? bytes.toString('hex') : bytes.toString('base64');
    if (first.encoding === 'hex' && parsed.content === parsed.content.toUpperCase()) {
      content = content.toUpperCase();
    }
    if (content !== parsed.content) {
      return `${parsed.prefix}${content}`;
    }
  }
}
