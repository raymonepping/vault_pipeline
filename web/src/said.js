// said.js: the last raw answers from the console, for the "Vault said"
// drawer: every page records what it was shown, verbatim (never a token: the
// console never returns one).
import { useSyncExternalStore } from 'react';

let entries = [];
const listeners = new Set();
export function record(label, data) {
  entries = [{ label, at: new Date().toISOString(), data }, ...entries].slice(0, 12);
  listeners.forEach((l) => l());
}
export const useSaid = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => entries,
  );
