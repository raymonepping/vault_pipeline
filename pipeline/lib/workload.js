// pipeline/lib/workload.js: what every workload does at start. Read its
// settings, open secret zero, build its minter and verifier, and call other
// workloads with a fresh SVID per call.
import { readFileSync } from 'node:fs';
import { createVault, fetchWithin, SecretZeroError } from './vault.js';
import { createMinter, createVerifier } from './svid.js';
import { log, requestContext } from './http.js';

export function settings(name) {
  const cfg = JSON.parse(readFileSync(process.env.PIPELINE_CONFIG ?? '/config/pipeline.json', 'utf8'));
  const addrs = (process.env.VAULT_ADDRS ?? 'https://vault-1:8200,https://vault-2:8200,https://vault-3:8200').split(',');
  return {
    name,
    cfg,
    addrs,
    me: cfg.workloads.find((w) => w.name === name),
    issuer: `https://vault.${cfg.trust_domain}/v1/spiffe`,
    tls: { key: process.env.TLS_KEY ?? '/tls/vault.key', cert: process.env.TLS_CERT ?? '/tls/vault.crt' },
    secrets: { roleIdFile: '/run/secret-zero/role_id', wrappedFile: '/run/secret-zero/wrapped' },
    ollama: process.env.OLLAMA_URL ?? 'http://ollama:11434',
  };
}

export async function start(name) {
  const s = settings(name);
  const logger = log(name);
  const vault = createVault({ addrs: s.addrs, log: logger });
  try {
    const who = await vault.secretZero(s.secrets);
    logger('secret_zero_opened', { accessor_fp: who.accessor?.slice(0, 6), policies: who.policies });
  } catch (e) {
    logger(e instanceof SecretZeroError ? 'secret_zero_refused' : 'login_failed', { message: e.message });
    process.exit(78); // EX_CONFIG: a restart cannot fix this; make pipeline-up can
  }
  const verifier = createVerifier({
    self: name,
    trustDomain: s.cfg.trust_domain,
    issuer: s.issuer,
    fetchJwks: () => vault.call('GET', 'spiffe/.well-known/keys', { as: null }),
  });
  const mint = createMinter({ vault, self: name, trustDomain: s.cfg.trust_domain });

  // call(callee, method, path, body?) with a fresh SVID; returns the Response.
  async function call(callee, method, path, { body, raw, ms = 60_000, signal } = {}) {
    const w = s.cfg.workloads.find((x) => x.name === callee);
    const svid = await mint(callee);
    return fetchWithin(`https://${callee}:${w.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${svid}`, ...(requestContext.getStore()?.id ? { 'x-request-id': requestContext.getStore().id } : {}), ...(body !== undefined ? { 'content-type': raw ? 'application/x-ndjson' : 'application/json' } : {}) },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      signal,
    }, ms);
  }

  // What this workload's own token may do: its powers, proven by Vault.
  async function powers(paths) {
    const j = await vault.call('POST', 'sys/capabilities-self', { body: { paths } });
    const caps = j.data ?? j;
    return paths.map((p) => ({ path: p, capabilities: caps[p] ?? [] }));
  }

  return { ...s, vault, verifier, mint, call, powers, logger };
}

// Ollama: embeddings and a streamed chat answer (D16).
export function ollama(base) {
  return {
    async embed(model, input) {
      const r = await fetchWithin(`${base}/api/embed`, { method: 'POST', body: JSON.stringify({ model, input }) }, 120_000);
      if (!r.ok) throw new Error(`ollama embed: ${r.status}`);
      return (await r.json()).embeddings;
    },
    async *chat(model, messages, options) {
      const r = await fetchWithin(`${base}/api/chat`, { method: 'POST', body: JSON.stringify({ model, messages, stream: true, options }) }, 300_000);
      if (!r.ok) throw new Error(`ollama chat: ${r.status}`);
      const dec = new TextDecoder();
      let buf = '';
      for await (const part of r.body) {
        buf += dec.decode(part, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (line) yield JSON.parse(line);
        }
      }
    },
  };
}
