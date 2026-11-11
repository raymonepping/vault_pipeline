import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { newHeader, sealAll, openAll, openFrame, sealFrame, chunk, fingerprint, zero } from '../lib/envelope.js';

const doc = () => {
  const dek = randomBytes(32);
  const header = newHeader({ collection: 'board', docId: 'board-2026-10', keyVersion: 1, edk: 'vault:v1:abc' });
  return { dek, header, frames: sealAll(dek, header, ['first part', 'second part', 'third part']) };
};

test('a document opens frame by frame and as a whole', () => {
  const { dek, header, frames } = doc();
  assert.deepEqual(openAll(dek, header, frames), ['first part', 'second part', 'third part']);
  assert.equal(openFrame(dek, header, 1, false, frames[1].frame), 'second part');
  assert.equal(frames.at(-1).last, true);
});

test('a flipped bit fails to open', () => {
  const { dek, header, frames } = doc();
  frames[1].frame[3] ^= 1;
  assert.throws(() => openAll(dek, header, frames));
});

test('a swapped pair fails to open', () => {
  const { dek, header, frames } = doc();
  const swapped = [frames[1], frames[0], frames[2]].map((f, i) => ({ ...f, seq: i }));
  assert.throws(() => openAll(dek, header, swapped));
});

test('a dropped last frame fails: the new last frame was not sealed as last', () => {
  const { dek, header, frames } = doc();
  assert.throws(() => openAll(dek, header, frames.slice(0, 2)));
});

test('a frame from another document fails, even with the same key', () => {
  const a = doc();
  const otherHeader = newHeader({ collection: 'board', docId: 'board-2026-08', keyVersion: 1, edk: 'vault:v1:abc' });
  const foreign = sealFrame(a.dek, otherHeader, 1, false, 'not yours');
  assert.throws(() => openFrame(a.dek, a.header, 1, false, foreign));
});

test('a wrong data key fails', () => {
  const { header, frames } = doc();
  assert.throws(() => openAll(randomBytes(32), header, frames));
});

test('a rewrap (new encrypted key and version) keeps the frames valid; another document id does not', () => {
  const { dek, header, frames } = doc();
  assert.deepEqual(openAll(dek, { ...header, edk: 'vault:v2:xyz', key_version: 2 }, frames), ['first part', 'second part', 'third part']);
  assert.throws(() => openAll(dek, { ...header, doc_id: 'board-2026-08' }, frames));
  assert.throws(() => openAll(dek, { ...header, nonce_prefix: Buffer.alloc(7).toString('base64') }, frames));
});

test('chunks keep paragraphs and stay near the size', () => {
  const text = Array.from({ length: 8 }, (_, i) => `Paragraph ${i} `.repeat(12).trim()).join('\n\n');
  const parts = chunk(text, 400);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 400));
  assert.equal(parts.join('\n\n').replace(/\s+/g, ' '), text.replace(/\s+/g, ' '));
});

test('zero wipes a key; a fingerprint is 8 hex', () => {
  const k = randomBytes(32);
  assert.match(fingerprint(k), /^[0-9a-f]{8}$/);
  zero(k);
  assert.ok(k.every((b) => b === 0));
});
