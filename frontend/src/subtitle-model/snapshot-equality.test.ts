import { expect, it } from 'vitest';
import { sameSnapshotValue } from './snapshot-equality';

it('compares nested JSON fields independently of object insertion order', () => {
  expect(sameSnapshotValue([{ id: 'a', ass_fields: { Layer: '0', Name: 'Actor' } }],
    [{ ass_fields: { Name: 'Actor', Layer: '0' }, id: 'a' }])).toBe(true);
});

it('preserves array order, field presence and scalar types', () => {
  for (const [left, right] of [
    [[{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'a' }]],
    [{ a: '1' }, { a: 1 }], [{ a: null }, {}], [null, {}], [[], {}],
  ]) expect(sameSnapshotValue(left, right)).toBe(false);
});
