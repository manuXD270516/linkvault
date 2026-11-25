import { describe, expect, it } from 'vitest';
import { pickSkillLabel, skillKeyOf } from './skill-key';

describe('skillKeyOf', () => {
  it('Docker variants share a key', () => {
    const keys = ['Docker', ' docker ', 'DOCKER', 'Docker\u00a0'].map(
      skillKeyOf,
    );
    expect(new Set(keys)).toEqual(new Set(['docker']));
    expect(skillKeyOf('Node   JS')).toBe(skillKeyOf('node js'));
    expect(skillKeyOf('ＤＯＣＫＥＲ')).toBe('docker');
  });

  it('empty and over-long names are ignored', () => {
    expect(skillKeyOf('')).toBeNull();
    expect(skillKeyOf('   ')).toBeNull();
    expect(skillKeyOf('x'.repeat(61))).toBeNull();
    expect(skillKeyOf('x'.repeat(60))).toBe('x'.repeat(60));
  });
});

describe('pickSkillLabel', () => {
  it('label is the most frequent form', () => {
    expect(pickSkillLabel(['docker', 'Docker', 'Docker'])).toBe('Docker');
  });

  it('label tie picks the lowest code unit order', () => {
    expect(pickSkillLabel(['docker', 'Docker'])).toBe('Docker');
  });
});
