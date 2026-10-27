// Unit tests for portal/study-pace.js (S2, S3, S4). Run: node --test tests/study/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const P = createRequire(import.meta.url)("../../portal/study-pace.js");

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test("S2: time per paragraph is normalised to 100 words", () => {
  assert.equal(P.words("A battery is a small chemical factory, isn't it?"), 9);
  assert.equal(P.msPer100Words(20000, 50), 40000);
  assert.equal(P.msPer100Words(20000, 200), 10000);
  assert.equal(P.msPer100Words(20000, 4), null, "too short to time");
  assert.equal(P.msPer100Words(800, 50), null, "a skip, not a reading");
  assert.equal(P.msPer100Words(10 * 60000, 50), null, "walked away");
});

test("S2: the clock counts only active, visible time", () => {
  let t = 0;
  const c = new P.Clock(() => t);
  c.start(); t = 10000; assert.equal(c.elapsed(), 10000);
  c.stop(); t = 50000; assert.equal(c.elapsed(), 10000, "stopped while hidden");
  c.start(); t = 55000; c.poke(); t = 60000; c.stop(); assert.equal(c.elapsed(), 20000);
  // Idle for 5 minutes: only IDLE_MS of it counts, and timing resumes on the next activity.
  c.start(); t += 5 * 60000; assert.equal(c.elapsed(), 20000 + P.IDLE_MS);
  c.poke(); t += 3000; c.stop(); assert.equal(c.elapsed(), 20000 + P.IDLE_MS + 3000);
});

test("S3: the baseline is the median of the reader's own paragraphs and survives a new session", () => {
  const store = memoryStorage();
  const a = new P.Baseline(store);
  assert.deepEqual(a.stats(), { median: null, samples: 0 });
  a.record(0, 20000); a.record(1, 24000); a.record(2, 18000);
  assert.deepEqual(a.stats(), { median: 20000, samples: 3 });
  a.record(1, 30000); // a reread replaces the paragraph's value
  assert.deepEqual(a.stats(), { median: 20000, samples: 3 });
  assert.deepEqual(a.stats(1), { median: 19000, samples: 2 }, "never compared with itself");
  const b = new P.Baseline(store); // reload
  assert.deepEqual(b.stats(), { median: 20000, samples: 3 });
  b.record(0, 22000);
  assert.deepEqual(b.stats(), { median: 21000, samples: 4 });
  b.clear();
  assert.deepEqual(new P.Baseline(store).stats(), { median: null, samples: 0 });
});

test("S3: a blocked or broken store doesn't break reading", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} };
  const b = new P.Baseline(broken);
  b.record(0, 1000 * 20);
  assert.equal(b.stats().samples, 1);
  const junk = memoryStorage(); junk.setItem(P.KEY, "{not json");
  assert.equal(new P.Baseline(junk).stats().samples, 0);
});

test("S4: slow means at least SLOW_RATIO times the usual pace, once there is a baseline", () => {
  assert.equal(P.SLOW_RATIO, 1.5);
  assert.equal(P.isSlow(30000, 20000, 3), true);
  assert.equal(P.isSlow(29000, 20000, 3), false);
  assert.equal(P.isSlow(60000, 20000, 2), false, "no baseline yet");
  assert.equal(P.isSlow(null, 20000, 10), false);
  assert.equal(P.isSlow(25000, 20000, 3, 1.2), true, "threshold is tunable");
});

test("S1: pasted text splits into a title and paragraphs", () => {
  assert.deepEqual(P.parseText("Batteries\n\nOne two.\nthree.\n\n  Four.  "), { title: "Batteries", paragraphs: ["One two. three.", "Four."] });
  assert.deepEqual(P.parseText("First line.\nSecond line.\r\nThird line."), { title: null, paragraphs: ["First line.", "Second line.", "Third line."] });
  assert.deepEqual(P.parseText("Just one paragraph"), { title: null, paragraphs: ["Just one paragraph"] });
  assert.deepEqual(P.parseText("  \n "), { title: null, paragraphs: [] });
});
