import { describe, expect, it } from 'vitest';
import { cvFileKey } from './cv-file-key';

const userId = '66e9a0000000000000000001';
const cvId = '66e9a0000000000000000002';

describe('cvFileKey', () => {
  it('es el identificador de la persona y el del CV, y nada más', () => {
    expect(cvFileKey(userId, cvId)).toBe(`${userId}/${cvId}`);
  });

  it('es estable para los mismos identificadores', () => {
    expect(cvFileKey(userId, cvId)).toBe(cvFileKey(userId, cvId));
  });

  it('no lleva el nombre del archivo ni su extensión', () => {
    const key = cvFileKey(userId, cvId);

    expect(key).not.toContain('.pdf');
    expect(key).not.toContain('.docx');
    expect(key).not.toContain('CV');
  });

  it('agrupa los CV de una persona bajo su prefijo', () => {
    expect(cvFileKey(userId, 'otro')).toMatch(new RegExp(`^${userId}/`));
  });
});
