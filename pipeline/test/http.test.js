import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guestList } from '../lib/http.js';

const cfg = JSON.parse(readFileSync(new URL('../../config/pipeline.json', import.meta.url), 'utf8'));

test('guest lists come from config/pipeline.json', () => {
  const keeper = guestList(cfg, 'keeper');
  assert.deepEqual([...keeper.get('store')], ['scribe']);
  assert.deepEqual([...keeper.get('search')], ['librarian']);
  assert.equal(keeper.get('store').has('console'), false);
  assert.deepEqual([...guestList(cfg, 'librarian').get('ask')], ['console']);
  assert.throws(() => guestList(cfg, 'nobody'));
});

test('only the scribe may knock on the keeper\'s ping door', () => {
  assert.deepEqual([...guestList(cfg, 'keeper').get('ping')], ['scribe']);
});
