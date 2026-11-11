// components/gate.jsx: what a page shows before it can show anything: a
// sign-in link (most pages need a person), or the console's error verbatim.
import { LogIn } from 'lucide-react';
import { ErrorNotice } from './ui.jsx';
import { signInHref } from './Person.jsx';

export function SignInFirst({ what }) {
  return (
    <div className="inline-notice info" role="status">
      <strong>Sign in to see {what}.</strong>
      <p className="m-0">
        The console asks the workloads with its own badge, and only for a signed-in person.{' '}
        <a className="hero-link" href={signInHref()}>
          <LogIn size={14} aria-hidden="true" /> Sign in
        </a>
      </p>
    </div>
  );
}

// An API error, or the sign-in notice when the answer was 401.
export function Gate({ error, what }) {
  if (!error) return null;
  if (error.status === 401) return <SignInFirst what={what} />;
  return <ErrorNotice error={error} />;
}

// Why a button is off, in one line.
export function operatorReason(me) {
  if (!me?.signedIn) return 'Sign in as an operator to press this.';
  if (!me.operator) return `${me.name} is not in pipeline-operators: this button is for operators.`;
  return null;
}
