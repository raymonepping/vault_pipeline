// pipeline/bin/keeper.js: stores and finds sealed frames (D12). It holds a
// database credential from Vault and the right to rewrap an encrypted data
// key (re-lock without opening, probe P5); it never holds a data key. Every
// store, search, rewrap, backup and refusal leaves a custody row, and the
// database role cannot change or delete custody rows (probe P7).
import pg from 'pg';
import { start } from '../lib/workload.js';
import { serve, readJson, readNdjson, json, HttpError } from '../lib/http.js';
import { headerDigest } from '../lib/envelope.js';

const w = await start('keeper');
let pool = null;
let lease = null;

// A database credential from Vault, renewed at two thirds of its lease; a
// revoked or expired one is replaced and the pool reconnects.
async function connect() {
  const j = await w.vault.call('GET', 'database/creds/keeper');
  const next = new pg.Pool({ host: 'postgres', database: 'pipeline', user: j.data.username, password: j.data.password, max: 4, idleTimeoutMillis: 30_000 });
  next.on('error', (e) => w.logger('db_pool_error', { message: e.message })); // never crash on a dropped connection
  const old = pool;
  pool = next;
  lease = { id: j.lease_id, ttl: j.lease_duration, user: j.data.username };
  if (old) old.end().catch(() => {});
  w.logger('db_credential', { user: lease.user, ttl: lease.ttl });
  schedule(lease.ttl);
}
function schedule(ttl) {
  setTimeout(async () => {
    try {
      const r = await w.vault.call('POST', 'sys/leases/renew', { body: { lease_id: lease.id } });
      schedule(r.lease_duration);
    } catch {
      await connect().catch((e) => w.logger('db_connect_failed', { message: e.message }));
    }
  }, Math.max(10, Math.floor((ttl * 2) / 3)) * 1000).unref();
}
// A revoked or expired credential: take a new one from Vault and retry once.
const DEAD_CREDENTIAL = /password authentication failed|terminating connection/;
async function q(sql, params) {
  try { return await pool.query(sql, params); } catch (e) {
    if (!DEAD_CREDENTIAL.test(e.message)) throw e;
    await connect();
    return pool.query(sql, params);
  }
}
async function client() {
  try { return await pool.connect(); } catch (e) {
    if (!DEAD_CREDENTIAL.test(e.message)) throw e;
    await connect();
    return pool.connect();
  }
}
// A custody row that cannot be written fails the operation: "every hand on
// the record" is the story's promise.
const custody = (docId, actor, action, detail = {}) =>
  q('INSERT INTO custody (doc_id, actor, action, detail) VALUES ($1, $2, $3, $4)', [docId, actor, action, detail]);

await connect();
const vec = (a) => {
  if (!Array.isArray(a) || a.length !== 768 || !a.every(Number.isFinite)) throw new HttpError(400, 'bad_embedding', 'an embedding is 768 numbers');
  return `[${a.join(',')}]`;
};

