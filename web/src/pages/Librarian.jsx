// pages/Librarian.jsx: Act II. A person asks; the console logs that person
// in to Vault for this one question; the librarian opens passages with the
// person's token only, and Vault refuses what the person may not read.
import { useState } from 'react';
import { Send } from 'lucide-react';
import { postStream } from '../stream.js';
import { record } from '../said.js';
import { Hero, Mono, StatePill } from '../components/ui.jsx';
import { SignInFirst } from '../components/gate.jsx';

const SUGGESTED = ['How many days do I have to file a travel expense?', 'What is Project Lighthouse?'];

export default function Librarian({ me }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [facts, setFacts] = useState(null);
  const [busy, setBusy] = useState(false);

  const ask = async (q) => {
    if (!q.trim()) return;
    setQuestion(q);
    setBusy(true);
    setAnswer('');
    const f = { refused: [], sources: [], opened: [], login: null, logout: null, error: null };
    setFacts(f);
    const seen = [];
    await postStream('/api/ask', { question: q }, (e) => {
      seen.push(e.event === 'token' ? { event: 'token' } : e);
      if (e.event === 'token') setAnswer((a) => a + e.text);
      else {
        if (e.event === 'vault_login') f.login = e;
        if (e.event === 'vault_logout') f.logout = e;
        if (e.event === 'passages') f.opened = [...new Set(e.opened.map((p) => p.doc_id))];
        if (e.event === 'refused') f.refused.push(e);
        if (e.event === 'done') f.sources = e.sources;
        if (e.event === 'error') f.error = e.message;
        setFacts({ ...f });
      }
    });
    record(`POST /api/ask as ${me?.user}`, seen);
    setBusy(false);
  };

  return (
    <div className="page-stack">
      <Hero kicker="Act II" title="The librarian reads only what you may read.">
        <p className="hero-lede">
          The librarian's own token can decrypt nothing. For each question the console logs you in to Vault with your Keycloak token (120 seconds, usable only by the console and the librarian), the librarian opens passages with that token, and the console revokes it when the answer ends. A deputy acting with your authority cannot be talked into using its own.
        </p>
      </Hero>
      {!me?.signedIn ? (
        <SignInFirst what="the librarian" />
      ) : (
        <section className="vg-card stack" aria-labelledby="ask-h">
          <h3 id="ask-h" className="m-0">Ask, as {me.name}</h3>
          <p className="muted m-0 guests">Your groups: {me.groups.map((g) => <StatePill key={g} state="info">{g}</StatePill>)}</p>
          <form className="ask" onSubmit={(e) => { e.preventDefault(); ask(question); }}>
            <label className="form-field">
              <span>Question</span>
              <input value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about the handbook or the board" />
            </label>
            <button type="submit" className="primary-button" disabled={busy || !question.trim()}>
              <Send size={14} aria-hidden="true" /> Ask
            </button>
          </form>
          <div className="suggestions">
            {SUGGESTED.map((q) => (
              <button key={q} type="button" className="secondary-button" disabled={busy} onClick={() => ask(q)}>{q}</button>
            ))}
          </div>
        </section>
      )}
      {facts && (
        <section className="vg-card stack" aria-labelledby="answer-h" aria-busy={busy}>
          <h3 id="answer-h" className="m-0">The answer</h3>
          <p className="answer" aria-live="polite">{answer || (busy ? 'The librarian is reading…' : '')}</p>
          {facts.sources.length > 0 && <p className="muted m-0">Sources: {facts.sources.map((s) => <Mono key={s.n}>[{s.n}] {s.doc_id}</Mono>)}</p>}
          {facts.error && <p className="inline-notice error" role="alert">{facts.error}</p>}
          {facts.refused.map((r) => (
            <div key={r.doc_id} className="inline-notice warn refusal" role="status">
              <strong>Vault would not open {r.doc_id}</strong> for {me.name} ({r.passages} matching passage{r.passages === 1 ? '' : 's'}). Vault said: <Mono>{r.vault_said}</Mono>
            </div>
          ))}
          <dl className="facts">
            <dt>Your Vault token</dt>
            <dd>{facts.login ? <>policies {facts.login.policies.map((p) => <Mono key={p}>{p}</Mono>)}, {facts.login.ttl} s</> : '…'}</dd>
            <dt>Opened with it</dt>
            <dd>{facts.opened.length ? facts.opened.map((d) => <Mono key={d}>{d}</Mono>) : 'nothing yet'}</dd>
            <dt>After the answer</dt>
            <dd>{facts.logout ? (facts.logout.revoked ? <StatePill state="ok">token revoked</StatePill> : <StatePill state="warn">not revoked: it expires in 120 s</StatePill>) : '…'}</dd>
          </dl>
        </section>
      )}
    </div>
  );
}
