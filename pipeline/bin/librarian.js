// pipeline/bin/librarian.js: answers a person's question with only what that
// person may read (Act II, D13). The deputy that cannot be confused: its own
// token can decrypt nothing, so every data key it opens is opened with the
// asker's token (120 s, bound to the console's and the librarian's
// addresses). The person's token is used for transit/decrypt only, never
// logged and never returned.
import { start, ollama } from '../lib/workload.js';
import { serve, readJson, ndjson, json, HttpError } from '../lib/http.js';
import { openFrame } from '../lib/envelope.js';
import { VaultError } from '../lib/vault.js';

const w = await start('librarian');
const llm = ollama(w.ollama);
const EMBED = process.env.EMBED_MODEL ?? 'nomic-embed-text:v1.5';
const CHAT = process.env.CHAT_MODEL ?? 'qwen2.5:1.5b';
const MAX_PASSAGES = 4;

async function openForAsker(personToken, frames) {
  const byDoc = new Map();
  for (const f of frames) {
    if (!byDoc.has(f.doc_id)) byDoc.set(f.doc_id, { doc_id: f.doc_id, collection: f.collection, key: w.cfg.collections.find((c) => c.name === f.collection)?.key, header: f.header, frames: [] });
    byDoc.get(f.doc_id).frames.push(f);
  }
  const passages = [];
  const refused = [];
  for (const d of byDoc.values()) {
    let dek;
    try {
      dek = Buffer.from((await w.vault.callAs(personToken, 'POST', `transit/decrypt/${d.key}`, { body: { ciphertext: d.header.edk } })).data.plaintext, 'base64');
    } catch (e) {
      // Only Vault's own 4xx answer is a refusal. An unreachable Vault is an
      // error, never "you may not read this".
      if (!(e instanceof VaultError) || e.status < 400 || e.status >= 500) throw e;
      refused.push({ doc_id: d.doc_id, collection: d.collection, status: e.status, vault_said: e.said, passages: d.frames.length });
      continue;
    }
    try {
      for (const f of d.frames) passages.push({ doc_id: d.doc_id, collection: d.collection, seq: f.seq, distance: Number(f.distance), text: openFrame(dek, d.header, f.seq, f.last, f.frame) });
    } finally {
      dek.fill(0);
    }
  }
  passages.sort((a, b) => a.distance - b.distance);
  return { passages: passages.slice(0, MAX_PASSAGES), refused };
}

serve({
  name: 'librarian', cfg: w.cfg, verifier: w.verifier, tls: w.tls, port: w.me.port,
  routes: [
    { method: 'GET', path: '/healthz', op: null, handler: (q, res) => json(res, 200, { ok: w.vault.ready, workload: 'librarian' }) },
    {
      method: 'POST', path: '/ask', op: 'ask',
      async handler(req, res) {
        const { question, person_token: personToken, person } = await readJson(req);
        if (typeof question !== 'string' || !question.trim() || question.length > 500) throw new HttpError(400, 'bad_question', 'a question of 1 to 500 characters');
        if (typeof personToken !== 'string' || !personToken) throw new HttpError(400, 'no_person', 'the asker\'s token is required: the librarian reads nothing on its own authority');
        const out = ndjson(res);
        try {
          const [vector] = await llm.embed(EMBED, [question]);
          const r = await w.call('keeper', 'POST', '/search', { body: { vector, k: 6 } });
          if (!r.ok) throw new Error(`keeper: ${r.status}`);
          const { frames } = await r.json();
          const { passages, refused } = await openForAsker(personToken, frames);
          out.send({ event: 'passages', person, found: [...new Set(frames.map((f) => f.doc_id))], opened: passages.map(({ text, ...p }) => p) });
          for (const x of refused) out.send({ event: 'refused', ...x });
          // The closest match is a document Vault would not open for this
          // person: say so, and do not let the model answer from the rest
          // (a small model fills the gap with something plausible).
          const best = frames[0]?.doc_id;
          const bestRefused = refused.some((x) => x.doc_id === best);
          if (!passages.length || bestRefused) {
            const n = refused.reduce((k, x) => k + x.passages, 0);
            out.send({ event: 'token', text: refused.length ? `The passages that best match your question are in ${n === 1 ? 'one passage' : `${n} passages`} Vault will not open for you, so I will not answer from the others.` : 'I found nothing about that.' });
            passages.length = 0;
          } else {
            const context = passages.map((p, i) => `[${i + 1}] ${p.text}`).join('\n\n');
            const messages = [
              { role: 'system', content: 'You answer questions for staff of Larkspur & Vane, a lantern maker. Use only the numbered passages. Answer in at most three sentences and cite passages like [1]. If the passages do not answer the question, reply exactly: The passages I may read do not answer that.' },
              { role: 'user', content: `Passages:\n${context}\n\nQuestion: ${question}\nAnswer:` },
            ];
            for await (const part of llm.chat(CHAT, messages, { num_predict: 256, temperature: 0 })) {
              if (part.message?.content) out.send({ event: 'token', text: part.message.content });
              if (part.done) out.send({ event: 'stats', tokens: part.eval_count, seconds: Number((part.total_duration / 1e9).toFixed(1)) });
            }
          }
          out.send({ event: 'done', sources: passages.map((p, i) => ({ n: i + 1, doc_id: p.doc_id, seq: p.seq })) });
        } catch (e) {
          out.send({ event: 'error', message: e.message });
        }
        out.end();
      },
    },
    {
      method: 'GET', path: '/powers', op: 'powers',
      handler: async (q, res) => json(res, 200, { workload: 'librarian', powers: await w.powers(['spiffe/role/librarian/mintjwt', 'spiffe/role/scribe/mintjwt', 'transit/decrypt/handbook', 'transit/decrypt/board', 'database/creds/keeper']) }),
    },
  ],
});
