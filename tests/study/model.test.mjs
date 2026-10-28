// Unit tests for extension/study/study-model.js. Run: node --test tests/study/model.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const M = createRequire(import.meta.url)("../../extension/study/study-model.js");

const PLAIN = "When you plug your phone in, the charger pushes the electrons back the other way. The ions go back to the graphite side and wait there.";
const DENSE = "The electrochemical potential difference between electrodes arises from the disparity in Gibbs free energy of lithium in each host lattice; intercalation into graphite is thermodynamically favoured only when an external overpotential exceeds the open-circuit voltage.";

test("expected pace: a dense paragraph is predicted slower than a plain one", () => {
  const model = M.fit(Array.from({ length: 10 }, (_, i) => ({ v: 20000 + i * 100 })));
  const plain = M.predict(model, M.features(PLAIN)), dense = M.predict(model, M.features(DENSE));
  assert.ok(dense > 1.5 * plain, `${dense} vs ${plain}`);
  // A paragraph like the reader's usual ones is predicted at their usual pace.
  assert.equal(M.predict(model, null), 20450);
});

test("expected pace: after 30 readings the weights fit the reader", () => {
  // A reader for whom long sentences don't matter but long words matter a lot.
  const samples = Array.from({ length: 60 }, (_, i) => {
    const x = [((i * 7) % 11) / 5 - 1, ((i * 3) % 7) / 20, ((i * 5) % 9) / 4 - 1, 0];
    return { v: Math.round(20000 * Math.exp(0.6 * x[0])), x };
  });
  const model = M.fit(samples);
  assert.ok(model.fitted);
  assert.ok(model.w[0] > 0.4, `word length weight ${model.w[0]}`);
  assert.ok(Math.abs(model.w[2]) < 0.1, `sentence weight ${model.w[2]}`);
  assert.ok(!M.fit(samples.slice(0, 29)).fitted, "not before 30");
});

test("expected pace: a site the reader always reads slowly gets its own offset", () => {
  const x = [0, 0, 0, 0];
  const samples = [...Array.from({ length: 10 }, () => ({ v: 20000, x, h: "news.example" })), ...Array.from({ length: 10 }, () => ({ v: 40000, x, h: "papers.example" }))];
  const papers = M.predict(M.fit(samples, "papers.example"), x), news = M.predict(M.fit(samples, "news.example"), x);
  assert.ok(papers > 1.4 * news, `${papers} vs ${news}`);
});

test("the slow threshold tunes itself and stays in bounds", () => {
  let r = M.RATIO.start;
  for (let i = 0; i < 20; i++) r = M.tune(r, "false");
  assert.equal(r, M.RATIO.max, "20 false flags push it to the ceiling, not past it");
  for (let i = 0; i < 40; i++) r = M.tune(r, "miss");
  assert.equal(r, M.RATIO.min);
  // At 1 false flag in 10, it holds still.
  r = 1.5;
  for (let i = 0; i < 10; i++) for (let k = 0; k < 10; k++) r = M.tune(r, k === 0 ? "false" : "hit");
  assert.ok(Math.abs(r - 1.5) < 0.01, String(r));
  assert.equal(M.tune(undefined, "nothing"), 1.5);
});

test("fatigue: pace drifting slower against the prediction, after 20 minutes", () => {
  const steady = Array(16).fill(1.0);
  const tiring = [...Array(8).fill(1.0), ...Array(8).fill(1.4)];
  assert.equal(M.fatigue(tiring, 10 * 60000), null, "too early in the session");
  assert.equal(M.fatigue(steady, 30 * 60000), null);
  assert.deepEqual(M.fatigue(tiring, 30 * 60000), { drift: 1.4, why: "pace" });
  // A harder second half read at the same ratio to its prediction is not tiredness.
  assert.equal(M.fatigue([...Array(8).fill(1.1), ...Array(8).fill(1.1)], 30 * 60000), null);
  // The headset's blink rate counts too.
  assert.deepEqual(M.fatigue(steady, 30 * 60000, { early: 10, late: 18 }), { drift: 1.8, why: "blinks" });
});

test("key terms: rare words the page uses more than once", () => {
  const texts = ["Entropy measures disorder. Entropy always rises in a closed system.", "The thermodynamic arrow of time follows entropy; a thermodynamic process can't run backwards.", "Something important happened yesterday and something else happened."];
  assert.deepEqual(M.keyTerms(texts), ["thermodynamic", "entropy"]);
  // Names (never written in lower case) aren't terms; plurals count with the singular.
  assert.deepEqual(M.keyTerms(["Gibbs found it. Gibbs said so. An electrode here.", "Two electrodes there."]), ["electrode"]);
});

test("review questions come back after 1, 3 and 7 days", () => {
  const now = 1_000_000;
  const day = 86400000;
  let it = M.schedule({ key: "a" }, "right", now);
  assert.equal(it.step, 1); assert.equal(it.due, now + day);
  it = M.schedule(it, "right", now); assert.equal(it.due, now + 3 * day);
  it = M.schedule(it, "partly", now); assert.equal(it.due, now + 3 * day, "partly: the same gap again");
  it = M.schedule(it, "right", now); assert.equal(it.due, now + 7 * day);
  it = M.schedule(it, "wrong", now); assert.equal(it.step, 0); assert.equal(it.due, now + day);
  it = M.schedule(M.schedule(M.schedule(M.schedule(it, "right", now), "right", now), "right", now), "right", now);
  assert.equal(it.due, null, "learned");
  assert.equal(M.parseGrade("**Right** — that's it."), "right");
  assert.equal(M.parseGrade("**Grade:** Correct. You got it."), "right");
  assert.equal(M.parseGrade("Partially: you have the first half"), "partly");
  assert.equal(M.parseGrade("Incorrect. The charger must push harder."), "wrong");
  assert.equal(M.parseGrade("Hmm, let me think about this one carefully first."), "partly", "unreadable counts as partly");
  assert.deepEqual(M.parseDefs("1. **Graphite**: carbon in sheets.\n- lithium: a light metal\nNot a term: no", ["graphite", "lithium"]),
    { graphite: "carbon in sheets.", lithium: "a light metal" });
});

test("a rewrite comes back bare even when the model wraps it", () => {
  assert.equal(M.bare("Here's a simpler version:\n\nCharging pushes ions into the graphite. Does that help?"), "Charging pushes ions into the graphite.");
  assert.equal(M.bare('"Charging pushes ions into the graphite."'), "Charging pushes ions into the graphite.");
  assert.equal(M.bare("Why does it charge? Because the charger pushes harder."), "Why does it charge? Because the charger pushes harder.");
});

test("the session exports as CSV", () => {
  const csv = M.toCSV([{ index: 1, text: 'He said "hi", then left', ratio: 1.2 }, { index: 2, text: "ok", ratio: null }]);
  assert.equal(csv, 'index,text,ratio\n1,"He said ""hi"", then left",1.2\n2,ok,\n');
  assert.equal(M.toCSV([{ text: "=HYPERLINK(1)", n: -3 }]), "text,n\n'=HYPERLINK(1),-3\n", "no formulas from page text; numbers stay numbers");
});
