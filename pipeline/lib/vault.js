// pipeline/lib/vault.js: one workload's Vault client (D9). Secret zero is a
// response-wrapped single-use secret id: unwrap it once, log in with AppRole,
// keep the token in memory, renew it at two thirds of its TTL. No token ever
// reaches a log line or a response. Standbys forward, so any node will do:
// the client tries the next node on a network error.
import { readFileSync } from 'node:fs';

export class VaultError extends Error {
  constructor(status, errors, path) {
    super(`${path}: ${status} ${(errors ?? []).join('; ')}`.trim());
    this.status = status;
    this.errors = errors ?? [];
    this.path = path;
  }
  // Vault's own words, for the console's "Vault said" drawer.
  // Vault wraps some errors ("1 error occurred:\n\t* permission denied"): unwrap.
  get said() { return this.errors.map((e) => String(e).replace(/^\d+ errors? occurred:\s*/, '').replace(/^\*\s*/gm, '').trim()).join('; ') || `HTTP ${this.status}`; }
}

export class SecretZeroError extends Error {}

// A refusal is Vault's own 4xx answer. A timeout or an unreachable Vault is
// an error, never "you may not read this".
export const isRefusal = (e) => e instanceof VaultError && e.status >= 400 && e.status < 500;

// A timeout that cannot silently never fire (MEMORY: AbortSignal.timeout).
export async function fetchWithin(url, init = {}, ms = 10_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error(`timeout after ${ms} ms: ${url}`)), ms);
  const { signal, ...rest } = init;
  signal?.addEventListener('abort', () => ac.abort(signal.reason), { once: true });
  try { return await fetch(url, { ...rest, signal: ac.signal }); } finally { clearTimeout(t); }
}

export function createVault({ addrs, log = () => {} }) {
  let token = null;
  let renewTimer = null;

  async function raw(method, path, { body, headers = {}, as } = {}) {
    const tok = as === undefined ? token : as;
    let lastErr;
    for (const addr of addrs) {
      let r;
      try {
        r = await fetchWithin(`${addr}/v1/${path}`, {
          method,
          headers: { ...(tok ? { 'X-Vault-Token': tok } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) { lastErr = e; continue; } // that node is down: try the next
      const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
      if (!r.ok) throw new VaultError(r.status, j.errors, path);
      return j;
    }
    throw lastErr ?? new Error('no Vault address');
  }

  async function renewLoop(ttl) {
    clearTimeout(renewTimer);
    renewTimer = setTimeout(async () => {
      try {
        const j = await raw('POST', 'auth/token/renew-self', { body: {} });
        renewLoop(j.auth.lease_duration);
      } catch (e) {
        log('vault.renew_failed', { message: e.message });
        renewLoop(30); // try again soon; the token lives until its TTL
      }
    }, Math.max(5, Math.floor((ttl * 2) / 3)) * 1000);
    renewTimer.unref();
  }

  return {
    call: (method, path, opts) => raw(method, path, opts),
    // Calls made with someone else's token (the librarian's asker, D13).
    callAs: (tok, method, path, opts = {}) => raw(method, path, { ...opts, as: tok }),
    get ready() { return Boolean(token); },

    // D9: unwrap once, log in, renew. The files are mounted read-only.
    async secretZero({ roleIdFile, wrappedFile }) {
      const roleId = readFileSync(roleIdFile, 'utf8').trim();
      const wrapped = readFileSync(wrappedFile, 'utf8').trim();
      let secretId;
      try {
        secretId = (await raw('POST', 'sys/wrapping/unwrap', { body: {}, as: wrapped })).data.secret_id;
      } catch (e) {
        if (e instanceof VaultError) {
          throw new SecretZeroError(`secret zero was already opened or has expired (Vault said: ${e.said}); make pipeline-up delivers a new one, and the audit log names who opened it`);
        }
        throw e;
      }
      const j = await raw('POST', 'auth/approle/login', { body: { role_id: roleId, secret_id: secretId }, as: null });
      token = j.auth.client_token;
      renewLoop(j.auth.lease_duration);
      return { accessor: j.auth.accessor, entity_id: j.auth.entity_id, policies: j.auth.token_policies };
    },

    stop() { clearTimeout(renewTimer); },
  };
}
