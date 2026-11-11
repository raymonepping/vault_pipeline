// pipeline/bin/console.js: the console's backend, itself a workload (D13 to
// D15). Its own AppRole and SVID; it may rotate a collection key and raise
// its minimum version, and nothing else in Vault. It signs people in
// (Keycloak, PKCE BFF), logs a person in to Vault for one question and
// revokes that token when the answer ends, calls the scribe, keeper and
// librarian with its own badges, and runs the checks of Acts III and IV
// against the real workloads. Never returns or logs a token.
import { createServer } from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { start } from '../lib/workload.js';
import { VaultError } from '../lib/vault.js';
import * as auth from '../lib/session.js';

const w = await start('console');
const PORT = w.me.port;
const LAYERS = process.env.LAYERS_FILE ?? '/build/layers.json';
const PEERS = ['scribe', 'keeper', 'librarian'];
const MAX_BODY = 64 * 1024;
const PROBE_TEXT = 'Larkspur'; // the company's name: in every document, never in the database

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

async function body(req) {
  let n = 0;
  const parts = [];
  for await (const c of req) { n += c.length; if (n > MAX_BODY) throw fail(413, 'too_large', 'body too large'); parts.push(c); }
  const s = Buffer.concat(parts).toString('utf8');
  if (!s) return {};
  try { return JSON.parse(s); } catch { throw fail(400, 'bad_json', 'the body is not JSON'); }
}

// A workload's JSON answer, or its error, as data.
async function peer(callee, method, path, payload) {
  const r = await w.call(callee, method, path, { body: payload });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(502, 'workload', `${callee} ${path}: ${j.error?.message ?? r.status}`);
  return j;
}

// Pipe a workload's NDJSON stream to the browser, event by event.
async function relay(res, r, onEvent = (e) => e) {
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    res.write(`${JSON.stringify({ event: 'error', status: r.status, message: j.error?.message ?? `HTTP ${r.status}` })}\n`);
    return;
  }
  const dec = new TextDecoder();
  let buf = '';
  for await (const part of r.body) {
    buf += dec.decode(part, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line) res.write(`${JSON.stringify(onEvent(JSON.parse(line)))}\n`);
    }
  }
}

function stream(res) {
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  return (o) => res.write(`${JSON.stringify(o)}\n`);
}

// ── Prologue: the line, as each workload's own token sees it ────────────────
async function line() {
  const powers = {};
  for (const p of PEERS) powers[p] = await peer(p, 'GET', '/powers').then((j) => j.powers).catch((e) => ({ error: e.message }));
  powers.console = await w.powers(['spiffe/role/console/mintjwt', 'spiffe/role/scribe/mintjwt', 'transit/keys/board/rotate', 'transit/decrypt/board', 'transit/datakeys/plaintext/board', 'database/creds/keeper']);
  const jwks = await w.vault.call('GET', 'spiffe/.well-known/keys', { as: null });
  return {
    trust_domain: w.cfg.trust_domain,
    issuer: w.issuer,
    jwks_kids: jwks.keys.map((k) => k.kid),
    workloads: w.cfg.workloads.map(({ name, spiffe_path, address, vault_may, vault_refuses, accepts }) => ({ name, spiffe_id: `spiffe://${w.cfg.trust_domain}${spiffe_path}`, address, vault_may, vault_refuses, accepts, powers: powers[name] })),
    collections: w.cfg.collections.map(({ name, reader_group, documents }) => ({ name, reader_group, documents })),
  };
}

// ── Act II: one question, with the asker's own Vault token (D13) ─────────────
async function ask(res, who, question) {
  const send = stream(res);
  let personToken = null;
  try {
    const l = await w.vault.call('POST', 'auth/jwt/login', { body: { role: 'person', jwt: who.accessToken }, as: null });
    personToken = l.auth.client_token;
    send({ event: 'vault_login', person: who.user, policies: l.auth.identity_policies ?? [], ttl: l.auth.lease_duration });
    const r = await w.call('librarian', 'POST', '/ask', { body: { question, person_token: personToken, person: who.user }, ms: 300_000 });
    await relay(res, r);
  } catch (e) {
    send({ event: 'error', message: e instanceof VaultError ? `Vault said: ${e.said}` : e.message });
  } finally {
    if (personToken) {
      const ok = await w.vault.callAs(personToken, 'POST', 'auth/token/revoke-self', { body: {} }).then(() => true, () => false);
      send({ event: 'vault_logout', revoked: ok });
    }
    res.end();
  }
}

