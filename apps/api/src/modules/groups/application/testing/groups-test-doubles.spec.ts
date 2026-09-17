import { describe, expect, it } from 'vitest';
import { isValidInviteCode } from '../../domain/invite-code';
import {
  InMemoryMemberDirectory,
  MovableClock,
  sequentialInviteCode,
  StubInviteCodeGenerator,
} from './groups-test-doubles';

describe('MovableClock', () => {
  it('returns a copy of the current instant and moves on demand', () => {
    const clock = new MovableClock(new Date('2026-09-17T10:00:00.000Z'));
    const first = clock.now();

    clock.advance(60_000);

    expect(first.toISOString()).toBe('2026-09-17T10:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-09-17T10:01:00.000Z');
  });
});

describe('StubInviteCodeGenerator', () => {
  it('hands the given codes in order and counts the calls', () => {
    const generator = new StubInviteCodeGenerator(['A2B3C4D5', 'Z9Y8X7W6']);

    expect(generator.generate()).toBe('A2B3C4D5');
    expect(generator.generate()).toBe('Z9Y8X7W6');
    expect(generator.calls).toBe(2);
  });

  it('keeps giving different valid codes once the list runs out', () => {
    const generator = new StubInviteCodeGenerator(['A2B3C4D5']);
    const codes = [
      generator.generate(),
      generator.generate(),
      generator.generate(),
    ];

    expect(new Set(codes).size).toBe(3);
    for (const code of codes) {
      expect(isValidInviteCode(code)).toBe(true);
    }
  });

  it('repeats a code when the list repeats it', () => {
    const generator = new StubInviteCodeGenerator(['A2B3C4D5', 'A2B3C4D5']);

    expect(generator.generate()).toBe(generator.generate());
  });
});

describe('sequentialInviteCode', () => {
  it('builds codes with the format of the domain', () => {
    expect(sequentialInviteCode(0)).toBe('22222222');
    expect(sequentialInviteCode(1)).toBe('22222223');
    expect(isValidInviteCode(sequentialInviteCode(12_345))).toBe(true);
  });
});

describe('InMemoryMemberDirectory', () => {
  it('returns the display name of every known id', async () => {
    const directory = new InMemoryMemberDirectory()
      .set('66e9a0000000000000000001', 'Ana')
      .set('66e9a0000000000000000002', 'Beto');

    await expect(
      directory.displayNamesOf([
        '66e9a0000000000000000001',
        '66e9a0000000000000000002',
      ]),
    ).resolves.toEqual(
      new Map([
        ['66e9a0000000000000000001', 'Ana'],
        ['66e9a0000000000000000002', 'Beto'],
      ]),
    );
  });

  it('leaves an unknown id out of the map', async () => {
    const directory = new InMemoryMemberDirectory().set(
      '66e9a0000000000000000001',
      'Ana',
    );

    const names = await directory.displayNamesOf([
      '66e9a0000000000000000001',
      '66e9a0000000000000000009',
    ]);

    expect(names.size).toBe(1);
    expect(names.has('66e9a0000000000000000009')).toBe(false);
  });
});
