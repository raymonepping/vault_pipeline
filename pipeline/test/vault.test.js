import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VaultError, isRefusal } from '../lib/vault.js';

test('only Vault\'s own 4xx answer is a refusal; an outage is an error', () => {
  assert.equal(isRefusal(new VaultError(403, ['1 error occurred:\n\t* permission denied\n\n'], 'transit/decrypt/board')), true);
  assert.equal(isRefusal(new VaultError(400, ['ciphertext or signature version is disallowed by policy (too old)'], 'x')), true);
  assert.equal(isRefusal(new VaultError(503, ['Vault is sealed'], 'x')), false);
  assert.equal(isRefusal(new Error('timeout after 10000 ms')), false);
  assert.equal(new VaultError(403, ['1 error occurred:\n\t* permission denied\n\n'], 'x').said, 'permission denied');
});