// ── Act III: the guest lists, and the unit tests that prove the verifier ────
// The refusals (used twice, another workload's badge, past its minute, an
// edited badge, a caller not on the list) are proven offline by
// pipeline/test/svid.test.js; make test-unit writes .build/unit-tests.json.
function badgeCheck() {
  const file = process.env.UNIT_TESTS_FILE ?? '/build/unit-tests.json';
  const tests = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  return {
    guest_lists: w.cfg.workloads.filter((x) => x.accepts.length).map((x) => ({
      workload: x.name,
      doors: [...new Set(x.accepts.map((a) => a.op))].map((op) => ({ op, guests: x.accepts.filter((a) => a.op === op).map((a) => a.from) })),
    })),
    checks_in_every_call: ['signature against Vault\'s JWKS', `issuer ${w.issuer}`, 'audience is this workload', 'not past its minute', 'jti not seen before', 'caller on the guest list'],
    unit_tests: tests,
  };
}

// ── Act IV: the night's backup, a token's address, rotate and rewrap ───────
async function lostBackup(res, who) {
  const send = stream(res);
  const col = w.cfg.collections.find((c) => c.name === 'board');
  try {
    const b = await peer('keeper', 'GET', '/backup');
    const bytes = b.frames.reduce((n, f) => n + Buffer.from(f.frame, 'base64').length, 0);
    const hits = b.frames.filter((f) => Buffer.from(f.frame, 'base64').includes(PROBE_TEXT)).length;
    const old = b.documents.find((d) => d.collection === col.name);
    send({ event: 'backup', taken_at: b.taken_at, documents: b.documents.length, frames: b.frames.length, bytes,
      columns: ['documents: doc_id, collection, header, edk, key_version', 'frames: doc_id, seq, frame (bytea), embedding (768 floats)'],
      text_hits: hits, searched_for: PROBE_TEXT, edk_prefixes: [...new Set(b.documents.map((d) => d.edk.split(':').slice(0, 2).join(':')))] });
    const own = await w.powers([`transit/decrypt/${col.key}`]);
    send({ event: 'console_powers', path: own[0].path, capabilities: own[0].capabilities });

    // The person token's address binding, as Vault records it.
    const l = await w.vault.call('POST', 'auth/jwt/login', { body: { role: 'person', jwt: who.accessToken }, as: null });
    const self = (await w.vault.callAs(l.auth.client_token, 'GET', 'auth/token/lookup-self')).data;
    await w.vault.callAs(l.auth.client_token, 'POST', 'auth/token/revoke-self', { body: {} }).catch(() => {});
    send({ event: 'binding', person: who.user, bound_cidrs: self.bound_cidrs, ttl: self.ttl, note: 'from any other address Vault answers permission denied (the rehearsal tries it from the host)' });

    if (!old) { send({ event: 'error', message: 'the backup holds no board document: run Into the Pipe first' }); return; }
    const before = (await w.vault.call('GET', `transit/keys/${col.key}`)).data;
    await w.vault.call('POST', `transit/keys/${col.key}/rotate`, { body: {} });
    const rotated = (await w.vault.call('GET', `transit/keys/${col.key}`)).data.latest_version;
    send({ event: 'rotated', collection: col.name, from: before.latest_version, to: rotated });
    const rw = await peer('keeper', 'POST', '/rewrap', { collection: col.name });
    send({ event: 'rewrapped', ...rw });
    await w.vault.call('POST', `transit/keys/${col.key}/config`, { body: { min_decryption_version: rotated } });
    send({ event: 'minimum_raised', collection: col.name, min_decryption_version: rotated });
    const relock = await peer('keeper', 'POST', '/relock', { collection: col.name, edk: old.edk });
    send({ event: 'old_key_checked', doc_id: old.doc_id, from_backup: old.edk.split(':').slice(0, 2).join(':'), ...relock });
    send({ event: 'done' });
  } catch (e) {
    send({ event: 'error', message: e instanceof VaultError ? `Vault said: ${e.said}` : e.message });
  } finally {
    res.end();
  }
}

