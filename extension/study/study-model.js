// The thinking behind study mode's extra features, with no DOM, so tests/study/model.test.mjs can run
// it under Node:
// - expected pace: how long THIS paragraph should take this reader, from its words and sentences, so a
//   dense paragraph read slowly isn't flagged just for being dense;
// - the slow threshold tuning itself from what the reader does with the flags;
// - fatigue drift across a session; key terms on a page; when to ask a review question again; CSV.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StudyModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // ---- what makes a paragraph slow to read ----
  // Short everyday words; anything else of 7+ letters counts as a rare word. Written by hand, so no
  // word list with its own licence comes along.
  const COMMON = new Set(`a about above after again against all almost also always am among an and another any are
    around as at away back be became because become been before being below between both but by came can
    cannot could day did different do does doing done down during each even ever every few first for from
    get give go going good got great had has have having he her here hers him his how however i if in into
    is it its just know large last least less let like little long made make many may me might more most
    much must my never new next no not now number of off often old on once one only or other our out over
    own part people place put rather really right said same say see seem several she should show since
    small so some something still such take than that the their them then there these they thing think
    this those though three through time to together too two under until up upon us use used very want
    was way we well were what when where whether which while who whole why will with within without word
    work world would year yet you your already although anything around because before believe between
    business change children company country course during example family general government group
    however important interest something sometimes someone together another everything nothing problem
    question remember service several something student system through without yourself whatever whenever
    wherever usually actually probably possible different following including national personal political
    available especially particular community possible understand everyone anybody`.split(/\s+/));

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
  // event: "false" (flagged, then left quickly with no Explain and no reread), "hit" (a flag the reader
  // acted on), "miss" (Explain or "Still lost" on a paragraph that wasn't flagged).
  function tune(ratio, event) {
    const r = Number.isFinite(ratio) ? ratio : RATIO.start;
    const d = { false: RATIO.step, hit: -RATIO.step * RATIO.target / (1 - RATIO.target), miss: -RATIO.step }[event] || 0;
    return Math.round(Math.min(RATIO.max, Math.max(RATIO.min, r + d)) * 10000) / 10000;
  }

  // ---- fatigue: getting slower than at the start of the session, against what the text predicts ----
  const FATIGUE = { minActiveMs: 20 * 60000, window: 8, drift: 1.3, blinks: 1.5 };
  // ratios: actual / expected for each paragraph read this session, in order. blinks (from a headset,
  // optional): {early, late} blinks per minute. Returns {drift, why} or null.
  function fatigue(ratios, activeMs, blinks) {
    if (!(activeMs >= FATIGUE.minActiveMs)) return null;
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    const r = ratios.filter((x) => Number.isFinite(x) && x > 0);
    if (r.length >= 2 * FATIGUE.window) {
      const drift = mean(r.slice(-FATIGUE.window)) / mean(r.slice(0, FATIGUE.window));
      if (drift >= FATIGUE.drift) return { drift: Math.round(drift * 100) / 100, why: "pace" };
    }
    if (blinks && blinks.early > 0 && blinks.late / blinks.early >= FATIGUE.blinks) return { drift: Math.round(blinks.late / blinks.early * 100) / 100, why: "blinks" };
    return null;
  }

  // ---- key terms: rare words the page leans on ----
  function keyTerms(texts, n = 3) {
    const count = new Map(), shown = new Map();
    for (const t of texts) for (const w of String(t).match(WORD) || []) {
      const k = w.toLowerCase().replace(/['’]s$/, "");
      // Key terms are nearly always nouns: -ed, -ing and -ly words are left out.
      if (k.length < 7 || COMMON.has(k) || /\d/.test(k) || /(ed|ing|ly)$/.test(k)) continue;
      count.set(k, (count.get(k) || 0) + 1);
      if (!shown.has(k)) shown.set(k, w.replace(/['’]s$/, ""));
    }
    return [...count].filter(([, c]) => c >= 2)
      .map(([k, c]) => [k, c * Math.log(k.length) * (1 + syllables(k) / 4)])
      .sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => shown.get(k));
  }

  // ---- review questions come back after 1, 3, then 7 days ----
  const DAYS = [1, 3, 7];
  const DAY = 86400000;
  // grade: "right" moves to the next gap (and finishes after the last), "partly" repeats the gap,
  // "wrong" starts over.
  function schedule(item, grade, now = Date.now()) {
    let step = item.step || 0;
    if (grade === "right") step++;
    else if (grade === "wrong") step = 0;
    if (step >= DAYS.length) return { ...item, step, due: null, last: grade };
    return { ...item, step, due: now + DAYS[step] * DAY, last: grade };
  }
  const parseGrade = (text) => { const m = /^[\s*_#>"“]*(right|partly|wrong)\b/i.exec(String(text)); return m ? m[1].toLowerCase() : null; };

  // ---- the session as a CSV, one row per paragraph ----
  function toCSV(rows) {
    if (!rows.length) return "";
    const cols = Object.keys(rows[0]);
    const cell = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
  }

  return { COMMON, W0, FIT_AFTER, RATIO, FATIGUE, DAYS, features, fit, predict, tune, fatigue, keyTerms, schedule, parseGrade, toCSV };
});
