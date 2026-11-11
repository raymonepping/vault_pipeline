// pages/Line.jsx: Prologue. Four workloads, four badges, four key rings,
// each power as that workload's OWN token reports it (sys/capabilities-self).
import { Fragment, useEffect } from 'react';
import { useResource } from '../hooks.js';
import { record } from '../said.js';
import { Hero, Loading, Mono, StatePill } from '../components/ui.jsx';
import { Gate } from '../components/gate.jsx';

const allowed = (caps) => caps.some((c) => c === 'update' || c === 'read' || c === 'create');

export default function Line() {
  const { data, error, loading } = useResource('/api/line');
  useEffect(() => { if (data) record('GET /api/line', data); }, [data]);
  return (
    <div className="page-stack">
      <Hero kicker="Prologue" title="Nobody holds everything.">
        <p className="hero-lede">
          Four programs carry Larkspur &amp; Vane's documents from the shelf to an answer. Each has its own badge from Vault's SPIFFE engine and its own key ring. The lists below are not documentation: each workload asked Vault with its own token what it may do.
        </p>
      </Hero>
      <Gate error={error} what="the workloads" />
      {loading && !data && <Loading />}
      {data && (
        <>
          <section className="workloads" aria-label="Workloads">
            {data.workloads.map((w) => (
              <article key={w.name} className="vg-card workload" aria-labelledby={`wl-${w.name}`}>
                <h3 id={`wl-${w.name}`} className="workload__name">{w.name}</h3>
                <Mono>{w.spiffe_id}</Mono>
                <span className="muted">address {w.address}: its Vault token works from here only</span>
                {Array.isArray(w.powers) ? (
                  <ul className="powers" aria-label={`What Vault lets ${w.name} do`}>
                    {w.powers.map((p) => (
                      <li key={p.path} className="power">
                        <span className={allowed(p.capabilities) ? 'power__yes' : 'power__no'}>{allowed(p.capabilities) ? 'may' : 'may not'}</span>
                        <Mono>{p.path}</Mono>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">{w.powers?.error ?? 'did not answer'}</p>
                )}
                <div className="guests" aria-label={`Who may call ${w.name}`}>
                  {w.accepts.length ? w.accepts.map((a) => <StatePill key={`${a.from}-${a.op}`} state="info">{a.from} may {a.op}</StatePill>) : <span className="muted">nobody calls the console: people do</span>}
                </div>
              </article>
            ))}
          </section>
          <section className="vg-card stack" aria-labelledby="trust-h">
            <h3 id="trust-h" className="m-0">The trust domain</h3>
            <dl className="facts">
              <dt>Trust domain</dt><dd><Mono>{data.trust_domain}</Mono></dd>
              <dt>Issuer every workload checks</dt><dd><Mono>{data.issuer}</Mono></dd>
              <dt>Signing keys in Vault's JWKS</dt><dd>{data.jwks_kids.map((k) => <Mono key={k}>{k.slice(0, 8)}</Mono>)}</dd>
              {data.collections.map((c) => (
                <Fragment key={c.name}><dt>Collection {c.name}</dt><dd>{c.documents.length} documents, readable by <Mono>{c.reader_group}</Mono></dd></Fragment>
              ))}
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