// ── The server ──────────────────────────────────────────────────────────────
const json = (res, status, b) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(b));

async function handle(req, res) {
  const rid = randomUUID();
  const url = new URL(req.url, 'https://console');
  res.setHeader('x-request-id', rid);
  res.setHeader('x-content-type-options', 'nosniff');
  const t0 = Date.now();
  res.on('finish', () => { if (url.pathname !== '/healthz') w.logger('request', { id: rid, method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - t0 }); });
  const route = `${req.method} ${url.pathname}`;
  try {
    if (auth.crossSiteWrite(req)) throw fail(403, 'cross_site', 'a write from another site is refused');
    if (route === 'GET /healthz') return json(res, 200, { ok: w.vault.ready, workload: 'console' });
    if (route === 'GET /auth/login') return res.writeHead(302, { location: auth.login(url) }).end();
    if (route === 'GET /auth/callback') {
      const { sid, returnTo } = await auth.callback(url);
      return res.writeHead(302, { location: returnTo, 'set-cookie': auth.sessionCookie(sid, 4 * 3600) }).end();
    }
    if (url.pathname === '/auth/logout') {
      if (req.method !== 'POST') return res.writeHead(405, { allow: 'POST' }).end();
      return res.writeHead(303, { location: auth.logout(req), 'set-cookie': auth.sessionCookie('', 0) }).end();
    }
    if (route === 'GET /api/layers') return json(res, 200, existsSync(LAYERS) ? JSON.parse(readFileSync(LAYERS, 'utf8')) : null);
    if (route === 'GET /api/acts/badges') return json(res, 200, badgeCheck());

    const who = await auth.person(req);
    if (route === 'GET /api/me') return json(res, 200, who ? { signedIn: true, user: who.user, name: who.name, groups: who.groups, operator: who.operator } : { signedIn: false });
    if (!who) throw fail(401, 'unauthenticated', 'sign in first');
    if (route === 'GET /api/line') return json(res, 200, await line());
    if (route === 'GET /api/collections') return json(res, 200, await peer('keeper', 'GET', '/custody'));
    if (route === 'GET /api/custody') {
      const doc = url.searchParams.get('doc');
      if (doc && !w.cfg.collections.some((c) => c.documents.includes(doc))) throw fail(404, 'unknown_document', doc);
      return json(res, 200, await peer('keeper', 'GET', `/custody${doc ? `?doc=${encodeURIComponent(doc)}` : ''}`));
    }
    if (route === 'POST /api/ask') {
      const { question } = await body(req);
      if (typeof question !== 'string' || !question.trim() || question.length > 500) throw fail(400, 'bad_question', 'a question of 1 to 500 characters');
      return await ask(res, who, question.trim());
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/acts/') && !who.operator) throw fail(403, 'not_an_operator', `${who.user} is not in pipeline-operators`);
    if (route === 'POST /api/acts/ingest') {
      const { collection } = await body(req);
      if (!w.cfg.collections.some((c) => c.name === collection)) throw fail(400, 'unknown_collection', String(collection));
      stream(res)({ event: 'pressed', by: who.user });
      return await relay(res, await w.call('scribe', 'POST', '/ingest', { body: { collection }, ms: 300_000 })).finally(() => res.end());
    }
    if (route === 'POST /api/acts/backup') return await lostBackup(res, who);
    if (route === 'POST /api/acts/reset') return json(res, 200, await peer('keeper', 'POST', '/forget', {}));
    throw fail(404, 'not_found', route);
  } catch (e) {
    const status = e.status ?? (e instanceof auth.Unauthenticated ? 401 : 500);
    if (status === 500) w.logger('error', { id: rid, path: url.pathname, message: e.message });
    if (!res.headersSent) json(res, status, { error: { code: e.code ?? 'internal', message: status === 500 ? 'internal error' : e.message, request_id: rid } });
    else res.end();
  }
}

createServer({ key: readFileSync(w.tls.key), cert: readFileSync(w.tls.cert), minVersion: 'TLSv1.2' }, handle).listen(PORT, '0.0.0.0', () => w.logger('listening', { port: PORT }));
