// pages/Pipe.jsx: Act I. The scribe seals each document with its own data
// key and streams the frames to the keeper; the database holds ciphertext and
// vectors. An operator presses; everyone signed in watches.
import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { useResource } from '../hooks.js';
import { postStream } from '../stream.js';
import { record } from '../said.js';
import { Hero, Mono, StatePill } from '../components/ui.jsx';
import { Gate, operatorReason } from '../components/gate.jsx';

export default function Pipe({ me }) {
  const docs = useResource('/api/collections');
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(null);
  const reason = operatorReason(me);
  useEffect(() => { if (docs.data) record('GET /api/collections', docs.data.documents); }, [docs.data]);

  const ingest = async (collection) => {
    setBusy(collection);
    setEvents([]);
    const seen = [];
    await postStream('/api/acts/ingest', { collection }, (e) => { seen.push(e); setEvents((x) => [...x, e]); });
    record(`POST /api/acts/ingest ${collection}`, seen);
    setBusy(null);
    docs.reload();
  };

  return (
    <div className="page-stack">
      <Hero kicker="Act I" title="Into the pipe, sealed.">
        <p className="hero-lede">
          The scribe asks Vault for one data key per document, seals each document as a stream of AES-256-GCM frames, and sends them to the keeper with a badge minted for the keeper alone. The scribe cannot open what it sealed; the keeper never holds a key.
        </p>
      </Hero>
      <section className="vg-card stack" aria-labelledby="ingest-h">
        <h3 id="ingest-h" className="m-0">Send a collection down the line</h3>
        <div className="row-actions">
          {['handbook', 'board'].map((c) => (
            <button key={c} type="button" className="primary-button" disabled={Boolean(reason) || Boolean(busy)} onClick={() => ingest(c)}>
              <Play size={14} aria-hidden="true" /> Seal the {c}
            </button>
          ))}
          {reason && <span className="muted" data-testid="action-reason">{reason}</span>}
        </div>
        {events.length > 0 && (
          <ol className="events" aria-live="polite">
            {events.map((e, i) => (
              <li key={i} className={`event${e.event === 'error' ? ' event--bad' : e.event === 'document' ? ' event--good' : ''}`}>
                <span className="event__what">{e.event === 'document' ? e.doc_id : e.event}</span>
                <span className="event__detail">
                  {e.event === 'document' ? (
                    <>
                      <span>{e.chunks} frames</span>
                      <span>data key <Mono>{e.dek_fingerprint}</Mono> (fingerprint)</span>
                      <span>encrypted key <Mono>{e.edk_prefix}…</Mono></span>
                      <span>keeper {e.keeper.status === 200 ? 'stored it' : `refused: ${e.keeper.error?.message}`}</span>
                    </>
                  ) : e.event === 'error' ? e.message : e.event === 'pressed' ? `by ${e.by}` : e.event === 'start' ? `${e.documents} documents in ${e.collection}` : ''}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="vg-card stack" aria-labelledby="db-h">
        <h3 id="db-h" className="m-0">What the database holds</h3>
        <Gate error={docs.error} what="what the keeper holds" />
        {docs.data && (
          <div className="table-scroll">
            <table className="vg-table">
              <thead><tr><th scope="col">Document</th><th scope="col">Collection</th><th scope="col">Frames</th><th scope="col">Bytes</th><th scope="col">Encrypted key</th><th scope="col">Sealed by</th></tr></thead>
              <tbody>
                {docs.data.documents.length === 0 && <tr><td colSpan={6} className="muted">Nothing stored yet.</td></tr>}
                {docs.data.documents.map((d) => (
                  <tr key={d.doc_id}>
                    <td><Mono>{d.doc_id}</Mono></td>
                    <td>{d.collection}</td>
                    <td className="num">{d.frames}</td>
                    <td className="num">{d.bytes}</td>
                    <td><StatePill state="info">{d.edk_prefix}…</StatePill></td>
                    <td><Mono>{d.sealed_by.replace(/^spiffe:\/\/[^/]+/, '')}</Mono></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted m-0">
          Frames are bytes, not text. The embeddings next to them are plaintext on purpose (the keeper searches them), and an embedding carries meaning: research has rebuilt text from embeddings. This lab says so rather than pretending otherwise.
        </p>
      </section>
    </div>
  );
}
