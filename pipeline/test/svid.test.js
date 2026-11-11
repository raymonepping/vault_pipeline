// The verifier against a test signing key standing in for Vault's JWKS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createVerifier, SvidRefusal, workloadOf, spiffeId } from '../lib/svid.js';

const TD = 'pipeline.lab';
const ISS = 'https://vault.pipeline.lab/v1/spiffe';
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'ES256' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

let clock = 1_000_000;
let jti = 0;
function token(claims = {}, header = {}) {
  const h = b64({ alg: 'ES256', kid: 'k1', ...header });
  const c = b64({ sub: spiffeId(TD, 'scribe'), aud: [spiffeId(TD, 'keeper')], iss: ISS, iat: clock, nbf: clock, exp: clock + 60, jti: `j${++jti}`, ...claims });
  const s = sign('sha256', Buffer.from(`${h}.${c}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${h}.${c}.${s}`;
}
let fetches = 0;
const verifier = () => createVerifier({ self: 'keeper', trustDomain: TD, issuer: ISS, now: () => clock, fetchJwks: async () => { fetches++; return { keys: [jwk] }; } });
const refused = async (v, t, code) => assert.rejects(v.verify(t), (e) => e instanceof SvidRefusal && e.code === code);

test('a badge for this workload is accepted once and names its caller', async () => {
  const v = verifier();
  const t = token();
  assert.equal((await v.verify(t)).caller, 'scribe');
  await refused(v, t, 'replayed');
});

test('a badge for another workload is refused', async () => {
  await refused(verifier(), token({ aud: [spiffeId(TD, 'librarian')] }), 'wrong-audience');
});

test('a badge past its minute is refused; within the skew it is not', async () => {
  const v = verifier();
  const t = token();
  clock += 64;
  assert.equal((await v.verify(t)).caller, 'scribe');
  const late = token({ exp: clock - 10 });
  await refused(v, late, 'expired');
});

test('an edited claim breaks the signature', async () => {
  const [h, , s] = token().split('.');
  const edited = `${h}.${b64({ sub: spiffeId(TD, 'librarian'), aud: [spiffeId(TD, 'keeper')], iss: ISS, exp: clock + 60, jti: 'x' })}.${s}`;
  await refused(verifier(), edited, 'bad-signature');
});

test('another issuer, a missing jti, a foreign trust domain, garbage', async () => {
  const v = verifier();
  await refused(v, token({ iss: 'https://elsewhere/v1/spiffe' }), 'bad-signature');
  await refused(v, token({ jti: undefined }), 'malformed');
  await refused(v, token({ sub: 'spiffe://other.lab/workload/scribe' }), 'not-a-guest');
  await refused(v, 'not.a.jwt', 'malformed');
});

test('an unknown kid refetches the JWKS at most every 30 s', async () => {
  const v = verifier();
  await v.verify(token());
  const before = fetches;
  for (let i = 0; i < 5; i++) await refused(v, token({}, { kid: `made-up-${i}` }), 'bad-signature');
  assert.equal(fetches, before, 'no refetch within 30 s of the last one');
  clock += 31;
  await refused(v, token({}, { kid: 'k2' }), 'bad-signature');
  assert.equal(fetches, before + 1, 'one refetch after 30 s');
});

test('SPIFFE IDs map to workload names, nothing else does', () => {
  assert.equal(workloadOf(TD, 'spiffe://pipeline.lab/workload/keeper'), 'keeper');
  assert.equal(workloadOf(TD, 'spiffe://pipeline.lab/workload/keeper/x'), null);
  assert.equal(workloadOf(TD, 'spiffe://pipelineXlab/workload/keeper'), null);
});
