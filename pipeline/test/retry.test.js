import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryOnDeadCredential } from '../lib/retry.js';

test('a dead credential: reconnect once, then the work succeeds', async () => {
  let calls = 0;
  let reconnects = 0;
  const out = await retryOnDeadCredential(async () => {
    calls += 1;
    if (calls === 1) throw new Error('password authentication failed for user "v-approle-keeper-x"');
    return 'rows';
  }, async () => { reconnects += 1; });
  assert.equal(out, 'rows');
  assert.equal(reconnects, 1);
});

test('any other error is not retried', async () => {
  let reconnects = 0;
  await assert.rejects(retryOnDeadCredential(async () => { throw new Error('relation "frames" does not exist'); }, async () => { reconnects += 1; }), /does not exist/);
  assert.equal(reconnects, 0);
});

test('a second failure after the reconnect reaches the caller', async () => {
  await assert.rejects(retryOnDeadCredential(async () => { throw new Error('password authentication failed'); }, async () => {}), /password authentication failed/);
});
