// P9: embedding and answer speed against the probe Ollama.
const O = 'http://10.89.230.251:11434';
const chunk = 'File every travel expense within 30 days of the day you come back. '.repeat(15).slice(0, 1024);
const emb = [];
for (let i = 0; i < 6; i++) {
  const t = performance.now();
  const r = await (await fetch(`${O}/api/embed`, { method: 'POST', body: JSON.stringify({ model: 'nomic-embed-text:v1.5', input: chunk }) })).json();
  emb.push(performance.now() - t);
  if (i === 0) console.log('dims', r.embeddings[0].length);
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log('embed 1 KiB ms (first, then median of 5):', Math.round(emb[0]), Math.round(med(emb.slice(1))));
const passages = ['Lunch is from half past twelve.', chunk, 'Claims after 30 days need written approval.'].map((p, i) => `[${i + 1}] ${p}`).join('\n');
for (const run of [1, 2]) {
  const t0 = performance.now(); let first = 0, tokens = 0, evalNs = 0, evalCount = 0;
  const r = await fetch(`${O}/api/chat`, { method: 'POST', body: JSON.stringify({ model: 'qwen2.5:1.5b', stream: true, options: { num_predict: 256 }, messages: [{ role: 'system', content: 'Answer only from the passages. Cite them as [n].' }, { role: 'user', content: `${passages}\n\nQuestion: How many days do I have to file a travel expense?` }] }) });
  const dec = new TextDecoder(); let buf = '';
  for await (const part of r.body) {
    buf += dec.decode(part, { stream: true });
    let i; while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line) continue;
      const j = JSON.parse(line);
      if (j.message?.content) { tokens++; if (!first) first = performance.now() - t0; }
      if (j.done) { evalNs = j.eval_duration; evalCount = j.eval_count; }
    }
  }
  console.log(`answer run ${run}: first token ${(first / 1000).toFixed(1)} s, total ${((performance.now() - t0) / 1000).toFixed(1)} s, ${evalCount} tokens, ${(evalCount / (evalNs / 1e9)).toFixed(1)} tok/s`);
}
