// pages/Backup.jsx: Act IV. The night's backup turns up where it should not:
// what it holds, what the console's own token may do with it, where a
// person's token works, and what rotation and rewrap leave of it.
import { useState } from 'react';
import { Archive } from 'lucide-react';
import { postStream } from '../stream.js';
import { record } from '../said.js';
import { Hero, Mono, StatePill } from '../components/ui.jsx';
import { operatorReason } from '../components/gate.jsx';

function Step({ e }) {
  switch (e.event) {
    case 'backup':
      return (
        <li className={`event ${e.text_hits === 0 ? 'event--good' : 'event--bad'}`}>
          <span className="event__what">The backup</span>
          <span className="event__detail">
            <span>{e.documents} documents, {e.frames} frames, {e.bytes} bytes</span>
            <span>searched for "{e.searched_for}": {e.text_hits} hits</span>
            <span>encrypted keys {e.edk_prefixes.map((p) => <Mono key={p}>{p}:</Mono>)}</span>
          </span>
        </li>
      );
    case 'console_powers':
      return (
        <li className={`event ${e.capabilities.includes('deny') ? 'event--good' : 'event--bad'}`}>
          <span className="event__what">The console opens a key?</span>
          <span className="event__detail"><span>Vault on <Mono>{e.path}</Mono> for the console's own token: <Mono>{e.capabilities.join(', ')}</Mono></span></span>
        </li>
      );
    case 'binding':
      return (
        <li className="event event--good">
          <span className="event__what">{e.person}'s token works from</span>
          <span className="event__detail">{e.bound_cidrs.map((c) => <Mono key={c}>{c}</Mono>)}<span>{e.note}</span></span>
        </li>
      );
    case 'rotated':
      return <li className="event"><span className="event__what">Rotate</span><span className="event__detail">{e.collection}: v{e.from} to v{e.to}</span></li>;
    case 'rewrapped':
      return (
        <li className="event">
          <span className="event__what">Rewrap (the keeper)</span>
          <span className="event__detail">{e.rewrapped.map((r) => <span key={r.doc_id}><Mono>{r.doc_id}</Mono> {r.error ? r.error : `v${r.from} to v${r.to}`}</span>)}</span>
        </li>
      );
    case 'minimum_raised':
      return <li className="event"><span className="event__what">Raise the minimum</span><span className="event__detail">{e.collection} decrypts from v{e.min_decryption_version} only</span></li>;
    case 'old_key_checked':
      return (
        <li className={`event ${e.status === 200 ? 'event--bad' : 'event--good'}`}>
          <span className="event__what">The backup's key now</span>
          <span className="event__detail"><span><Mono>{e.doc_id}</Mono> from the backup (<Mono>{e.from_backup}:</Mono>)</span><span>Vault said: <Mono>{e.vault_said ?? `accepted, v${e.key_version}`}</Mono></span></span>
        </li>
      );
    case 'error':
      return <li className="event event--bad"><span className="event__what">Stopped</span><span className="event__detail">{e.message}</span></li>;
    case 'done':
      return <li className="event event--good"><span className="event__what">Done</span><span className="event__detail">Ask the librarian again: the stored keys moved with the rotation, the backup's did not.</span></li>;
    default:
      return null;
  }
}

export default function Backup({ me }) {
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const reason = operatorReason(me);
  const run = async () => {
    setBusy(true);
    setEvents([]);
    const seen = [];
    await postStream('/api/acts/backup', {}, (e) => { seen.push(e); setEvents((x) => [...x, e]); });
    record('POST /api/acts/backup', seen);
    setBusy(false);
  };
  return (
    <div className="page-stack">
      <Hero kicker="Act IV" title="The backup turns up where it should not.">
        <p className="hero-lede">
          Whoever finds it finds ciphertext, vectors and encrypted data keys. The keys open only through Vault, only for a reader, only from the console's or the librarian's address. Then the board's key is rotated and every stored encrypted key is rewrapped without decrypting a byte, so the backup's copies stop working.
        </p>
      </Hero>
      <section className="vg-card stack" aria-labelledby="run-h">
        <h3 id="run-h" className="m-0">Read the backup, then rotate</h3>
        <div className="row-actions">
          <button type="button" className="primary-button" disabled={Boolean(reason) || busy} onClick={run}>
            <Archive size={14} aria-hidden="true" /> Take the backup and rotate the board key
          </button>
          {reason && <span className="muted" data-testid="action-reason">{reason}</span>}
          {busy && <StatePill state="warn">running</StatePill>}
        </div>
        {events.length > 0 && <ol className="events" aria-live="polite">{events.map((e, i) => <Step key={i} e={e} />)}</ol>}
      </section>
    </div>
  );
}
