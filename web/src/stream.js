// stream.js: POST to the console and read its NDJSON answer event by event
// (an ingest, a question, Act IV). Errors keep the console's own words.
export async function postStream(path, body, onEvent, { signal } = {}) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}), signal });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    onEvent({ event: 'error', status: r.status, message: j.error?.message ?? `HTTP ${r.status}` });
    return;
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}
