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

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVault } from '../lib/vault.js';

// A fake Vault: unwrap returns a secret id, login returns a token with the
// given lease. Synthetic values only.
async function loggedIn(lease) {
  const dir = mkdtempSync(join(tmpdir(), 'vpip-test-'));
  writeFileSync(join(dir, 'role_id'), 'synthetic-role-id');
  writeFileSync(join(dir, 'wrapped'), 'synthetic-wrap');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).endsWith('sys/wrapping/unwrap') ? { data: { secret_id: 'synthetic-secret-id' } } : { auth: { client_token: 'synthetic-token', lease_duration: lease, accessor: 'acc', token_policies: [] } }),
  });
  try {
    const v = createVault({ addrs: ['https://vault.test'] });
    await v.secretZero({ roleIdFile: join(dir, 'role_id'), wrappedFile: join(dir, 'wrapped') });
    v.stop();
    return v;
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('a workload is ready only while its token has time left', async () => {
  assert.equal((await loggedIn(3600)).ready, true);
  assert.equal((await loggedIn(0)).ready, false, 'an expired token is not ready');
});
