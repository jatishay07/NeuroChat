// Study mode on any page: the paragraph you're reading stays lit and the rest dim, so the time it
// spends at the reading line is the time you spent reading it. That time, per 100 words, is
// compared with what this paragraph should take you (study-model.js: your own pace, adjusted for how
// dense the text is). A paragraph much slower than that gets a quiet amber edge, and Explain sends it
// to the side chat. Turn it on with "Study this page" (right-click) or Alt+Shift+S; Esc or Exit turns
// it off. Each extra feature has its own switch (study/options.html); FEATURES lists them.
(() => {
  const P = self.StudyPace, M = self.StudyModel;
  const LINE = 0.38;      // the reading line, as a share of the window's height from the top
  const PREFIX = "neurochat.study.s:"; // one key per paragraph read ({v, t, x, h}), so tabs never overwrite each other
  const LABELS = "neurochat.study.l:"; // Got it / Still lost, from the side chat
  const FLAGS_KEY = "neurochat.study.features", RATIO_KEY = "neurochat.study.ratio";
  const KEEP = 200;
  const REREAD_MS = 2000;  // back on a paragraph you'd left for this long = a reread, not an overshoot
  const IGNORED_MS = 10000; // flagged, seen this long, then left with no Explain and no reread = a flag they didn't need

  // Every feature, on unless switched off (the headset simulator is for developers, so it's off).
  const FEATURES = { expected: true, rereads: true, signals: true, simulator: false, explainKey: true, selection: true,
    lookback: true, labels: true, tune: true, plainer: true, checkback: true, review: true, export: true, fatigue: true, terms: true };
  let flags = { ...FEATURES };
  const has = (f) => !!flags[f];

  let on = false, paras = [], at = -1, raf = 0, ticker = 0, ticks = 0, watcher = null, recollect = 0;
  let ratio = M.RATIO.start, session = null;
  const samples = new Map(); // paragraph key -> {v, t, x, h}
  const labels = new Map();  // paragraph key -> "got" | "lost"
  const state = new WeakMap(); // element -> its clock, visits, slow, frozen pace (survives re-collecting)

  // ---- the baseline: one reading per paragraph (keyed by page and text), shared by every tab ----
  const ok = (s) => s && s.v > 0;
  async function load() {
    samples.clear();
    const all = await chrome.storage.local.get(null);
    for (const [k, s] of Object.entries(all)) {
      if (k.startsWith(PREFIX) && ok(s)) samples.set(k.slice(PREFIX.length), s);
      if (k.startsWith(LABELS) && s) labels.set(k.slice(LABELS.length), s.label);
    }
    flags = { ...FEATURES, ...(all[FLAGS_KEY] || {}) };
    if (Number.isFinite(all[RATIO_KEY])) ratio = all[RATIO_KEY];
  }
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "local") return;
    for (const [k, { newValue }] of Object.entries(c)) {
      if (k === FLAGS_KEY) { flags = { ...FEATURES, ...(newValue || {}) }; if (on) switched(); }
      else if (k === RATIO_KEY && Number.isFinite(newValue)) ratio = newValue;
      else if (k.startsWith(LABELS)) labels.set(k.slice(LABELS.length), newValue?.label);
      else if (k.startsWith(PREFIX)) {
        if (ok(newValue)) samples.set(k.slice(PREFIX.length), newValue); else samples.delete(k.slice(PREFIX.length));
        refit();
      }
    }
  });
  function keyOf(text) {
    let h = 5381;
    for (const ch of location.origin + location.pathname + "\n" + text) h = (h * 33 + ch.codePointAt(0)) >>> 0;
    return h.toString(36);
  }
  // Fitted without the paragraph itself, like stats(): a paragraph is never compared with itself.
  let fits = new Map();
  function refit() { fits = new Map(); }
  function modelFor(p) {
    if (!fits.has(p.key)) fits.set(p.key, M.fit([...samples].filter(([k]) => k !== p.key).map(([, s]) => s), location.hostname));
    return fits.get(p.key);
  }
  async function record(p) {
    const v = value(p);
    if (!v) return;
    const s = { v, t: Date.now(), x: p.x, h: location.hostname };
    samples.set(p.key, s);
    chrome.storage.local.set({ [PREFIX + p.key]: s }).catch(() => {});
    if (samples.size > KEEP) { // the oldest readings go first
      const old = [...samples].sort((a, b) => a[1].t - b[1].t).slice(0, samples.size - KEEP).map(([k]) => k);
      old.forEach((k) => samples.delete(k));
      chrome.storage.local.remove(old.map((k) => PREFIX + k)).catch(() => {});
    }
  }
  // The usual pace without this paragraph, so it's never compared with itself.
  function stats(p) {
    const v = [...samples].filter(([k]) => k !== p.key).map(([, s]) => s.v);
    return { median: P.median(v), samples: v.length };
  }
  // What this paragraph should take this reader: their usual pace, adjusted for how dense it is.
  function expected(p) {
    const { median, samples: n } = stats(p);
    if (!median || n < P.MIN_SAMPLES) return null;
    const model = has("expected") && modelFor(p);
    return model ? M.predict(model, p.x) : median;
  }
  const threshold = () => (has("tune") ? ratio : M.RATIO.start);
  function slowness(p) { const e = expected(p), v = value(p); return e && v ? v / e : null; }
  function tune(event) {
    if (!has("tune")) return;
    ratio = M.tune(ratio, event);
    chrome.storage.local.set({ [RATIO_KEY]: ratio }).catch(() => {});
  }

  // ---- what counts as a paragraph on a real page ----
  const SKIP = "nav, header, footer, aside, form, button, table, sup, [role=navigation], [role=banner], [role=contentinfo], " +
    "[aria-hidden=true], .references, .reflist, .mw-references-wrap, .infobox, .navbox, neurochat-pill, neurochat-study";
  const BLOCK = "p, li, blockquote, dd, figcaption";
  const textOf = (el) => el.innerText.replace(/\s+/g, " ").trim();
  function contentRoot() {
    // The candidate with the most paragraph text: a promo card that is an <article> doesn't win.
    const cands = [...document.querySelectorAll("article, main, [role=main]")];
    let best = document.body, most = 0;
    for (const c of cands) {
      const n = [...c.querySelectorAll("p")].reduce((s, p) => s + p.textContent.length, 0);
      if (n > most) { most = n; best = c; }
    }
    return best;
  }
  function collect() {
    const root = contentRoot();
    const heads = [...root.querySelectorAll("h1, h2, h3, h4, h5, h6")];
    return [...root.querySelectorAll(BLOCK)]
      .filter((el) => !el.closest(SKIP) && !el.parentElement.closest(BLOCK))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map((el) => {
        let p = state.get(el);
        if (!p) state.set(el, p = { el, clock: new P.Clock(), visits: 0, rereads: 0, slow: false });
        // A paragraph shown in plain words keeps what it was; text that updates live ("updated 5 s
        // ago") keeps its clock, and only what it says changes.
        if (!p.plain) {
          const text = textOf(el);
          if (p.text !== text) Object.assign(p, { text, key: keyOf(text), words: P.words(text), x: M.features(text) });
        }
        // The section it's in: the number of headings before it.
        p.section = heads.filter((h) => h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).length;
        return p;
      })
      .filter((p) => p.words >= P.MIN_WORDS);
  }

  // The paragraph at the reading line (or the nearest one to it).
  function current() {
    const y = innerHeight * LINE;
    let best = -1, gap = Infinity;
    paras.forEach((p, i) => {
      const r = p.el.getBoundingClientRect();
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < gap) { gap = d; best = i; }
    });
    return gap < innerHeight * 0.3 ? best : -1;
  }

  const value = (p) => p.frozen !== undefined ? p.frozen : P.msPer100Words(p.clock.elapsed(), p.words);

  let rereadTimer = 0;
  function leave(judge = false) {
    const p = paras[at];
    at = -1;
    clearTimeout(rereadTimer);
    underline(null);
    if (!p) return;
    p.clock.stop();
    p.last = Date.now();
    // Flagged, the flag in view for a while, and left with nothing done about it: not needed. (Leaving
    // just after the flag says nothing: it appears as a slow reader is finishing anyway.)
    if (judge && p.slow && !p.acted && !p.judged && p.last - p.slowAt >= IGNORED_MS) { p.judged = true; tune("false"); }
    record(p);
    p.el.classList.remove("neurochat-current");
    p.el.classList.add("neurochat-dim");
  }

  function focus(i) {
    if (i === at) return;
    const from = at;
    leave(i >= 0);
    if (i < 0) { draw(); return; }
    at = i;
    const p = paras[i];
    p.visits++;
    p.first ??= Date.now();
    p.el.classList.remove("neurochat-dim");
    p.el.classList.add("neurochat-current");
    if (!document.hidden && !p.plain) p.clock.start();
    // Back on a paragraph you'd already left, and staying there: a reread.
    if (has("rereads") && p.last && from > i) rereadTimer = setTimeout(() => { if (paras[at] === p) signal({ kind: "reread", source: "scroll", para: i }); }, REREAD_MS);
    if (from >= 0 && from < i) offerCheck(i, paras[from]);
    mark();
  }

  function mark() {
    const p = paras[at];
    if (p && !p.slow) {
      const r = slowness(p);
      if (r && r >= threshold()) { p.slow = true; p.slowAt = Date.now(); if (p.rereads) p.acted = true; terms(p); }
    }
    paras.forEach((q) => { q.el.classList.toggle("neurochat-slow", q.slow); q.el.classList.toggle("neurochat-stuck", q.slow && q.rereads > 0); });
    draw();
  }

  // ---- signals: one way in for every sign of trouble, from the page now and from a headset later ----
  // {kind: "reread" | "clench" | "blink" | "engagement", t, source: "scroll" | "key" | "sim" | "muse",
  //  para?: index, line?: line in the paragraph, value?}. See .graph/CONTRACTS.md.
  function signal(s) {
    if (!on || !s || typeof s.kind !== "string") return;
    s = { t: Date.now(), source: "page", ...s };
    if (s.source !== "scroll" && !has("signals")) return;
    session.signals.push(s);
    if (session.signals.length > 2000) session.signals.shift();
    const i = Number.isInteger(s.para) ? s.para : at;
    const p = paras[i];
    if (s.kind === "reread" && p) {
      p.rereads++;
      if (p.slow && !p.acted) { p.acted = true; tune("hit"); }
      // The headset says which line; underline it only if the paragraph is slow too (never a popup).
      if (Number.isInteger(s.line) && p.slow && i === at) underline(s.line);
      mark();
    } else if (s.kind === "clench" && has("signals") && p) explain(p, "clench");
    else if (s.kind === "blink") session.blinks.push(s.t);
  }
  // Developers (and tests) can send signals from the page only while the simulator is switched on,
  // so an ordinary page can't press Explain for you.
  addEventListener("neurochat:signal", (e) => {
    if (!has("simulator")) return;
    let d = e.detail;
    try { if (typeof d === "string") d = JSON.parse(d); } catch { return; }
    signal({ ...d, source: "sim" });
  });

  // One line of the lit paragraph, underlined.
  function lines(el) {
    const r = document.createRange();
    r.selectNodeContents(el);
    const out = [];
    for (const b of r.getClientRects()) {
      if (b.width < 2) continue;
      const last = out[out.length - 1];
      if (last && Math.abs(last.bottom - b.bottom) < 4) { last.left = Math.min(last.left, b.left); last.right = Math.max(last.right, b.right); }
      else out.push({ left: b.left, right: b.right, bottom: b.bottom });
    }
    return out;
  }
  let lineAt = null;
  function underline(n) {
    lineAt = n;
    const u = $("line");
    const p = paras[at];
    const l = p && n !== null ? lines(p.el)[n] : null;
    u.hidden = !l;
    if (l) Object.assign(u.style, { left: `${scrollX + l.left}px`, top: `${scrollY + l.bottom}px`, width: `${l.right - l.left}px` });
  }

  // ---- the Explain pill next to the lit paragraph, the dock, and the review card ----
  const host = document.createElement("neurochat-study");
  const root = host.attachShadow({ mode: "closed" });
  const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", system-ui, sans-serif`;
  root.innerHTML = `<style>
    :host { all: initial; }
    button { all: initial; box-sizing: border-box; cursor: pointer; font: 500 13px/1.2 ${FONT}; display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; white-space: nowrap; }
    button:focus-visible { outline: 2px solid #0b0d12; outline-offset: 2px; }
    .pills { position: absolute; z-index: 2147483646; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
    .pill { padding: 6px 12px; color: #0b0d12; background: rgba(255, 255, 255, .92);
      border: 1px solid rgba(11, 13, 18, .12); box-shadow: 0 6px 20px rgba(20, 30, 60, .14); transition: background .2s, color .2s; }
    .pill:hover { background: #fff; }
    .pill.slow { color: #fff; background: #0b0d12; border-color: #0b0d12; }
    .pill.slow::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #e58a00; }
    .pill.quiet { font-size: 12px; padding: 5px 10px; color: #4b5260; }
    [hidden] { display: none !important; }
    .line { position: absolute; z-index: 2147483645; height: 2px; margin-top: 1px; border-radius: 2px; background: rgba(229, 138, 0, .8); pointer-events: none; }
    .glass { position: fixed; z-index: 2147483646; left: 50%; bottom: 20px; transform: translateX(-50%); border-radius: 999px; font: 500 13px/1.2 ${FONT}; color: #4b5260;
      max-width: calc(100vw - 24px); box-sizing: border-box;
      background: linear-gradient(180deg, rgba(255, 255, 255, .86), rgba(255, 255, 255, .66)); border: 1px solid rgba(255, 255, 255, .9);
      -webkit-backdrop-filter: blur(30px) saturate(180%); backdrop-filter: blur(30px) saturate(180%);
      box-shadow: inset 0 1px 0 #fff, 0 16px 50px rgba(20, 30, 60, .16); }
    .dock { display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 16px; white-space: nowrap; }
    .dock i { flex: none; width: 7px; height: 7px; border-radius: 50%; background: #1f9d63; box-shadow: 0 0 0 3px rgba(31, 157, 99, .18); }
    .dock.slow i { background: #e58a00; box-shadow: 0 0 0 3px rgba(229, 138, 0, .2); }
    .dock b, .card b { font-weight: 500; color: #0b0d12; }
    .dock .count { font: 500 12px ui-monospace, "SF Mono", Menlo, monospace; }
    .dock #cue { overflow: hidden; text-overflow: ellipsis; }
    .glass button { padding: 7px 12px; color: #0b0d12; }
    .glass button:hover { background: rgba(11, 13, 18, .06); }
    .glass button.offer { background: rgba(11, 13, 18, .06); }
    .card { border-radius: 22px; padding: 16px 18px 12px; width: min(440px, calc(100vw - 24px)); }
    .card p { margin: 0 0 10px; line-height: 1.45; }
    .ticks { display: flex; gap: 3px; align-items: flex-end; height: 26px; margin: 4px 0 12px; }
    .ticks button { flex: 1; min-width: 4px; height: 100%; padding: 0; border-radius: 3px; background: #d9dce3; }
    .ticks button.mid { background: #f2c27a; } .ticks button.hard { background: #e58a00; }
    .ticks button:hover { outline: 2px solid #0b0d12; }
    .row { display: flex; justify-content: flex-end; gap: 4px; }
    .sim { position: fixed; z-index: 2147483646; right: 16px; bottom: 80px; display: flex; flex-direction: column; gap: 4px; padding: 10px; border-radius: 16px; }
    .sim span { font: 600 11px ${FONT}; color: #8a8f99; text-transform: uppercase; letter-spacing: .04em; padding: 0 4px 2px; }
    @media (max-width: 480px) { .dock #cue { display: none; } }
  </style>
  <div class="pills" id="pills" hidden><button type="button" class="pill" id="pill" title="Explain (E)">Explain</button><button type="button" class="pill quiet" id="alt" title="Plainer (P)" hidden>Plainer</button></div>
  <div class="line" id="line" hidden></div>
  <div class="glass dock" id="dock" role="status" hidden><i></i><b>Study mode</b><span class="count" id="count"></span><span id="cue"></span><button type="button" class="offer" id="offer" hidden></button><button type="button" id="close" aria-label="Dismiss" hidden>✕</button><button type="button" id="exit" aria-label="Turn off study mode">Exit</button></div>
  <div class="glass card" id="card" role="status" aria-label="Study session" hidden><p id="sum"></p><div class="ticks" id="ticks"></div><div class="row"><button type="button" id="csv" title="Every paragraph's timing, for research">Download data (CSV)</button><button type="button" id="done">Close</button></div></div>
  <div class="glass sim" id="sim" hidden><span>Headset simulator</span><button type="button" data-k="reread">Reread line 2</button><button type="button" data-k="clench">Jaw clench</button><button type="button" data-k="blink">Blink</button></div>`;
  const $ = (id) => root.getElementById(id);

  function draw() {
    const p = paras[at];
    $("dock").hidden = !on;
    $("pills").hidden = !on || !p;
    $("count").textContent = on ? `${at < 0 ? "–" : at + 1} / ${paras.length}` : "";
    if (!notice) $("cue").textContent = p?.slow ? (p.rereads ? "Slow, and you went back to it" : "Slower than usual for you") : "";
    $("dock").classList.toggle("slow", !!p?.slow);
    if (!p) return;
    const sel = has("selection") && selectionIn(p);
    $("pill").textContent = sel ? "Explain selection" : "Explain";
    $("pill").classList.toggle("slow", p.slow);
    $("pill").setAttribute("aria-label", sel ? "Explain the selected text with NeuroChat" : `Explain paragraph ${at + 1} with NeuroChat`);
    $("alt").hidden = !has("plainer") || !(p.plainText || p.slow || p.writing);
    $("alt").textContent = p.plain ? "Original" : "Plainer";
    const r = p.el.getBoundingClientRect();
    const w = $("pills").offsetWidth || 80, h = $("pill").offsetHeight || 30;
    // Beside the paragraph's top-right corner; above it when the paragraph runs to the window's edge.
    const beside = r.right + 12 + w <= innerWidth - 8;
    const left = beside ? r.right + 12 : Math.min(r.right, innerWidth - 8) - w;
    const top = beside ? Math.max(r.top, 8) : Math.max(r.top - h - 6, 8);
    $("pills").style.left = `${scrollX + Math.max(8, left)}px`;
    $("pills").style.top = `${scrollY + top}px`;
    if (lineAt !== null) underline(lineAt);
  }

  let note = 0;
  function say(text) { // a short note in the dock, e.g. when there's nothing to study
    clearTimeout(note);
    document.documentElement.append(host);
    $("dock").hidden = false;
    $("count").textContent = "";
    $("cue").textContent = text;
    note = setTimeout(() => { if (!on) host.remove(); }, 3000);
  }
  // A line in the dock that stays until dismissed (fatigue), with an optional offer button (check-back).
  let notice = null;
  function tell(text, offer, kind) {
    notice = { text, offer, kind };
    $("cue").textContent = text;
    $("offer").hidden = !offer;
    if (offer) $("offer").textContent = offer.label;
    $("close").hidden = false;
  }
  function untell() { notice = null; $("offer").hidden = $("close").hidden = true; draw(); }
  $("close").addEventListener("click", untell);
  $("offer").addEventListener("click", () => { const o = notice?.offer; untell(); o?.run(); });

  function selectionIn(p) {
    const s = getSelection();
    if (!s || s.isCollapsed || !p.el.contains(s.anchorNode) || !p.el.contains(s.focusNode)) return "";
    const t = s.toString().replace(/\s+/g, " ").trim();
    return t.length >= 2 ? t.slice(0, 2000) : "";
  }

  // Up to 2 paragraphs earlier in the same section that already slowed the reader down: confusion
  // often starts a paragraph or two before the one that finally stops you.
  function earlier(p) {
    const i = paras.indexOf(p);
    return paras.slice(0, i).map((q, k) => ({ q, k, r: slowness(q) || 0 }))
      .filter(({ q, r }) => q.section === p.section && value(q) && (r >= 1.2 || q.rereads > 0))
      .sort((a, b) => b.r - a.r).slice(0, 2).sort((a, b) => a.k - b.k)
      .map(({ q, k }) => ({ index: k + 1, text: q.text.slice(0, 600) }));
  }

  function explain(p, trigger = "pill") {
    // Pace stops at Explain: reading the answer isn't reading the paragraph.
    if (p.frozen === undefined) { p.frozen = value(p); p.clock.stop(); }
    if (p.slow && !p.acted) tune("hit"); else if (!p.slow && !p.explained) tune("miss");
    p.acted = p.explained = true;
    const sel = has("selection") && selectionIn(p);
    const e = expected(p);
    const request = { text: (sel || p.text).slice(0, 4000), title: document.title, url: location.href, key: p.key, index: paras.indexOf(p) + 1, flagged: p.slow, trigger };
    if (sel) request.context = p.text.slice(0, 4000);
    if (p.frozen) request.dwellMsPer100Words = p.frozen;
    // The tutor compares the two as "N× their usual pace": usual for this text, when expected pace is on.
    if (e) request.medianMsPer100Words = e;
    const rereads = has("rereads") ? p.rereads : p.visits - 1;
    if (rereads > 0) request.rereads = rereads;
    if (has("lookback")) { const before = earlier(p); if (before.length) request.earlier = before; }
    chrome.runtime.sendMessage({ type: "neurochat:explain", request }).catch(() => {});
    draw();
  }
  $("pill").addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
  $("pill").addEventListener("click", () => { const p = paras[at]; if (p) explain(p); });
  $("alt").addEventListener("click", () => { const p = paras[at]; if (p) plainer(p); });
  $("exit").addEventListener("click", () => stop());
  root.getElementById("sim").addEventListener("click", (e) => {
    const k = e.target.closest("button")?.dataset.k;
    if (k) signal({ kind: k, source: "sim", ...(k === "reread" ? { line: 1 } : {}) });
  });
  function sim() { $("sim").hidden = !on || !has("simulator"); }

  // ---- plainer: the lit paragraph rewritten in plain words, in place, with the original a tap away ----
  const rewritten = new Set(), ports = new Set();
  function plainer(p) {
    if (p.plainText !== undefined && !p.writing) { // switch between the two (back to the original even if switched off)
      if (!p.plain && !has("plainer")) return;
      if (p.plain) { p.el.replaceChildren(...p.original); p.plain = false; }
      else { p.el.replaceChildren(document.createTextNode(p.plainText)); p.plain = true; }
      p.el.classList.toggle("neurochat-plain", p.plain);
      draw();
      return;
    }
    if (p.writing || !has("plainer")) return;
    if (p.frozen === undefined) { p.frozen = value(p); p.clock.stop(); }
    p.original = [...p.el.childNodes];
    rewritten.add(p);
    p.writing = true; p.plain = true; p.plainText = "";
    p.el.classList.add("neurochat-plain");
    const out = document.createTextNode("…");
    p.el.replaceChildren(out);
    const port = oneshot();
    port.onMessage.addListener((m) => {
      if (m.type === "token") { p.plainText += m.text; out.data = p.plainText; }
      else {
        p.writing = false;
        if (m.type === "error" || !p.plainText.trim()) {
          p.el.replaceChildren(...p.original); p.plain = false; p.plainText = undefined;
          p.el.classList.remove("neurochat-plain");
          if (m.type === "error") tell(m.message);
        } else { p.plainText = M.bare(p.plainText); out.data = p.plainText; }
        port.close();
        draw();
      }
    });
    port.postMessage({ prompt: "Rewrite the paragraph below in plain words for someone new to the topic. Same facts, no longer than " +
      `the original. Reply with the paragraph only.\n\n"""${p.text.slice(0, 3000)}"""` });
    draw();
  }
  function unplain() {
    for (const p of rewritten) { p.el.replaceChildren(...p.original); p.el.classList.remove("neurochat-plain"); Object.assign(p, { plain: false, writing: false, plainText: undefined, original: undefined }); }
    rewritten.clear();
  }
  // A one-off question to the tutor (study-bg.js), closed at Exit if it's still running.
  function oneshot() {
    const port = chrome.runtime.connect({ name: "neurochat:oneshot" });
    ports.add(port);
    port.close = () => { ports.delete(port); try { port.disconnect(); } catch { /* gone */ } };
    port.onDisconnect.addListener(() => ports.delete(port));
    return port;
  }

  // ---- check-back: moving on from a paragraph you struggled with offers one question on it, once
  // you've left its section or read 6 more paragraphs (never by itself; dismissible) ----
  function offerCheck(i, from) {
    if (!has("checkback") || (notice && notice.kind !== "check")) return;
    const hard = paras.filter((q, k) => k < i && !q.checked && (q.explained || (q.slow && q.rereads > 0)) && (q.section !== paras[i].section || i - k >= 6));
    if (!hard.length || (notice?.offer && from.section === paras[i].section)) return;
    const q = hard.sort((a, b) => (slowness(b) || 0) - (slowness(a) || 0))[0];
    tell("", { label: "Quick check on what you just read?", run: () => {
      q.checked = true;
      chrome.runtime.sendMessage({ type: "neurochat:check", request: { text: q.text.slice(0, 3000), title: document.title, url: location.href, key: q.key, index: paras.indexOf(q) + 1 } }).catch(() => {});
    } }, "check");
  }

  // ---- key terms: listed in the side chat before you read, underlined only where you slow down ----
  let keyTerms = [], defs = {};
  // The side chat lists them under "Before you read"; the definitions come from the tutor straight away.
  function define(terms) {
    const note = (extra) => chrome.runtime.sendMessage({ type: "neurochat:terms", terms, url: location.href, title: document.title, ...extra }).catch(() => {});
    note({});
    let text = "";
    const port = oneshot();
    port.onMessage.addListener((m) => {
      if (m.type === "token") { text += m.text; return; }
      port.close();
      if (m.type !== "done") return;
      defs = M.parseDefs(text, terms);
      for (const s of document.querySelectorAll("span.neurochat-term")) s.title = defs[s.textContent.toLowerCase()] || s.title;
      note({ defs });
    });
    port.postMessage({ prompt: `I'm about to read "${document.title}". Define each of these terms in one plain sentence, as the text probably ` +
      `uses it. One line each, as: term: definition\n\nTerms: ${terms.join(", ")}` });
  }
  function terms(p) {
    if (!has("terms") || !keyTerms.length || p.plain || p.termed) return;
    p.termed = true;
    const re = new RegExp(`\\b(${keyTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");
    const walk = document.createTreeWalker(p.el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    const any = new RegExp(re.source, "i"); // no "g": test() would carry lastIndex from one node to the next
    while (walk.nextNode()) if (any.test(walk.currentNode.data)) nodes.push(walk.currentNode);
    for (const n of nodes) {
      const frag = document.createDocumentFragment();
      let last = 0;
      n.data.replace(re, (m, _g, i) => {
        frag.append(n.data.slice(last, i));
        const s = document.createElement("span");
        s.className = "neurochat-term";
        s.textContent = m;
        s.title = defs[m.toLowerCase()] || "A key term on this page: see Before you read in the side chat";
        frag.append(s);
        last = i + m.length;
      });
      frag.append(n.data.slice(last));
      n.replaceWith(frag);
    }
  }
  function unterm() {
    const parents = new Set();
    for (const s of document.querySelectorAll("span.neurochat-term")) { parents.add(s.parentNode); s.replaceWith(s.textContent); }
    parents.forEach((n) => n?.normalize()); // joins back only the text nodes study mode split
    for (const p of paras) p.termed = false;
  }

  // ---- fatigue: much slower than at the start of the session, for the same kind of text ----
  let rested = 0;
  function tired() {
    if (!has("fatigue") || (notice && notice.kind !== "check") || Date.now() - rested < 30 * 60000) return;
    const read = paras.filter((p) => p.last && value(p)).sort((a, b) => a.last - b.last);
    const active = paras.reduce((s, p) => s + p.clock.elapsed(), 0) + session.extraMs;
    const n = session.blinks.length, mid = session.start + (Date.now() - session.start) / 2;
    const early = session.blinks.filter((t) => t < mid).length;
    const blinks = n >= 20 ? { early, late: n - early } : null;
    const f = M.fatigue(read.map(slowness), active, blinks);
    if (!f) return;
    rested = Date.now();
    tell(f.why === "pace" ? "You've slowed down since you started. A short break helps it stick." : "You're blinking much more than earlier. A short break helps it stick.",
      { label: "Take a break", run: () => stop() }, "tired");
  }

  // ---- the session at Exit: what was hard, and the numbers as a CSV ----
  function rows() {
    return paras.map((p, i) => ({ p, i })).filter(({ p }) => p.first).map(({ p, i }) => {
      const e = expected(p), v = value(p);
      return { paragraph: i + 1, start_ms: p.first, end_ms: p.last || Date.now(), words: p.words,
        word_length: p.x[0], long_words: p.x[1], sentence_length: p.x[2], symbols: p.x[3],
        expected_ms_per_100_words: e || "", actual_ms_per_100_words: v || "", ratio: e && v ? Math.round(v / e * 100) / 100 : "",
        slow: p.slow ? 1 : 0, rereads: p.rereads, explained: p.explained ? 1 : 0, label: labels.get(p.key) || "",
        signals: session.signals.filter((s) => s.t >= p.first && s.t <= (p.last || Date.now())).map((s) => s.kind).join(" "),
        text: p.text.slice(0, 200) };
    });
  }
  function review() {
    const r = rows();
    if (!has("review") || r.filter((x) => x.actual_ms_per_100_words).length < 5) return false;
    const words = r.reduce((s, x) => s + x.words, 0), hard = r.filter((x) => x.slow).length;
    const mins = Math.max(1, Math.round((Date.now() - session.start) / 60000));
    $("sum").innerHTML = `<b>${r.length} paragraphs</b>, ${words} words in ${mins} min. ` +
      (hard ? `<b>${hard}</b> slowed you down (amber; light amber was a little slow). Tap a bar to go back to it.` : "Nothing slowed you down much. Tap a bar to go back to a paragraph.");
    $("csv").hidden = !has("export");
    const els = new Map(paras.map((p, i) => [i + 1, p.el]));
    $("ticks").replaceChildren(...r.map((x) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = x.slow ? "hard" : x.ratio >= 1.2 ? "mid" : "";
      b.title = `¶${x.paragraph}: ${x.ratio ? `${x.ratio}× expected` : "too short to time"}`;
      b.setAttribute("aria-label", b.title);
      b.onclick = () => els.get(x.paragraph)?.scrollIntoView({ block: "center", behavior: "smooth" });
      return b;
    }));
    const csv = M.toCSV(r);
    $("csv").onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = `neurochat-study-${new Date(session.start).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $("card").hidden = false;
    addEventListener("keydown", closeOnEsc, true);
    return true;
  }
  function closeReview() { $("card").hidden = true; removeEventListener("keydown", closeOnEsc, true); if (!on) host.remove(); }
  function closeOnEsc(e) { if (e.key === "Escape") closeReview(); }
  $("done").addEventListener("click", closeReview);

  // A switch turned off mid-session takes its traces with it.
  function switched() {
    if (!has("terms")) unterm();
    if (!has("plainer")) unplain();
    if ((notice?.kind === "check" && !has("checkback")) || (notice?.kind === "tired" && !has("fatigue"))) untell();
    document.documentElement.toggleAttribute("data-neurochat-selection", has("selection"));
    mark();
    sim();
  }

  // ---- following the reader ----
  function follow() {
    raf = 0;
    if (!on) return;
    paras[at]?.clock.poke();
    focus(current());
    draw();
  }
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(follow); };
  const onActivity = () => paras[at]?.clock.poke();
  const onSelect = () => { if (on && has("selection")) draw(); };
  const onVisibility = () => { const p = paras[at], c = p?.clock; if (c && !p.plain) document.hidden ? c.stop() : c.start(); };
  const onHide = () => { const p = paras[at]; if (p) { p.clock.stop(); record(p); if (!document.hidden && !p.plain) p.clock.start(); } };
  function onKey(e) {
    // The real target, even inside a web component's shadow DOM.
    const t = e.composedPath()[0];
    if (t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") { stop(); return; }
    const p = paras[at];
    if (e.key === "e" && has("explainKey") && p) { e.preventDefault(); explain(p, "key"); return; }
    if (e.key === "p" && has("plainer") && p) { e.preventDefault(); plainer(p); return; }
    // j / k move one paragraph, like a feed reader; the page's own keys keep scrolling as usual.
    const dir = { j: 1, k: -1 }[e.key];
    if (!dir) return;
    const next = paras[Math.min(paras.length - 1, Math.max(0, (at < 0 ? current() : at) + dir))];
    if (!next) return;
    e.preventDefault();
    // scrollIntoView also scrolls a page whose text sits in its own scrolling panel.
    const was = next.el.style.scrollMarginTop;
    next.el.style.scrollMarginTop = `${Math.round(innerHeight * LINE - 4)}px`;
    next.el.scrollIntoView({ block: "start", behavior: "smooth" });
    next.el.style.scrollMarginTop = was; // the scroll target is fixed when it starts; leave the page as it was
  }
  // Infinite scroll and single-page apps change the article while you read: collect again.
  function refresh() {
    recollect = 0;
    if (!on) return;
    const lit = paras[at];
    const next = collect();
    for (const p of paras) if (!next.includes(p)) p.el.classList.remove("neurochat-dim", "neurochat-current", "neurochat-slow", "neurochat-stuck");
    for (const p of next) if (p !== lit) p.el.classList.add("neurochat-dim");
    if (lit && !next.includes(lit)) { lit.clock.stop(); record(lit); }
    paras = next;
    at = lit ? paras.indexOf(lit) : -1;
    focus(current()); // not follow(): the page changing by itself isn't the reader doing something
    draw();
  }
  // Changes study mode makes itself (the pill, a paragraph being rewritten) aren't the page changing.
  const ours = (n) => host.contains(n) || n === document.documentElement || paras.some((p) => (p.plain || p.writing) && p.el.contains(n));
  const onMutate = (records) => {
    if (records.every((r) => ours(r.target))) return;
    // At most every 400 ms, even on a page that never stops changing.
    if (!recollect) recollect = setTimeout(refresh, 400);
  };
  const onMessage = (msg, _sender, reply) => {
    if (msg.type === "neurochat:signal") { signal({ ...msg.signal, source: msg.signal?.source || "muse" }); return; }
    if (msg.type === "neurochat:plainer") { const p = paras.find((q) => q.key === msg.key); if (p) plainer(p); reply({ ok: !!p }); return; }
  };
  chrome.runtime.onMessage.addListener(onMessage);

  let style = null;
  async function start() {
    if (on) return;
    if (!$("card").hidden) closeReview();
    await load();
    refit();
    paras = collect();
    if (!paras.length) { say("No paragraphs to study on this page"); return; }
    on = true;
    session = { start: Date.now(), signals: [], blinks: [], extraMs: 0 };
    // What a paragraph went through last session (on this page, without a reload) doesn't carry over.
    for (const p of paras) Object.assign(p, { clock: new P.Clock(), visits: 0, rereads: 0, slow: false, slowAt: 0, first: undefined, last: undefined,
      acted: false, judged: false, explained: false, checked: false, frozen: undefined, termed: false });
    notice = null;
    clearTimeout(note);
    style = document.createElement("style");
    style.textContent = `
      html.neurochat-study .neurochat-dim { opacity: .32 !important; transition: opacity .25s ease !important; }
      html.neurochat-study .neurochat-current { opacity: 1 !important; transition: opacity .25s ease, box-shadow .3s ease !important; }
      html.neurochat-study .neurochat-current.neurochat-slow { box-shadow: -12px 0 0 -9px rgba(229, 138, 0, .45) !important; }
      html.neurochat-study .neurochat-current.neurochat-slow.neurochat-stuck { box-shadow: -12px 0 0 -9px rgba(229, 138, 0, 1) !important; }
      html.neurochat-study .neurochat-plain { box-shadow: -12px 0 0 -10px rgba(11, 13, 18, .35); }
      html.neurochat-study .neurochat-plain.neurochat-slow { box-shadow: -12px 0 0 -9px rgba(229, 138, 0, .45) !important; }
      html.neurochat-study .neurochat-term { text-decoration: underline dotted rgba(11, 13, 18, .45) 1.5px; text-underline-offset: 3px; cursor: help; }`;
    document.documentElement.append(style, host);
    document.documentElement.classList.add("neurochat-study");
    document.documentElement.toggleAttribute("data-neurochat-selection", has("selection")); // content.js leaves those selections to us
    paras.forEach((p) => p.el.classList.add("neurochat-dim"));
    // Capture: also hears pages whose text scrolls inside a panel rather than the window.
    addEventListener("scroll", onScroll, { capture: true, passive: true });
    addEventListener("resize", onScroll, { passive: true });
    addEventListener("keydown", onKey, true);
    for (const ev of ["keydown", "pointermove", "pointerdown", "wheel", "touchstart"]) addEventListener(ev, onActivity, { passive: true });
    document.addEventListener("selectionchange", onSelect);
    document.addEventListener("visibilitychange", onVisibility);
    addEventListener("pagehide", onHide);
    watcher = new MutationObserver(onMutate);
    watcher.observe(document.body, { childList: true, subtree: true, characterData: true });
    ticker = setInterval(() => { if (at >= 0) mark(); if (++ticks % 30 === 0) tired(); }, 1000);
    keyTerms = has("terms") ? M.keyTerms(paras.map((p) => p.text)) : [];
    defs = {};
    if (keyTerms.length) define(keyTerms);
    sim();
    follow();
  }

  function stop() {
    if (!on) return;
    leave();
    on = false;
    clearInterval(ticker);
    clearTimeout(recollect);
    recollect = 0;
    watcher?.disconnect();
    removeEventListener("scroll", onScroll, { capture: true });
    removeEventListener("resize", onScroll);
    removeEventListener("keydown", onKey, true);
    for (const ev of ["keydown", "pointermove", "pointerdown", "wheel", "touchstart"]) removeEventListener(ev, onActivity);
    document.removeEventListener("selectionchange", onSelect);
    document.removeEventListener("visibilitychange", onVisibility);
    removeEventListener("pagehide", onHide);
    unplain();
    ports.forEach((port) => port.close());
    unterm();
    document.documentElement.classList.remove("neurochat-study");
    document.documentElement.removeAttribute("data-neurochat-selection");
    paras.forEach((p) => p.el.classList.remove("neurochat-dim", "neurochat-current", "neurochat-slow", "neurochat-stuck"));
    style?.remove();
    notice = null;
    $("offer").hidden = $("close").hidden = true;
    $("dock").hidden = $("pills").hidden = $("sim").hidden = $("line").hidden = true;
    if (!review()) host.remove();
    paras = [];
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === "neurochat:study") {
      (on ? (stop(), Promise.resolve()) : start()).then(() => reply({ on, paragraphs: paras.length }));
      return true;
    }
    // For tests (tests/study/*.mjs) and only from the extension itself: read the state, or
    // pretend the session has run longer than it has (fatigue needs 20 minutes).
    if (msg.type === "neurochat:study-test") {
      if (msg.extraMs && session) session.extraMs += msg.extraMs;
      if (msg.tired) { rested = 0; tired(); }
      if (msg.press) $(msg.press)?.click();
      reply({ on, at, paragraphs: paras.length, slow: paras.map((p) => p.slow), rereads: paras.map((p) => p.rereads), samples: samples.size,
        ratio, threshold: threshold(), expected: paras.map(expected), terms: keyTerms, cue: $("cue").textContent, offer: $("offer").hidden ? null : $("offer").textContent,
        signals: session ? session.signals.map((s) => s.kind) : [], underline: !$("line").hidden, pill: $("pill").textContent,
        alt: $("alt").hidden ? null : $("alt").textContent, card: $("card").hidden ? null : $("sum").textContent, sim: !$("sim").hidden });
    }
  });
})();
