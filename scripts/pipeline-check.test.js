import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { check, digest, inSubnet } from './pipeline-check.js';

const cfg = () => JSON.parse(readFileSync(new URL('../config/pipeline.json', import.meta.url), 'utf8'));

test('the tracked config is valid, corpus included', () => {
  assert.deepEqual(check(cfg(), { corpusDir: new URL('../corpus', import.meta.url).pathname }), []);
});

test('nobody both makes data keys and opens them', () => {
  const c = cfg();
  c.workloads[0].decrypts = true;
  assert.match(check(c).join('\n'), /both create data keys and decrypt/);
});

test('caller rules name known workloads, never the callee itself', () => {
  const c = cfg();
  c.workloads[1].accepts.push({ from: 'ghost', op: 'store' }, { from: 'keeper', op: 'store' });
  const errs = check(c).join('\n');
  assert.match(errs, /unknown workload ghost/);
  assert.match(errs, /from itself/);
});

test('addresses stay in the subnet and are unique', () => {
  const c = cfg();
  c.workloads[0].address = '10.89.231.11';
  c.workloads[2].address = c.workloads[1].address;
  const errs = check(c).join('\n');
  assert.match(errs, /not in 10\.89\.230\.0\/24/);
  assert.match(errs, /used twice/);
  assert.equal(inSubnet('10.89.230.255', '10.89.230.0/24'), true);
  assert.equal(inSubnet('10.89.230.256', '10.89.230.0/24'), false);
});

test('one reader group per collection, no document in two', () => {
  const c = cfg();
  c.collections[1].reader_group = c.collections[0].reader_group;
  c.collections[1].documents.push(c.collections[0].documents[0]);
  const errs = check(c).join('\n');
  assert.match(errs, /its own reader group/);
  assert.match(errs, /in two collections/);
});

test('the digest ignores key order and changes with content', () => {
  const a = cfg();
  const b = Object.fromEntries(Object.entries(a).reverse());
  assert.equal(digest(a), digest(b));
  b.title = 'x';
  assert.notEqual(digest(a), digest(b));
});
