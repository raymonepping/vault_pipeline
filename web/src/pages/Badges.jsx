// pages/Badges.jsx: Act III. Who may knock on which door, from
// config/pipeline.json, the checks every workload runs on every badge, and
// the unit tests that prove each refusal (pipeline/test/svid.test.js).
import { useEffect } from 'react';
import { CircleCheck, CircleX } from 'lucide-react';
import { useResource } from '../hooks.js';
import { record } from '../said.js';
import { Hero, Loading, Mono, StatePill, ago } from '../components/ui.jsx';
import { ErrorNotice } from '../components/ui.jsx';

export default function Badges() {
  const { data, error, loading } = useResource('/api/acts/badges');
  useEffect(() => { if (data) record('GET /api/acts/badges', data); }, [data]);
  const tests = data?.unit_tests;
  const badgeTests = tests?.tests.filter((t) => t.file.endsWith('svid.test.js')) ?? [];
  return (
    <div className="page-stack">
      <Hero kicker="Act III" title="A badge opens one door, once, for one minute.">
        <p className="hero-lede">
          Every call between workloads carries a JWT-SVID that Vault minted for that one callee. The callee checks it before anything else, then looks the caller up on its guest list. A badge is not a passport.
        </p>
      </Hero>
      <ErrorNotice error={error} />
      {loading && !data && <Loading label="Reading the guest lists…" />}
      {data && (
        <>
          <section className="vg-card stack" aria-labelledby="checks-h">
            <h3 id="checks-h" className="m-0">What every workload checks, on every call</h3>
            <ol className="checks">{data.checks_in_every_call.map((c) => <li key={c}>{c}</li>)}</ol>
          </section>
          <section aria-labelledby="doors-h" className="stack">
            <h3 id="doors-h" className="m-0">The guest lists</h3>
            <div className="doors">
              {data.guest_lists.map((g) => (
                <article key={g.workload} className="vg-card door" aria-label={`${g.workload}'s doors`}>
                  <h4 className="workload__name">{g.workload}</h4>
                  {g.doors.map((d) => (
                    <div key={d.op} className="power">
                      <Mono>{d.op}</Mono>
                      <span className="guests">{d.guests.map((x) => <StatePill key={x} state="info">{x}</StatePill>)}</span>
                    </div>
                  ))}
                </article>
              ))}
            </div>
            <p className="muted m-0">Anyone else, with any valid badge, is refused as <Mono>not-a-guest</Mono>.</p>
          </section>
          <section className="vg-card stack" aria-labelledby="tests-h">
            <h3 id="tests-h" className="m-0">The proof: the badge verifier's unit tests</h3>
            {tests ? (
              <>
                <p className="m-0">
                  <StatePill state={tests.failed ? 'denied' : 'ok'}>{tests.passed} passed, {tests.failed} failed</StatePill>{' '}
                  <span className="muted">make test-unit, {ago(tests.ran_at)} on Node {tests.node}; <Mono>pipeline/test/svid.test.js</Mono></span>
                </p>
                <ul className="test-list">
                  {badgeTests.map((t) => (
                    <li key={t.name}>
                      {t.pass ? <CircleCheck size={15} className="power__yes" aria-label="passed" /> : <CircleX size={15} className="power__no" aria-label="failed" />}
                      {t.name}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="inline-notice warn m-0">No results yet: run <Mono>make test-unit</Mono>.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
