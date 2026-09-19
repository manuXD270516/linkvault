import { commentAge } from './comment-ago.component';

describe('commentAge', () => {
  const now = new Date(2026, 8, 19, 12, 0, 0);

  function at(hours: number, minutes: number, day: number): string {
    return new Date(2026, 8, day, hours, minutes, 0).toISOString();
  }

  it.each([
    ['a few seconds ago', new Date(now.getTime() - 20_000).toISOString(), { kind: 'now' }],
    ['exactly one minute ago', at(11, 59, 19), { kind: 'minutes', value: 1 }],
    ['a date in the future', at(12, 5, 19), { kind: 'now' }],
    ['a few minutes ago', at(11, 45, 19), { kind: 'minutes', value: 15 }],
    ['earlier today', at(8, 30, 19), { kind: 'hours', value: 3 }],
    ['late yesterday', at(23, 30, 18), { kind: 'yesterday' }],
    ['early yesterday', at(0, 5, 18), { kind: 'yesterday' }],
    ['two days ago', at(23, 0, 17), { kind: 'date' }],
  ])('reads %s', (_, createdAt, expected) => {
    expect(commentAge(createdAt, now)).toEqual(expected);
  });

  it('counts minutes across midnight as minutes', () => {
    const justAfterMidnight = new Date(2026, 8, 19, 0, 10, 0);

    expect(commentAge(at(23, 50, 18), justAfterMidnight)).toEqual({ kind: 'minutes', value: 20 });
  });
});
