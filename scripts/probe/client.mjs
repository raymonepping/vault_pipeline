// A probe client inside the network: reads a plan from /w/plan.json and
// prints status codes and Vault's error text, never a token.
import { readFileSync, writeFileSync } from 'node:fs';
const plan = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const V = 'https://vault-1:8200/v1/';
const call = async (path, { token, body, method = 'POST' } = {}) => {
  const r = await fetch(V + path, { method, headers: { ...(token ? { 'X-Vault-Token': token } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
};
const out = {};
for (const step of plan) {
  if (step.do === 'unwrap') {
    const r = await call('sys/wrapping/unwrap', { token: readFileSync('/w/wrapped', 'utf8').trim() });
    out[step.as] = { status: r.status, errors: r.j.errors, got_secret_id: Boolean(r.j.data?.secret_id) };
    if (r.j.data?.secret_id) writeFileSync('/tmp/sid', r.j.data.secret_id);
  } else if (step.do === 'login') {
    let sid; try { sid = readFileSync(step.sid ?? '/tmp/sid', 'utf8').trim(); } catch { sid = 'none'; }
    const r = await call('auth/probe-approle/login', { body: { role_id: readFileSync('/w/role_id', 'utf8').trim(), secret_id: sid } });
    out[step.as] = { status: r.status, errors: r.j.errors, policies: r.j.auth?.policies };
    if (r.j.auth?.client_token) writeFileSync('/w/out-token', r.j.auth.client_token);
  } else if (step.do === 'use') {
    const r = await call('auth/token/lookup-self', { token: readFileSync('/w/out-token', 'utf8').trim(), method: 'GET' });
    out[step.as] = { status: r.status, errors: r.j.errors };
  }
}
console.log(JSON.stringify(out));
