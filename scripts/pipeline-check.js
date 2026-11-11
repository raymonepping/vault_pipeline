#!/usr/bin/env node
// scripts/pipeline-check.js: validate config/pipeline.json, the one source
// for workloads, caller rules, collections and people. Prints the digest
// (sha256 of the canonical JSON) that Ansible and the console compare.
// Usage: node scripts/pipeline-check.js config/pipeline.json [--digest]
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';

const NAME = /^[a-z][a-z0-9-]{1,30}$/;

const canonical = (v) =>
  Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  : JSON.stringify(v);

export const digest = (cfg) => createHash('sha256').update(canonical(cfg)).digest('hex');

const ipToInt = (ip) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
export function inSubnet(ip, cidr) {
  const [base, bits] = cidr.split('/');
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || ip.split('.').some((o) => Number(o) > 255)) return false;
  const mask = bits === '0' ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
  return ((ipToInt(ip) & mask) >>> 0) === ((ipToInt(base) & mask) >>> 0);
}

// Returns a list of problems; empty means valid.
export function check(cfg, { corpusDir } = {}) {
  const errs = [];
  const req = (cond, msg) => { if (!cond) errs.push(msg); };
  req(/^[a-z0-9.-]+$/.test(cfg.trust_domain ?? ''), 'trust_domain must be a DNS-like name');
  req(/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(cfg.subnet ?? ''), 'subnet must be a CIDR');
  const wl = cfg.workloads ?? [];
  const names = new Set(wl.map((w) => w.name));
  req(names.size === wl.length && wl.length > 0, 'workload names must be unique and present');
  const addrs = new Set();
  for (const w of wl) {
    req(NAME.test(w.name ?? ''), `workload name ${w.name} is not a plain name`);
    req(w.spiffe_path === `/workload/${w.name}`, `${w.name}: spiffe_path must be /workload/${w.name}`);
    req(inSubnet(w.address ?? '', cfg.subnet ?? '0.0.0.0/32'), `${w.name}: address ${w.address} is not in ${cfg.subnet}`);
    req(!addrs.has(w.address), `${w.name}: address ${w.address} is used twice`);
    addrs.add(w.address);
    // The point of the lab: nobody both makes data keys and opens them.
    req(!(w.creates_data_keys && w.decrypts), `${w.name}: a workload may not both create data keys and decrypt`);
    for (const a of w.accepts ?? []) {
      req(names.has(a.from), `${w.name}: accepts calls from unknown workload ${a.from}`);
      req(a.from !== w.name, `${w.name}: may not accept calls from itself`);
      req(NAME.test(a.op ?? ''), `${w.name}: operation ${a.op} is not a plain name`);
    }
  }
  const groups = new Set(cfg.groups ?? []);
  const cols = cfg.collections ?? [];
  const docs = new Set();
  for (const c of cols) {
    req(NAME.test(c.name ?? '') && c.key === c.name, `collection ${c.name}: key must equal the name`);
    req(groups.has(c.reader_group), `collection ${c.name}: reader group ${c.reader_group} is not a known group`);
    for (const d of c.documents ?? []) {
      req(NAME.test(d), `collection ${c.name}: document id ${d} is not a plain name`);
      req(!docs.has(d), `document ${d} is in two collections`);
      docs.add(d);
      if (corpusDir) req(existsSync(join(corpusDir, c.name, `${d}.md`)), `corpus/${c.name}/${d}.md is missing`);
    }
  }
  const readers = cols.map((c) => c.reader_group);
  req(new Set(readers).size === readers.length, 'each collection needs its own reader group');
  req(groups.has(cfg.operator_group), 'operator_group must be a known group');
  for (const p of cfg.people ?? []) {
    req(NAME.test(p.user ?? ''), `person ${p.user} is not a plain name`);
    for (const g of p.groups ?? []) req(groups.has(g), `${p.user}: unknown group ${g}`);
  }
  for (const q of cfg.questions ?? []) req(cols.some((c) => c.name === q.collection), `question for unknown collection ${q.collection}`);
  return errs;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] ?? 'config/pipeline.json';
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  const errs = check(cfg, { corpusDir: join(dirname(file), '..', 'corpus') });
  if (errs.length) {
    for (const e of errs) console.error(`  ${e}`);
    console.error(`${file}: ${errs.length} problem(s)`);
    process.exit(1);
  }
  if (process.argv.includes('--digest')) console.log(digest(cfg));
  else console.log(`${file}: ok (${cfg.workloads.length} workloads, ${cfg.collections.length} collections, digest ${digest(cfg).slice(0, 12)})`);
}
