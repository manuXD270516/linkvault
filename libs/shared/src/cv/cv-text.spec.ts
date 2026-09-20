import { describe, expect, it } from 'vitest';
import { CV_TEXT_MAX_CHARS, CV_TEXT_PREVIEW_CHARS } from './cv-limits';
import { cvTextPreview, prepareCvText } from './cv-text';

const CONTROL_SAMPLE = String.fromCharCode(0, 7, 27);
const TAB = String.fromCharCode(9);

describe('prepareCvText', () => {
  const table: ReadonlyArray<readonly [string, string, string]> = [
    ['pasa \\r\\n y \\r a \\n', 'una\r\ndos\rtres', 'una\ndos\ntres'],
    [
      'quita los caracteres de control salvo los saltos y el tabulador',
      `una${CONTROL_SAMPLE}dos${TAB}tres`,
      `unados${TAB}tres`,
    ],
    [
      'colapsa las líneas en blanco repetidas',
      'una\n\n\n\n\ndos',
      'una\n\ndos',
    ],
    ['recorta los extremos', '  \n una \n  ', 'una'],
    ['deja la cadena vacía en vacío', '', ''],
  ];

  it.each(table)('%s', (_name, raw, expected) => {
    expect(prepareCvText(raw).text).toBe(expected);
  });

  it('cuenta los caracteres guardados', () => {
    const prepared = prepareCvText('a'.repeat(99));

    expect(prepared.chars).toBe(99);
    expect(prepared.truncated).toBe(false);
  });

  it('recorta a 200.000 caracteres y lo marca', () => {
    const prepared = prepareCvText('a'.repeat(CV_TEXT_MAX_CHARS + 1));

    expect(prepared.chars).toBe(CV_TEXT_MAX_CHARS);
    expect([...prepared.text]).toHaveLength(CV_TEXT_MAX_CHARS);
    expect(prepared.truncated).toBe(true);
  });

  it('no marca como recortado un texto de exactamente el tope', () => {
    const prepared = prepareCvText('a'.repeat(CV_TEXT_MAX_CHARS));

    expect(prepared.truncated).toBe(false);
    expect(prepared.chars).toBe(CV_TEXT_MAX_CHARS);
  });

  it('mide en code points y no parte un carácter por la mitad', () => {
    const prepared = prepareCvText('\u{1F600}'.repeat(CV_TEXT_MAX_CHARS + 10));

    expect(prepared.chars).toBe(CV_TEXT_MAX_CHARS);
    expect([...prepared.text]).toHaveLength(CV_TEXT_MAX_CHARS);
    expect(prepared.text.endsWith('\u{1F600}')).toBe(true);
  });

  it('deja el texto vacío con cero caracteres y sin recorte', () => {
    expect(prepareCvText('   \n\n  ')).toEqual({
      text: '',
      chars: 0,
      truncated: false,
    });
  });
});

describe('cvTextPreview', () => {
  it('devuelve entero un texto corto', () => {
    expect(cvTextPreview('Experiencia en backend')).toEqual({
      text: 'Experiencia en backend',
      chars: 22,
    });
  });

  it('devuelve exactamente el límite con un texto largo sin espacios', () => {
    const preview = cvTextPreview('a'.repeat(CV_TEXT_PREVIEW_CHARS + 500));

    expect(preview.chars).toBe(CV_TEXT_PREVIEW_CHARS);
  });

  it('corta en el último salto anterior al límite', () => {
    const text = `${'a'.repeat(CV_TEXT_PREVIEW_CHARS - 10)}\n${'b'.repeat(500)}`;

    const preview = cvTextPreview(text);

    expect(preview.chars).toBe(CV_TEXT_PREVIEW_CHARS - 10);
    expect(preview.text.endsWith('a')).toBe(true);
  });

  it('corta en el último espacio anterior al límite', () => {
    const text = `${'a'.repeat(CV_TEXT_PREVIEW_CHARS - 4)} ${'b'.repeat(500)}`;

    const preview = cvTextPreview(text);

    expect(preview.chars).toBe(CV_TEXT_PREVIEW_CHARS - 4);
  });

  it('devuelve vacío un texto vacío', () => {
    expect(cvTextPreview('')).toEqual({ text: '', chars: 0 });
  });

  it('devuelve entero un texto de exactamente el límite', () => {
    const text = `${'a'.repeat(CV_TEXT_PREVIEW_CHARS - 1)} `;

    const preview = cvTextPreview(text);

    expect(preview.chars).toBe(CV_TEXT_PREVIEW_CHARS);
    expect(preview.text).toBe(text);
  });
});
