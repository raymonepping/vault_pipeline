// pipeline/lib/svid.js: JWT-SVIDs (D10, probe P2). A workload mints one SVID
// per call, for exactly one callee; a callee verifies the signature against
// Vault's JWKS (cached by kid, refetched once on an unknown kid), the pinned
// issuer, its own ID in `aud`, the expiry (5 s skew) and a single-use `jti`.
// Every refusal has a stable code the console shows next to the claim that
// decided it.
import { createPublicKey, verify as verifySig } from 'node:crypto';

export class SvidRefusal extends Error {
  constructor(code, message, claims) {
    super(message);
    this.code = code;
    this.claims = claims; // the decoded claims (never the token), when known
  }
}

export const spiffeId = (trustDomain, name) => `spiffe://${trustDomain}/workload/${name}`;
export const workloadOf = (trustDomain, id) => {
  const m = new RegExp(`^spiffe://${trustDomain.replace(/\./g, '\\.')}/workload/([a-z][a-z0-9-]{1,30})$`).exec(id ?? '');
  return m ? m[1] : null;
};

const SKEW_S = 5;
const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

// Decode without verifying: for display only (the console shows claims).
export function decode(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) throw new SvidRefusal('malformed', 'not a JWT');
  try { return { header: b64json(parts[0]), claims: b64json(parts[1]) }; } catch {
    throw new SvidRefusal('malformed', 'not a JWT');
  }
}

export function createVerifier({ self, trustDomain, issuer, fetchJwks, now = () => Date.now() / 1000 }) {
  const selfId = spiffeId(trustDomain, self);
  let keys = new Map();
  const seen = new Map(); // jti -> exp

  async function refresh() {
    const jwks = await fetchJwks();
    keys = new Map((jwks.keys ?? []).map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })]));
  }

  async function keyFor(kid) {
    if (!keys.has(kid)) await refresh(); // a rotated key: one refetch
    return keys.get(kid);
  }

  function remember(jti, exp) {
    const t = now();
    for (const [j, e] of seen) if (e + SKEW_S < t) seen.delete(j); // bounded by exp
    seen.set(jti, exp);
  }

  return {
    selfId,
    // Resolves to { caller, claims } or throws an SvidRefusal.
    async verify(token) {
      const { header, claims } = decode(token);
      const [h, c, s] = String(token).split('.');
      if (header.alg !== 'ES256' || !header.kid) throw new SvidRefusal('bad-signature', `unexpected alg ${header.alg}`, claims);
      const key = await keyFor(header.kid);
      if (!key) throw new SvidRefusal('bad-signature', `no key ${header.kid} in Vault's JWKS`, claims);
      const ok = verifySig('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
      if (!ok) throw new SvidRefusal('bad-signature', 'the signature does not match Vault\'s key', claims);
      if (claims.iss !== issuer) throw new SvidRefusal('bad-signature', `issuer ${claims.iss} is not ${issuer}`, claims);
      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!aud.includes(selfId)) throw new SvidRefusal('wrong-audience', `minted for ${aud.join(', ')}, not for ${selfId}`, claims);
      const t = now();
      if (typeof claims.exp !== 'number' || claims.exp + SKEW_S < t) throw new SvidRefusal('expired', `expired ${Math.round(t - claims.exp)} s ago`, claims);
      if (typeof claims.nbf === 'number' && claims.nbf - SKEW_S > t) throw new SvidRefusal('expired', 'not valid yet', claims);
      if (!claims.jti) throw new SvidRefusal('malformed', 'no jti: the role must set use_jti_claim', claims);
      if (seen.has(claims.jti)) throw new SvidRefusal('replayed', `jti ${claims.jti.slice(0, 8)} was already used`, claims);
      const caller = workloadOf(trustDomain, claims.sub);
      if (!caller) throw new SvidRefusal('not-a-guest', `${claims.sub} is not a workload of ${trustDomain}`, claims);
      remember(claims.jti, claims.exp);
      return { caller, claims };
    },
  };
}

// mint(callee): one SVID for one callee, from this workload's own role.
export function createMinter({ vault, self, trustDomain }) {
  return async (callee) =>
    (await vault.call('POST', `spiffe/role/${self}/mintjwt`, { body: { audience: spiffeId(trustDomain, callee) } })).data.token;
}
