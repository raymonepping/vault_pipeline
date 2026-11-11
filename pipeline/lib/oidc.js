// pipeline/lib/oidc.js: verify a Keycloak access token ourselves (D14), from
// vault_balancing. The console checks the RS256 signature against the realm's
// JWKS, the issuer, the audience and the expiry, then reads the signed
// `groups` claim: `pipeline-operators` may press the act buttons. What a
// person may READ is Vault's decision (D13), from the same claim.
import { createPublicKey, verify } from 'node:crypto';

export const OPERATORS = 'pipeline-operators';
export const groupsOf = (claims) => (Array.isArray(claims?.groups) ? claims.groups.map(String) : []);
export const mayAct = (claims) => groupsOf(claims).includes(OPERATORS);

const b64json = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

export function createVerifier({ jwksUrl, issuer, audience, fetchImpl = fetch, now = () => Date.now(), leewaySeconds = 30 }) {
  let keys = new Map();
  let fetchedAt = 0;
  async function load() {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);
    try {
      const r = await fetchImpl(jwksUrl, { signal: ac.signal });
      if (!r.ok) throw new Error(`JWKS answered HTTP ${r.status}`);
      const { keys: list = [] } = await r.json();
      keys = new Map(list.filter((k) => k.kty === 'RSA' && k.use !== 'enc').map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })]));
      fetchedAt = now();
    } finally {
      clearTimeout(t);
    }
  }
  return async function verifyToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('not a JWT');
    const header = b64json(parts[0]);
    if (header.alg !== 'RS256') throw new Error(`unexpected alg ${header.alg}`);
    // An unknown key id: Keycloak may have rotated its keys. Refetch, at most every 30 s.
    if (!keys.has(header.kid) && now() - fetchedAt > 30_000) await load();
    const key = keys.get(header.kid);
    if (!key) throw new Error('unknown signing key');
    const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new Error('bad signature');
    const c = b64json(parts[1]);
    const t = now() / 1000;
    if (c.iss !== issuer) throw new Error(`wrong issuer ${c.iss}`);
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (!aud.includes(audience) && c.azp !== audience) throw new Error('wrong audience');
    if (typeof c.exp !== 'number' || c.exp + leewaySeconds < t) throw new Error('expired');
    if (typeof c.nbf === 'number' && c.nbf - leewaySeconds > t) throw new Error('not yet valid');
    return c;
  };
}
