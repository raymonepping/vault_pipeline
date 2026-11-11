import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossSiteWrite, safeReturn } from '../lib/session.js';

const req = (method, site) => ({ method, headers: site === undefined ? {} : { 'sec-fetch-site': site } });

test('crossSiteWrite: only this origin, a typed address or a script may write', () => {
  assert.equal(crossSiteWrite(req('POST', 'same-origin')), false);
  assert.equal(crossSiteWrite(req('POST', 'none')), false);
  assert.equal(crossSiteWrite(req('POST')), false); // curl, the tests: no browser header
  // every https://localhost:<port> is the same SITE: another local app's page
  assert.equal(crossSiteWrite(req('POST', 'same-site')), true);
  assert.equal(crossSiteWrite(req('POST', 'cross-site')), true);
  assert.equal(crossSiteWrite(req('GET', 'cross-site')), false);
});

test('safeReturn: back to a page of this console, never elsewhere', () => {
  assert.equal(safeReturn('/'), '/');
  assert.equal(safeReturn('/#/librarian'), '/#/librarian');
  assert.equal(safeReturn(null), '/');
  for (const bad of ['//evil.example', 'https://evil.example/', '/#/../x', '/\\evil.example', '/#/line?x=1', 'javascript:alert(1)']) {
    assert.equal(safeReturn(bad), '/', bad);
  }
});

import { groupsOf, mayAct } from '../lib/oidc.js';

test('operators are decided by the signed groups claim, nothing else', () => {
  assert.equal(mayAct({ groups: ['pipeline-staff', 'pipeline-operators'] }), true);
  assert.equal(mayAct({ groups: ['pipeline-staff', 'pipeline-board'] }), false);
  assert.equal(mayAct({ groups: 'pipeline-operators' }), false); // a string is not a list
  assert.equal(mayAct({}), false);
  assert.deepEqual(groupsOf({ groups: ['a', 1] }), ['a', '1']);
});
