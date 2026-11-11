// pipeline/lib/envelope.js: sealed documents (D11). One data key per
// document, from Vault (transit/datakeys); AES-256-GCM per frame in a STREAM
// construction: nonce = prefix(7) | be32(seq) | last(1), AAD = sha256(the
// header's fixed fields) | be32(seq). So a flipped bit, a swapped pair, a dropped last frame or a
// frame from another document fails to open. The data key lives only in
// memory and is zeroed after use (zero()).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const ALG = 'A256GCM-STREAM';
const TAG = 16;

const canonical = (v) =>
  Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  : JSON.stringify(v);

// The AAD binds what never changes. Not the encrypted data key or its key
// version: a rewrap changes both on purpose (Act IV) and must leave every
// frame valid.
const BOUND = ['v', 'alg', 'collection', 'doc_id', 'nonce_prefix'];
export const headerDigest = (header) => createHash('sha256').update(canonical(Object.fromEntries(BOUND.map((k) => [k, header[k]])))).digest();

export function newHeader({ collection, docId, keyVersion, edk }) {
  return { v: 1, alg: ALG, collection, doc_id: docId, key_version: keyVersion, edk, nonce_prefix: randomBytes(7).toString('base64') };
}

function nonceAad(header, seq, last) {
  const prefix = Buffer.from(header.nonce_prefix, 'base64');
  if (prefix.length !== 7) throw new Error('nonce_prefix must be 7 bytes');
  if (!Number.isInteger(seq) || seq < 0 || seq > 0xffffffff) throw new Error('seq out of range');
  const be = Buffer.alloc(4);
  be.writeUInt32BE(seq);
  return {
    nonce: Buffer.concat([prefix, be, Buffer.from([last ? 1 : 0])]),
    aad: Buffer.concat([headerDigest(header), be]),
  };
}

const keyBuf = (dek) => {
  const k = Buffer.isBuffer(dek) ? dek : Buffer.from(dek, 'base64');
  if (k.length !== 32) throw new Error('a data key is 32 bytes');
  return k;
};

export function sealFrame(dek, header, seq, last, plaintext) {
  const { nonce, aad } = nonceAad(header, seq, last);
  const c = createCipheriv('aes-256-gcm', keyBuf(dek), nonce);
  c.setAAD(aad);
  return Buffer.concat([c.update(Buffer.from(plaintext, 'utf8')), c.final(), c.getAuthTag()]);
}

// Throws on any tampering (Node: "Unsupported state or unable to authenticate data").
export function openFrame(dek, header, seq, last, frame) {
  const buf = Buffer.isBuffer(frame) ? frame : Buffer.from(frame, 'base64');
  if (buf.length < TAG) throw new Error('frame too short');
  const { nonce, aad } = nonceAad(header, seq, last);
  const d = createDecipheriv('aes-256-gcm', keyBuf(dek), nonce);
  d.setAAD(aad);
  d.setAuthTag(buf.subarray(buf.length - TAG));
  return Buffer.concat([d.update(buf.subarray(0, buf.length - TAG)), d.final()]).toString('utf8');
}

// A whole document: every frame in order, the last one flagged as last.
export function sealAll(dek, header, chunks) {
  return chunks.map((text, seq) => ({ seq, last: seq === chunks.length - 1, frame: sealFrame(dek, header, seq, seq === chunks.length - 1, text) }));
}

export function openAll(dek, header, frames) {
  return frames.map((f, i) => {
    if (f.seq !== i) throw new Error(`frame ${i} is missing or out of order`);
    return openFrame(dek, header, i, i === frames.length - 1, f.frame);
  });
}

export const zero = (dek) => { if (Buffer.isBuffer(dek)) dek.fill(0); };

// The first 8 hex of SHA-256: how the lab shows a data key (never the key).
export const fingerprint = (v) => createHash('sha256').update(Buffer.isBuffer(v) ? v : String(v)).digest('hex').slice(0, 8);

// Paragraph chunks of about `size` characters (never splitting a paragraph
// unless it alone is longer).
export function chunk(text, size = 600) {
  const out = [];
  let cur = '';
  for (const para of text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    if (cur && cur.length + para.length + 2 > size) { out.push(cur); cur = ''; }
    if (para.length > size) {
      for (let i = 0; i < para.length; i += size) out.push(para.slice(i, i + size));
      continue;
    }
    cur = cur ? `${cur}\n\n${para}` : para;
  }
  if (cur) out.push(cur);
  return out;
}