serve({
  name: 'keeper', cfg: w.cfg, verifier: w.verifier, tls: w.tls, port: w.me.port,
  // A refused badge is part of the custody story (Act III).
  onRefused: (r) => custody(null, r.sub ?? 'unknown', 'refused', r).catch((e) => w.logger('custody_failed', { action: 'refused', message: e.message })),
  routes: [
    {
      // Healthy means the database answers with Vault's current credential.
      method: 'GET', path: '/healthz', op: null,
      async handler(q2, res) {
        const db = await q('SELECT 1').then(() => true, () => false);
        json(res, db && w.vault.ready ? 200 : 503, { ok: db && w.vault.ready, workload: 'keeper', db, db_user: lease?.user });
      },
    },
    {
      // One sealed document as NDJSON: header, frames, done. Replaces an
      // earlier copy of the same document in one transaction.
      method: 'POST', path: '/store', op: 'store',
      async handler(req, res, ctx) {
        const lines = await readNdjson(req, 8 << 20);
        const header = lines[0]?.header;
        const done = lines.at(-1);
        const frames = lines.slice(1, -1);
        if (!header?.doc_id || !done?.done || done.frames !== frames.length || !frames.length) throw new HttpError(400, 'bad_stream', 'header, frames, done');
        if (!w.cfg.collections.some((c) => c.name === header.collection && c.documents.includes(header.doc_id))) throw new HttpError(400, 'unknown_document', header.doc_id);
        frames.forEach((f, i) => { if (f.seq !== i || f.last !== (i === frames.length - 1)) throw new HttpError(400, 'bad_stream', `frame ${i} out of order`); });
        const c = await client();
        try {
          await c.query('BEGIN');
          const prev = await c.query('DELETE FROM documents WHERE doc_id = $1 RETURNING key_version', [header.doc_id]);
          await c.query('INSERT INTO documents (doc_id, collection, header, edk, key_version, sealed_by) VALUES ($1, $2, $3, $4, $5, $6)',
            [header.doc_id, header.collection, header, header.edk, header.key_version, ctx.claims.sub]);
          for (const f of frames) await c.query('INSERT INTO frames (doc_id, seq, frame, embedding) VALUES ($1, $2, $3, $4::vector)', [header.doc_id, f.seq, Buffer.from(f.frame, 'base64'), vec(f.embedding)]);
          await c.query('INSERT INTO custody (doc_id, actor, action, detail) VALUES ($1, $2, $3, $4)',
            [header.doc_id, ctx.claims.sub, prev.rowCount ? 'resealed' : 'stored', { frames: frames.length, key_version: header.key_version, header_digest: headerDigest(header).toString('hex').slice(0, 16), jti: ctx.claims.jti }]);
          await c.query('COMMIT');
        } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
        json(res, 200, { stored: header.doc_id, frames: frames.length });
      },
    },
    {
      // Nearest frames to a question, still sealed. The keeper cannot tell
      // what they say; the librarian opens them with the asker's token.
      method: 'POST', path: '/search', op: 'search',
      async handler(req, res, ctx) {
        const { vector, k = 6 } = await readJson(req);
        const r = await q(`SELECT f.doc_id, d.collection, f.seq, (f.seq = (SELECT max(seq) FROM frames x WHERE x.doc_id = f.doc_id)) AS last,
          encode(f.frame, 'base64') AS frame, d.header, d.edk, d.key_version, f.embedding <=> $1::vector AS distance
          FROM frames f JOIN documents d USING (doc_id) ORDER BY f.embedding <=> $1::vector LIMIT $2`, [vec(vector), Math.min(Math.max(1, Number(k) | 0), 12)]);
        // One custody row per document found, so each document's history is
        // one indexed lookup.
        const docs = [...new Set(r.rows.map((x) => x.doc_id))];
        if (docs.length) await q('INSERT INTO custody (doc_id, actor, action, detail) SELECT d, $2, \'searched\', $3 FROM unnest($1::text[]) AS d', [docs, ctx.claims.sub, { frames: r.rows.length }]);
        json(res, 200, { frames: r.rows.map((x) => ({ ...x, header: { ...x.header, edk: x.edk } })) });
      },
    },
    {
      // Re-lock every encrypted data key of a collection under the key's
      // newest version. Vault never shows the keeper a data key (P5).
      method: 'POST', path: '/rewrap', op: 'rewrap',
      async handler(req, res, ctx) {
        const { collection } = await readJson(req);
        const col = w.cfg.collections.find((c) => c.name === collection);
        if (!col) throw new HttpError(400, 'unknown_collection', collection);
        const docs = (await q('SELECT doc_id, edk, key_version FROM documents WHERE collection = $1', [collection])).rows;
        const out = [];
        for (const d of docs) {
          try {
            const r = await w.vault.call('POST', `transit/rewrap/${col.key}`, { body: { ciphertext: d.edk } });
            await q('UPDATE documents SET edk = $2, key_version = $3, header = jsonb_set(jsonb_set(header, \'{edk}\', to_jsonb($2::text)), \'{key_version}\', to_jsonb($3::int)) WHERE doc_id = $1', [d.doc_id, r.data.ciphertext, r.data.key_version]);
            await custody(d.doc_id, w.verifier.selfId, 'rewrapped', { from: d.key_version, to: r.data.key_version, asked_by: ctx.claims.sub });
            out.push({ doc_id: d.doc_id, from: d.key_version, to: r.data.key_version });
          } catch (e) {
            out.push({ doc_id: d.doc_id, from: d.key_version, error: e.said ?? e.message });
          }
        }
        json(res, 200, { collection, rewrapped: out });
      },
    },
    {
      method: 'GET', path: '/custody', op: 'custody',
      async handler(req, res, ctx) {
        const doc = ctx.url.searchParams.get('doc');
        const rows = (await q(`SELECT id, at, doc_id, actor, action, detail FROM custody ${doc ? 'WHERE doc_id = $1' : ''} ORDER BY id DESC LIMIT 500`, doc ? [doc] : [])).rows;
        const documents = (await q('SELECT d.doc_id, d.collection, d.key_version, left(d.edk, 9) AS edk_prefix, d.sealed_by, d.sealed_at, count(f.seq)::int AS frames, sum(length(f.frame))::int AS bytes FROM documents d LEFT JOIN frames f USING (doc_id) GROUP BY d.doc_id ORDER BY d.doc_id')).rows;
        json(res, 200, { documents, custody: rows.reverse() });
      },
    },
    {
      // The nightly backup: what the database holds, ciphertext and vectors.
      // Act IV reads it as "the lost backup": no column holds text.
      method: 'GET', path: '/backup', op: 'backup',
      async handler(req, res, ctx) {
        const documents = (await q('SELECT doc_id, collection, header, edk, key_version FROM documents ORDER BY doc_id')).rows;
        const frames = (await q('SELECT doc_id, seq, encode(frame, \'base64\') AS frame, embedding::text AS embedding FROM frames ORDER BY doc_id, seq')).rows;
        await custody(null, ctx.claims.sub, 'backed-up', { documents: documents.length });
        json(res, 200, { taken_at: new Date().toISOString(), documents, frames });
      },
    },
    {
      // A story reset forgets documents; custody stays (append-only).
      method: 'POST', path: '/forget', op: 'forget',
      async handler(req, res, ctx) {
        const r = await q('DELETE FROM documents RETURNING doc_id');
        await custody(null, ctx.claims.sub, 'forgot-all', { documents: r.rows.map((x) => x.doc_id) });
        json(res, 200, { forgotten: r.rowCount });
      },
    },
    {
      // Act IV: may this encrypted data key still be re-locked? Asks Vault to
      // rewrap it and returns Vault's answer; stores nothing. After rotation
      // and a raised minimum version, an old backup's keys are refused.
      method: 'POST', path: '/relock', op: 'relock',
      async handler(req, res, ctx) {
        const { collection, edk } = await readJson(req);
        const col = w.cfg.collections.find((c) => c.name === collection);
        if (!col || typeof edk !== 'string' || !edk.startsWith('vault:v')) throw new HttpError(400, 'bad_request', 'a collection and an encrypted data key');
        let answer;
        try {
          const r = await w.vault.call('POST', `transit/rewrap/${col.key}`, { body: { ciphertext: edk } });
          answer = { status: 200, key_version: r.data.key_version };
        } catch (e) {
          answer = { status: e.status ?? 500, vault_said: e.said ?? e.message };
        }
        await custody(null, ctx.claims.sub, 'relock-checked', { collection, from: edk.split(':')[1], ...answer });
        json(res, 200, answer);
      },
    },
    {
      method: 'GET', path: '/powers', op: 'powers',
      handler: async (q2, res) => json(res, 200, { workload: 'keeper', powers: await w.powers(['spiffe/role/keeper/mintjwt', 'spiffe/role/scribe/mintjwt', 'database/creds/keeper', 'transit/rewrap/board', 'transit/decrypt/board', 'transit/datakeys/plaintext/board']) }),
    },
  ],
});
