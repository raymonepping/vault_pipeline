// pipeline/lib/exclusive.js: one thing at a time per key (D14). The console
// runs one act at a time (two operators pressing at once would race a key's
// minimum version) and one question per person (the CPU model answers one at
// a time). The slot is freed when the work ends, not when the browser
// leaves: a reload must not let a second act start beside the first.
export class Busy extends Error {
  constructor(message) {
    super(message);
    this.status = 409;
    this.code = 'busy';
  }
}

export function exclusive() {
  const held = new Map(); // key -> what holds it
  return {
    async run(key, label, work) {
      if (held.has(key)) throw new Busy(`${held.get(key)} is running; one at a time`);
      held.set(key, label);
      try {
        return await work();
      } finally {
        held.delete(key);
      }
    },
    holding: (key) => held.has(key),
  };
}
