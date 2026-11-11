// P8: log a person in to Vault from the console's address with their access
// token, list what the token may do, then revoke it. Never prints a token.
import { readFileSync } from 'node:fs';
const V = 'https://vault-1:8200/v1/';
const out = {};
for (const u of ['vera', 'ada']) {
  const at = readFileSync(`/w/at-${u}`, 'utf8').trim();
  const l = await (await fetch(V + 'auth/jwt/login', { method: 'POST', body: JSON.stringify({ role: 'person', jwt: at }) })).json();
  if (!l.auth) { out[u] = l.errors; continue; }
  const h = { 'X-Vault-Token': l.auth.client_token };
  const caps = await (await fetch(V + 'sys/capabilities-self', { method: 'POST', headers: h, body: JSON.stringify({ paths: ['transit/decrypt/handbook', 'transit/decrypt/board', 'transit/datakeys/plaintext/board'] }) })).json();
  const self = (await (await fetch(V + 'auth/token/lookup-self', { headers: h })).json()).data;
  const rv = await fetch(V + 'auth/token/revoke-self', { method: 'POST', headers: h });
  out[u] = { ttl: l.auth.lease_duration, policies: l.auth.policies, identity_policies: l.auth.identity_policies, meta: l.auth.metadata, caps: caps.data ?? caps, bound: self.bound_cidrs, revoke_self: rv.status };
}
console.log(JSON.stringify(out, null, 1));
