// pages/Custody.jsx: Epilogue. Who touched which document, when: the
// keeper's custody rows (append-only: its database role cannot change them).
import { useEffect, useState } from 'react';
import { useResource } from '../hooks.js';
import { record } from '../said.js';
import { Hero, Mono, StatePill, hms } from '../components/ui.jsx';
import { Gate } from '../components/gate.jsx';

const DOCS = ['onboarding', 'travel-policy', 'safety-at-the-forge', 'board-2026-08', 'board-2026-09', 'board-2026-10'];
const who = (a) => a.replace(/^spiffe:\/\/[^/]+\/workload\//, '');

export default function Custody() {
  const [doc, setDoc] = useState('board-2026-10');
  const { data, error } = useResource(`/api/custody?doc=${encodeURIComponent(doc)}`, { intervalMs: 10_000 });
  useEffect(() => { if (data) record(`GET /api/custody ${doc}`, data.custody.slice(-20)); }, [data, doc]);
  return (
    <div className="page-stack">
      <Hero kicker="Epilogue" title="Every hand, on the record.">
        <p className="hero-lede">
          The keeper writes a custody row for every store, search, rewrap, backup and refused badge, with the caller's SPIFFE ID. Its database role may add rows and read them, never change or delete one: a story reset forgets documents, not their history. Vault's own audit log on three nodes holds the same night from Vault's side.
        </p>
      </Hero>
      <section className="vg-card stack" aria-labelledby="custody-h">
        <div className="row-actions">
          <h3 id="custody-h" className="m-0">The custody of</h3>
          <label className="form-field">
            <span className="sr-only">Document</span>
            <select value={doc} onChange={(e) => setDoc(e.target.value)}>
              {DOCS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        </div>
        <Gate error={error} what="the custody log" />
        {data && (
          <ol className="custody">
            {data.custody.length === 0 && <li className="muted">No rows yet.</li>}
            {data.custody.map((r) => (
              <li key={r.id}>
                <span className="num">{hms(r.at)}</span>
                <Mono>{who(r.actor)}</Mono>
                <StatePill state={r.action === 'refused' ? 'denied' : r.action === 'searched' ? 'info' : 'ok'}>{r.action}</StatePill>
                <Mono>{JSON.stringify(r.detail)}</Mono>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
