// components/Person.jsx: who is signed in (D13), from vault_balancing. Sign-in
// is Keycloak's own page (federated from OpenLDAP); the console keeps the tokens.
import { useState } from 'react';
import { LogIn, LogOut, UserRound } from 'lucide-react';

const GROUP = { 'pipeline-staff': 'staff: reads the handbook', 'pipeline-board': 'board: reads the minutes', 'pipeline-operators': 'operators: press the act buttons' };
export const signInHref = () => `/auth/login?return=${encodeURIComponent(`/${window.location.hash.split('?')[0] || '#/line'}`)}`;

export default function Person({ me }) {
  const [open, setOpen] = useState(false);
  if (!me) return null;
  if (!me.signedIn) {
    return (
      <a className="primary-button signin-button" href={signInHref()}>
        <LogIn size={14} aria-hidden="true" /> Sign in
      </a>
    );
  }
  return (
    <div className="user-menu">
      <button type="button" className="persona" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="persona-dot persona-dot--auth" aria-hidden="true" />
        <UserRound size={13} aria-hidden="true" />
        <span>{me.name}</span>
      </button>
      {open && (
        <div className="user-menu-panel" role="dialog" aria-label="Signed in">
          <div className="umf-row umf-user">{me.name}</div>
          {(me.groups ?? []).map((g) => (
            <div key={g} className="umf-row umf-meta">{GROUP[g] ?? g}</div>
          ))}
          <div className="umf-row umf-meta">Keycloak signs the groups; Vault decides what they may read.</div>
          {/* A POST, so a page on another localhost port cannot sign the presenter out. */}
          <form method="post" action="/auth/logout">
            <button type="submit" className="umf-signout">
              <LogOut size={12} aria-hidden="true" /> Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
