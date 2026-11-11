// pipeline/lib/http.js: a workload's HTTPS server (TLS 1.3, lab CA). Every
// route names an operation; the caller's SVID is verified (svid.js) and the
// caller must be on that operation's guest list in config/pipeline.json.
// One error shape: { error: { code, message, request_id } }. Logs are JSON
// lines without a token, a data key or a body.
import { createServer } from 'node:https';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SvidRefusal } from './svid.js';
import { AsyncLocalStorage } from 'node:async_hooks';

// The request id of the call being served: workload.js call() carries it on
// to the next workload, so one question can be followed through every log.
export const requestContext = new AsyncLocalStorage();

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const REFUSAL_STATUS = { 'not-a-guest': 403, 'wrong-audience': 401, expired: 401, replayed: 401, 'bad-signature': 401, malformed: 401, 'no-badge': 401 };

export const log = (name) => (event, fields = {}) =>
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), workload: name, event, ...fields })}\n`);

// guestList(cfg, name) -> Map(op -> Set(callers)) from the caller rules.
export function guestList(cfg, name) {
  const me = cfg.workloads.find((w) => w.name === name);
  if (!me) throw new Error(`unknown workload ${name}`);
  const m = new Map();
  for (const { from, op } of me.accepts) {
    if (!m.has(op)) m.set(op, new Set());
    m.get(op).add(from);
  }
  return m;
}

export async function readBody(req, limit) {
  const parts = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw new HttpError(413, 'too_large', `body over ${limit} bytes`);
    parts.push(c);
  }
  return Buffer.concat(parts).toString('utf8');
}

export async function readJson(req, limit = 1 << 20) {
  const s = await readBody(req, limit);
  if (!s) return {};
  try { return JSON.parse(s); } catch { throw new HttpError(400, 'bad_json', 'the body is not JSON'); }
}

// NDJSON in: one JSON value per line.
export async function readNdjson(req, limit) {
  return (await readBody(req, limit)).split('\n').filter(Boolean).map((l, i) => {
    try { return JSON.parse(l); } catch { throw new HttpError(400, 'bad_json', `line ${i + 1} is not JSON`); }
  });
}

// NDJSON out, streamed: events reach the console as they happen.
export function ndjson(res) {
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  return { send: (o) => res.write(`${JSON.stringify(o)}\n`), end: () => res.end() };
}

export function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

// routes: [{ method, path, op | null (public), handler(req, res, ctx) }]
export function serve({ name, cfg, verifier, routes, tls, port, logger = log(name), onRefused = () => {} }) {
  const guests = guestList(cfg, name);
  for (const r of routes) {
    if (r.op && !guests.has(r.op)) throw new Error(`${name}: route ${r.path} names op ${r.op}, which config/pipeline.json does not list`);
  }

  async function authorise(req, op) {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    if (!m) throw new SvidRefusal('no-badge', 'no SVID in Authorization: Bearer');
    const { caller, claims } = await verifier.verify(m[1]);
    if (!guests.get(op).has(caller)) throw new SvidRefusal('not-a-guest', `${caller} may not ${op} at ${name}`, claims);
    return { caller, claims };
  }

  const handler = (req, res) => {
    const given = String(req.headers['x-request-id'] ?? '');
    const id = /^[A-Za-z0-9-]{8,64}$/.test(given) ? given : randomUUID();
    res.setHeader('x-request-id', id);
    return requestContext.run({ id }, () => serveOne(req, res, id));
  };

  const serveOne = async (req, res, id) => {
    const url = new URL(req.url, 'https://x');
    const route = routes.find((r) => r.method === req.method && r.path === url.pathname);
    const t0 = Date.now();
    let caller = null;
    try {
      if (!route) throw new HttpError(routes.some((r) => r.path === url.pathname) ? 405 : 404, 'not_found', `${req.method} ${url.pathname}`);
      let ctx = { id, url };
      if (route.op) {
        const who = await authorise(req, route.op);
        caller = who.caller;
        ctx = { ...ctx, ...who };
      }
      await route.handler(req, res, ctx);
      logger('request', { id, op: route.op, caller, path: url.pathname, status: res.statusCode, ms: Date.now() - t0 });
    } catch (e) {
      const refusal = e instanceof SvidRefusal;
      const status = refusal ? REFUSAL_STATUS[e.code] ?? 401 : e instanceof HttpError ? e.status : 500;
      const code = refusal ? e.code : e instanceof HttpError ? e.code : 'internal';
      const message = status === 500 ? 'internal error' : e.message;
      logger(refusal ? 'refused' : 'error', { id, op: route?.op, path: url.pathname, status, code, message: e.message, sub: e.claims?.sub });
      if (!res.headersSent) json(res, status, { error: { code, message, request_id: id, ...(refusal && e.claims ? { claims: e.claims } : {}), ...(e.extra ?? {}) } });
      else res.end();
      if (refusal) onRefused({ code: e.code, message: e.message, op: route?.op, sub: e.claims?.sub ?? null, jti: e.claims?.jti ?? null });
    }
  };

  const srv = createServer({ key: readFileSync(tls.key), cert: readFileSync(tls.cert), minVersion: 'TLSv1.3' }, handler);
  srv.listen(port, '0.0.0.0', () => logger('listening', { port }));
  return srv;
}
