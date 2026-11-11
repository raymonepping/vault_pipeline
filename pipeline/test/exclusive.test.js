import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exclusive, Busy } from '../lib/exclusive.js';

test('a second run on the same key is refused while the first runs, and allowed after', async () => {
  const x = exclusive();
  let release;
  const first = x.run('act', 'backup (pressed by ada)', () => new Promise((r) => { release = r; }));
  await assert.rejects(x.run('act', 'ingest (pressed by oscar)', async () => {}), (e) => e instanceof Busy && e.status === 409 && /backup \(pressed by ada\) is running/.test(e.message));
  release('done');
  assert.equal(await first, 'done');
  assert.equal(await x.run('act', 'ingest', async () => 'ok'), 'ok');
});

test('the slot is freed when the work fails, and other keys never wait', async () => {
  const x = exclusive();
  await assert.rejects(x.run('vera', 'q', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(x.holding('vera'), false);
  let release;
  const a = x.run('vera', 'q1', () => new Promise((r) => { release = r; }));
  assert.equal(await x.run('ada', 'q2', async () => 'ada answered'), 'ada answered');
  release();
  await a;
});
