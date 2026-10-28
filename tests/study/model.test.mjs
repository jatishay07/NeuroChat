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
