import assert from 'node:assert/strict';
import test from 'node:test';
import { usableCoord } from '../packages/shared/analysis-adapter-guards.ts';

test('coordinate guard rejects missing, invalid, and Null Island positions', () => {
  assert.equal(usableCoord(null, null), false);
  assert.equal(usableCoord(0, 0), false);
  assert.equal(usableCoord(91, 0), false);
  assert.equal(usableCoord(25, 55), true);
});
