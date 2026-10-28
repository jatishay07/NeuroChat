// The thinking behind study mode's flags, with no DOM, so tests/study/model.test.mjs can run it under
// Node:
// - expected pace: how long THIS paragraph should take this reader, from its words and sentences, so a
//   dense paragraph read slowly isn't flagged just for being dense;
// - the slow threshold tuning itself from what the reader does after a flag.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StudyModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // ---- what makes a paragraph slow to read ----
  const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
  const syllables = (w) => Math.max(1, (w.toLowerCase().replace(/e$/, "").match(/[aeiouy]+/g) || []).length);

  // Four numbers per paragraph, each 0 for ordinary English prose:
  // [mean word length − 4.7, share of 3+ syllable words − 0.12, (words per sentence − 20) / 20,
  //  digits and symbols per word].
  function features(text) {
    const t = String(text);
    const ws = t.match(WORD) || [];
    if (!ws.length) return [0, 0, 0, 0];
    const len = ws.reduce((s, w) => s + w.length, 0) / ws.length;
    const long = ws.filter((w) => /\p{L}/u.test(w) && syllables(w) >= 3).length / ws.length;
    const sentences = Math.max(1, (t.match(/[.!?。](\s|$)/g) || []).length);
    const sym = (t.match(/[0-9=+×÷^<>%°∑∫√≈±/\\_{}[\]|~]/g) || []).length / ws.length;
    return [len - 4.7, long - 0.12, (ws.length / sentences - 20) / 20, Math.min(sym, 2)].map((x) => Math.round(x * 1000) / 1000);
  }

  // How much each one slows reading, in log units, before there's enough of the reader's own history
  // to fit them (a word one letter longer than usual ≈ 18% slower, and so on).
  const W0 = [0.18, 1.2, 0.15, 0.8];
  const FIT_AFTER = 30;      // readings with features before the weights are fitted to the reader
  const RIDGE = 8;           // how strongly the fitted weights stay near W0

  const dot = (a, b) => a.reduce((s, x, i) => s + x * (b[i] || 0), 0);
  const median = (v) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // Solve A x = b for a small square system (Gaussian elimination with pivoting).
  function solve(A, b) {
    const n = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      if (Math.abs(M[c][c]) < 1e-12) return null;
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => r[n] / r[i]);
  }

  // samples: [{v (ms per 100 words), x? (features), h? (host)}]. Returns a model for predict().
  function fit(samples, host) {
    const all = samples.filter((s) => s && s.v > 0);
    if (!all.length) return null;
    const withX = all.filter((s) => Array.isArray(s.x) && s.x.length === 4);
    const xbar = withX.length ? [0, 1, 2, 3].map((i) => withX.reduce((s, q) => s + q.x[i], 0) / withX.length) : [0, 0, 0, 0];
    let w = W0, b = Math.log(median(all.map((s) => s.v)));
    if (withX.length >= FIT_AFTER) {
      // Ridge regression of log pace on centred features, pulled towards W0.
      const ys = withX.map((s) => Math.log(s.v)), ym = ys.reduce((a, c) => a + c, 0) / ys.length;
      const X = withX.map((s) => s.x.map((x, i) => x - xbar[i]));
      const A = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => X.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? RIDGE : 0)));
      const r = [0, 1, 2, 3].map((i) => X.reduce((s, row, k) => s + row[i] * (ys[k] - ym), 0) + RIDGE * W0[i]);
      const sol = solve(A, r);
      if (sol && sol.every(Number.isFinite)) { w = sol.map((x) => Math.max(-1, Math.min(3, x))); b = ym; }
    }
    // A site the reader always reads slower (papers) or faster (news) gets its own offset, shrunk
    // towards none until there are a few readings from it.
    let offset = 0;
    const mine = host ? withX.filter((s) => s.h === host) : [];
    if (mine.length >= 3) {
      const res = median(mine.map((s) => Math.log(s.v) - b - dot(w, s.x.map((x, i) => x - xbar[i]))));
      offset = res * mine.length / (mine.length + 5);
    }
    return { b, w, xbar, offset, fitted: w !== W0, n: all.length };
  }

  // Expected ms per 100 words for a paragraph with features x.
  function predict(model, x) {
    if (!model) return null;
    return Math.round(Math.exp(model.b + model.offset + dot(model.w, (x || model.xbar).map((v, i) => v - model.xbar[i]))));
  }

  // ---- the threshold tunes itself (a staircase aiming at about 1 false flag in 10) ----
  const RATIO = { start: 1.5, min: 1.3, max: 2.0, step: 0.05, target: 0.1 };
  // event: "false" (flagged, in view a while, then left without going back), "hit" (a flag the reader
  // went back to, or had explained), "miss" (gone back to twice without ever being flagged).
  function tune(ratio, event) {
    const r = Number.isFinite(ratio) ? ratio : RATIO.start;
    const d = { false: RATIO.step, hit: -RATIO.step * RATIO.target / (1 - RATIO.target), miss: -RATIO.step }[event] || 0;
    return Math.round(Math.min(RATIO.max, Math.max(RATIO.min, r + d)) * 10000) / 10000;
  }

  return { W0, FIT_AFTER, RATIO, features, fit, predict, tune };
});
