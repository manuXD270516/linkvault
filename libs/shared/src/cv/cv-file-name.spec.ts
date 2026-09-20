import { describe, expect, it } from 'vitest';
import type { CvFileType } from './cv-file';
import { CV_FILE_NAME_MAX_LENGTH, safeCvFileName } from './cv-file-name';

describe('safeCvFileName', () => {
  const table: ReadonlyArray<readonly [string, string, CvFileType, string]> = [
    [
      'se queda con el último segmento tras la barra',
      '../../etc/passwd.pdf',
      'pdf',
      'passwd.pdf',
    ],
    [
      'se queda con el último segmento tras la barra invertida',
      'C:\\Users\\Ana\\CV.pdf',
      'pdf',
      'CV.pdf',
    ],
    [
      'quita el cambio de dirección del texto',
      'CV\u202Efdp.pdf',
      'pdf',
      'CVfdp.pdf',
    ],
    [
      'quita el aislamiento direccional',
      'CV\u2066a\u2069.pdf',
      'pdf',
      'CVa.pdf',
    ],
    [
      'quita comillas, barras invertidas y punto y coma',
      'CV"a;b.pdf',
      'pdf',
      'CVab.pdf',
    ],
    [
      'deja un nombre normal tal cual',
      'CV_backend.pdf',
      'pdf',
      'CV_backend.pdf',
    ],
    ['sustituye un nombre vacío', '', 'pdf', 'cv.pdf'],
    ['sustituye un nombre que solo era su extensión', '   .pdf', 'docx', 'cv.docx'],
  ];

  it.each(table)('%s', (_name, input, type, expected) => {
    expect(safeCvFileName(input, type)).toBe(expected);
  });

  it('recorta a 120 code points conservando la extensión', () => {
    const result = safeCvFileName(`${'a'.repeat(300)}.pdf`, 'pdf');

    expect([...result]).toHaveLength(CV_FILE_NAME_MAX_LENGTH);
    expect(result.endsWith('.pdf')).toBe(true);
  });

  it('cuenta code points y no unidades UTF-16 al recortar', () => {
    const result = safeCvFileName(`${'\u{1F600}'.repeat(200)}.pdf`, 'pdf');

    expect([...result]).toHaveLength(CV_FILE_NAME_MAX_LENGTH);
  });

  it('no deja pasar ningún carácter de control', () => {
    const result = safeCvFileName('CV\u0000\u001F\u007F.pdf', 'pdf');

    expect(result).toBe('CV.pdf');
  });

  it('usa el respaldo del tipo detectado y no el de la extensión recibida', () => {
    expect(safeCvFileName('/', 'docx')).toBe('cv.docx');
    expect(safeCvFileName('CV.odt', 'pdf')).toBe('CV.odt');
  });

  it('acepta un nombre sin extensión', () => {
    expect(safeCvFileName('mi curriculum', 'pdf')).toBe('mi curriculum');
  });
});
