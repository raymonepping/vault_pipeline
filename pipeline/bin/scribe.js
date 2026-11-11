// pipeline/bin/scribe.js: reads the corpus and seals it (Act I). Its Vault
// policy makes data keys and nothing else: it cannot open what it sealed.
// One datakeys call per ingest (count = documents, probe P3), one data key per
// document, kept in memory only and zeroed after the last frame.
import { readFileSync } from 'node:fs';
import { start, ollama } from '../lib/workload.js';
import { serve, readJson, ndjson, json, HttpError } from '../lib/http.js';
import { newHeader, sealAll, chunk, zero, fingerprint } from '../lib/envelope.js';

const w = await start('scribe');
const llm = ollama(w.ollama);
const EMBED = process.env.EMBED_MODEL ?? 'nomic-embed-text:v1.5';
const CORPUS = process.env.CORPUS_DIR ?? '/corpus';
const collectionOf = (name) => {
  const c = w.cfg.collections.find((x) => x.name === name);
  if (!c) throw new HttpError(400, 'unknown_collection', `no collection ${name}`);
  return c;
};

async function sealAndStore(collection, docIds, send) {
  const pairs = (await w.vault.call('POST', `transit/datakeys/plaintext/${collection.key}`, { body: { count: docIds.length } })).data;
  for (const [i, docId] of docIds.entries()) {
    const dek = Buffer.from(pairs.key_pairs[i].plaintext, 'base64');
    pairs.key_pairs[i].plaintext = null;
    try {
      const text = readFileSync(`${CORPUS}/${collection.name}/${docId}.md`, 'utf8');
      const chunks = chunk(text);
      const vectors = await llm.embed(EMBED, chunks);
      const header = newHeader({ collection: collection.name, docId, keyVersion: pairs.key_version, edk: pairs.key_pairs[i].ciphertext });
      const frames = sealAll(dek, header, chunks);
      const lines = [JSON.stringify({ header }), ...frames.map((f, j) => JSON.stringify({ seq: f.seq, last: f.last, frame: f.frame.toString('base64'), embedding: vectors[j] })), JSON.stringify({ done: true, frames: frames.length })];
      const r = await w.call('keeper', 'POST', '/store', { body: `${lines.join('\n')}\n`, raw: true });
      const verdict = await r.json().catch(() => ({}));
      send({
        event: 'document', doc_id: docId, collection: collection.name, chunks: chunks.length,
        dek_fingerprint: fingerprint(dek), edk_prefix: header.edk.split(':').slice(0, 2).join(':') + ':', key_version: header.key_version,
        keeper: { status: r.status, ...(r.ok ? { stored: verdict.stored } : { error: verdict.error }) },
      });
    } finally {
      zero(dek);
    }
  }
}

serve({
  name: 'scribe', cfg: w.cfg, verifier: w.verifier, tls: w.tls, port: w.me.port,
  routes: [
    { method: 'GET', path: '/healthz', op: null, handler: (q, res) => json(res, w.vault.ready ? 200 : 503, { ok: w.vault.ready, workload: 'scribe' }) },
    {
      method: 'POST', path: '/ingest', op: 'ingest',
      async handler(req, res) {
        const { collection } = await readJson(req);
        const c = collectionOf(collection);
        const out = ndjson(res);
        try {
          out.send({ event: 'start', collection: c.name, documents: c.documents.length });
          await sealAndStore(c, c.documents, out.send);
          out.send({ event: 'done' });
        } catch (e) {
          out.send({ event: 'error', message: e.said ?? e.message });
        }
        out.end();
      },
    },
    {
      method: 'GET', path: '/powers', op: 'powers',
      handler: async (q, res) => json(res, 200, { workload: 'scribe', powers: await w.powers(['spiffe/role/scribe/mintjwt', 'spiffe/role/keeper/mintjwt', 'transit/datakeys/plaintext/board', 'transit/decrypt/board', 'transit/rewrap/board', 'database/creds/keeper']) }),
    },
  ],
});
