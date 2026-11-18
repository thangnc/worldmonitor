import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getRpcErrorStatusCode } from '../packages/client/services/rpc-client';

test('getRpcErrorStatusCode returns numeric statusCode from object errors', () => {
  assert.equal(getRpcErrorStatusCode({ statusCode: 404 }), 404);
  assert.equal(getRpcErrorStatusCode({ statusCode: 403, message: 'forbidden' }), 403);
});

test('getRpcErrorStatusCode returns undefined for non-object inputs', () => {
  assert.equal(getRpcErrorStatusCode(null), undefined);
  assert.equal(getRpcErrorStatusCode(undefined), undefined);
  assert.equal(getRpcErrorStatusCode('error'), undefined);
  assert.equal(getRpcErrorStatusCode(500), undefined);
});

test('getRpcErrorStatusCode returns undefined when statusCode is missing or non-numeric', () => {
  assert.equal(getRpcErrorStatusCode({}), undefined);
  assert.equal(getRpcErrorStatusCode({ statusCode: '404' }), undefined);
  assert.equal(getRpcErrorStatusCode({ statusCode: null }), undefined);
});
