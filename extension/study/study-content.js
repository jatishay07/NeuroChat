// Study mode on any page: the paragraph you're reading stays lit and the rest dim, so the time it
// spends at the reading line is the time you spent reading it. That time, per 100 words, is
// compared with what this paragraph should take you (study-model.js: your own pace, adjusted for how
// dense the text is). Nothing to press: a paragraph much slower than that gets a quiet amber edge,
// and when you also go back to reread it, it's explained in the side chat by itself. A headset adds
// its own signs later (a jaw clench explains now; a reread line is underlined). Turn it on with
// "Study this page" (right-click) or Alt+Shift+S; Esc or Exit turns it off.
(() => {
  const P = self.StudyPace, M = self.StudyModel;
  const LINE = 0.38;      // the reading line, as a share of the window's height from the top
  const PREFIX = "neurochat.study.s:"; // one key per paragraph read ({v, t, x, h}), so tabs never overwrite each other
  const FLAGS_KEY = "neurochat.study.features", RATIO_KEY = "neurochat.study.ratio";
  const KEEP = 200;
  const AWAY_MS = 3000;    // away from a paragraph at least this long (or 2+ paragraphs on) before coming back…
  const REREAD_MS = 2000;  // …and back on it this long = a reread, not a scroll past and back
  const AGAIN_MS = 20000;  // after an explanation, checking the paragraph against it isn't being stuck again
  const IGNORED_MS = 10000; // flagged, seen this long, then left without going back = a flag they didn't need

  // Developer switches only; there are no settings for the reader. The simulator sends headset signals
  // from the page, so it's off.
  const FEATURES = { auto: true, simulator: false };
  let flags = { ...FEATURES };
  const has = (f) => !!flags[f];

  let on = false, paras = [], at = -1, raf = 0, ticker = 0, watcher = null, recollect = 0;
  let ratio = M.RATIO.start, session = null;
  const samples = new Map(); // paragraph key -> {v, t, x, h}
  const state = new WeakMap(); // element -> its clock, visits, slow, frozen pace (survives re-collecting)

  // ---- the baseline: one reading per paragraph (keyed by page and text), shared by every tab ----
  const ok = (s) => s && s.v > 0;
  async function load() {
    samples.clear();
    const all = await chrome.storage.local.get(null);
    for (const [k, s] of Object.entries(all)) if (k.startsWith(PREFIX) && ok(s)) samples.set(k.slice(PREFIX.length), s);
    flags = { ...FEATURES, ...(all[FLAGS_KEY] || {}) };
    ratio = Number.isFinite(all[RATIO_KEY]) ? all[RATIO_KEY] : M.RATIO.start;
  }
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "local") return;
    for (const [k, { newValue }] of Object.entries(c)) {
      if (k === FLAGS_KEY) { flags = { ...FEATURES, ...(newValue || {}) }; sim(); }
      else if (k === RATIO_KEY) ratio = Number.isFinite(newValue) ? newValue : M.RATIO.start;
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
    return M.predict(modelFor(p), p.x);
  }
  function slowness(p) { const e = expected(p), v = value(p); return e && v ? v / e : null; }
  // How much slower counts as slow tunes itself from what the reader does next: going back to a
  // flagged paragraph says the flag was right, leaving it for good says it wasn't needed.
  function tune(event) {
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
        // Text that updates live ("updated 5 s ago") keeps its clock; only what it says changes.
        const text = textOf(el);
        if (p.text !== text) Object.assign(p, { text, key: keyOf(text), words: P.words(text), x: M.features(text) });
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
    // Flagged, the flag in view for a while, and left without going back: not needed. (Leaving just
    // after the flag says nothing: it appears as a slow reader is finishing anyway.)
    if (judge && p.slow && !p.acted && !p.judged && p.last - p.slowAt >= IGNORED_MS) { p.judged = true; tune("false"); }
    record(p);
    p.el.classList.remove("neurochat-current");
    p.el.classList.add("neurochat-dim");
  }

  // judge: the reader moved (not the page changing under them), so what they did can count.
  function focus(i, judge = true) {
    if (i === at) return;
    const from = at;
    leave(judge && i >= 0);
    if (i < 0) { draw(); return; }
    at = i;
    const p = paras[i];
    p.visits++;
    p.el.classList.remove("neurochat-dim");
    p.el.classList.add("neurochat-current");
    if (!document.hidden) p.clock.start();
    // Back on a paragraph you'd already left, and staying there: a reread.
    if (judge && p.last && from > i && (Date.now() - p.last >= AWAY_MS || from - i >= 2)) {
      rereadTimer = setTimeout(() => { if (paras[at] === p && !document.hidden) signal({ kind: "reread", source: "scroll", para: paras.indexOf(p) }); }, REREAD_MS);
    }
    mark();
  }

  function mark() {
    const p = paras[at];
    if (p && !p.slow) {
      const r = slowness(p);
      // Slow on the first read is what counts for explaining by itself: time spent going back adds to
      // a paragraph's pace too, so a reread alone would otherwise make any short paragraph "slow".
      if (r && r >= ratio) { p.slow = true; p.slowAt = Date.now(); p.firstRead = p.visits === 1; if (p.rereads) p.acted = true; }
    }
    paras.forEach((q) => { q.el.classList.toggle("neurochat-slow", q.slow); q.el.classList.toggle("neurochat-stuck", q.slow && q.rereads > 0); });
    draw();
  }

  // Slow on the first read and gone back to: two signs that agree, so it's explained without asking.
  // Still going back after the explanation: once more, a different way.
  function stuck(p, trigger = "auto") {
    if (!has("auto") || (trigger === "auto" && !p.firstRead)) return;
    if (!p.explained) explain(p, trigger);
    else if (p.delivered && !p.again && Date.now() - p.explainedAt >= AGAIN_MS) { p.again = true; again(p); }
  }

  // ---- signals: one way in for every sign of trouble, from the page now and from a headset later ----
  // {kind: "reread" | "clench" | "stuck", t, source: "scroll" | "sim" | "muse", para?: index,
  //  line?: line in the paragraph}. See .graph/CONTRACTS.md.
  function signal(s) {
    if (!on || !s || typeof s.kind !== "string") return;
    s = { t: Date.now(), source: "page", ...s };
    session.signals.push(s);
    if (session.signals.length > 2000) session.signals.shift();
    const i = Number.isInteger(s.para) ? s.para : at;
    const p = paras[i];
    if (!p) return;
    if (s.kind === "reread") {
      p.rereads++;
      if (p.slow && !p.acted) { p.acted = true; tune("hit"); }
      // Gone back twice to a paragraph that never looked slow: the flag should have come sooner.
      if (!p.slow && p.rereads === 2 && !p.missed) { p.missed = true; tune("miss"); }
      // The headset says which line; underline it only if the paragraph is slow too (never a popup).
      if (Number.isInteger(s.line) && p.slow && i === at) underline(s.line);
      if (p.slow) stuck(p);
      mark();
    } else if (s.kind === "clench") { // a deliberate sign: explain now, slow or not; once explained, put it another way (once)
      if (!p.explained) explain(p, "clench");
      else if (p.delivered && !p.again) { p.again = true; again(p); }
    }
    else if (s.kind === "stuck" && p.slow) stuck(p, "headset"); // the headset's own read, confirming the pace
  }
  // Developers (and tests) can send signals from the page only while the simulator is switched on,
  // so an ordinary page can't trigger explanations.
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

  // ---- the dock: Study mode, a line when something was explained, and Exit ----
  const host = document.createElement("neurochat-study");
  const root = host.attachShadow({ mode: "closed" });
  const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", system-ui, sans-serif`;
  root.innerHTML = `<style>
    :host { all: initial; }
    button { all: initial; box-sizing: border-box; cursor: pointer; font: 500 13px/1.2 ${FONT}; display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; white-space: nowrap; }
    button:focus-visible { outline: 2px solid #0b0d12; outline-offset: 2px; }
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
    .dock b { font-weight: 500; color: #0b0d12; }
    .dock #cue { overflow: hidden; text-overflow: ellipsis; }
    .glass button { padding: 7px 12px; color: #0b0d12; }
    .glass button:hover { background: rgba(11, 13, 18, .06); }
    .glass.sim { left: auto; right: 16px; bottom: 84px; transform: none; width: max-content; display: flex; flex-direction: column; align-items: stretch; gap: 2px; padding: 8px; border-radius: 16px; }
    .sim span { font: 600 11px ${FONT}; color: #8a8f99; text-transform: uppercase; letter-spacing: .04em; padding: 0 4px 2px; }
    @media (max-width: 480px) { .dock #cue { display: none; } }
  </style>
  <div class="line" id="line" hidden></div>
  <div class="glass dock" id="dock" role="status" hidden><i></i><b>Study mode</b><span id="cue"></span><button type="button" id="exit" aria-label="Turn off study mode">Exit</button></div>
  <div class="glass sim" id="sim" hidden><span>Headset simulator</span><button type="button" data-k="reread">Reread line 2</button><button type="button" data-k="stuck">Stuck</button><button type="button" data-k="clench">Jaw clench</button></div>`;
  const $ = (id) => root.getElementById(id);

  function draw() {
    const p = paras[at];
    $("dock").hidden = !on;
    $("cue").textContent = !p?.explained ? "" : p.delivered ? "Explained in the side chat" : "Explained: open the side chat to read it";
    $("dock").classList.toggle("slow", !!p?.slow);
    if (lineAt !== null) underline(lineAt);
  }

  let note = 0;
  function say(text) { // a short note in the dock, e.g. when there's nothing to study
    clearTimeout(note);
    document.documentElement.append(host);
    $("dock").hidden = false;
    $("cue").textContent = text;
    note = setTimeout(() => { if (!on) host.remove(); }, 3000);
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

  function explain(p, trigger) {
    // Pace stops at Explain: reading the answer isn't reading the paragraph.
    if (p.frozen === undefined) { p.frozen = value(p); p.clock.stop(); }
    if (p.slow && !p.acted) tune("hit");
    p.acted = p.explained = true;
    p.explainedAt = Date.now();
    const e = expected(p);
    const request = { text: p.text.slice(0, 4000), title: document.title, url: location.href, key: p.key, index: paras.indexOf(p) + 1, flagged: p.slow, trigger };
    if (p.frozen) request.dwellMsPer100Words = p.frozen;
    // The tutor compares the two as "N× their usual pace": usual for this text.
    if (e) request.medianMsPer100Words = e;
    if (p.rereads > 0) request.rereads = p.rereads;
    const before = earlier(p);
    if (before.length) request.earlier = before;
    // Delivered only if the side chat is open: Chrome won't open it without a click or key press, so a
    // closed one picks the explanation up when the reader opens it (within a minute).
    chrome.runtime.sendMessage({ type: "neurochat:explain", request }).then((r) => { p.delivered = !!r?.ok; }, () => {}).finally(draw);
    draw();
  }
  // Still going back after the explanation: the side chat asks for it a different way.
  function again(p) {
    chrome.runtime.sendMessage({ type: "neurochat:explain", request: { again: true, text: p.text.slice(0, 4000), title: document.title, url: location.href, key: p.key } }).catch(() => {});
  }
  $("exit").addEventListener("click", () => stop());
  root.getElementById("sim").addEventListener("click", (e) => {
    const k = e.target.closest("button")?.dataset.k;
    if (k) signal({ kind: k, source: "sim", ...(k === "reread" ? { line: 1 } : {}) });
  });
  function sim() { $("sim").hidden = !on || !has("simulator"); }

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
  const onVisibility = () => { const c = paras[at]?.clock; if (c) document.hidden ? c.stop() : c.start(); if (document.hidden) clearTimeout(rereadTimer); };
  const onHide = () => { const p = paras[at]; if (p) { p.clock.stop(); record(p); if (!document.hidden) p.clock.start(); } };
  function onKey(e) {
    // The real target, even inside a web component's shadow DOM.
    const t = e.composedPath()[0];
    if (t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") { stop(); return; }
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
    focus(current(), false); // not follow(): the page changing by itself isn't the reader doing something
    draw();
  }
  // Changes study mode makes itself (the dock, the underline) aren't the page changing.
  const ours = (n) => host.contains(n) || n === document.documentElement;
  const onMutate = (records) => {
    if (records.every((r) => ours(r.target))) return;
    // At most every 400 ms, even on a page that never stops changing.
    if (!recollect) recollect = setTimeout(refresh, 400);
  };
  // A headset (through the extension) sends its signals here.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "neurochat:signal") signal({ ...msg.signal, source: msg.signal?.source && msg.signal.source !== "scroll" ? msg.signal.source : "muse" });
  });

  let style = null;
  async function start() {
    if (on) return;
    await load();
    refit();
    paras = collect();
    if (!paras.length) { say("No paragraphs to study on this page"); return; }
    on = true;
    session = { start: Date.now(), signals: [] };
    // What a paragraph went through last session (on this page, without a reload) doesn't carry over.
    for (const p of paras) Object.assign(p, { clock: new P.Clock(), visits: 0, rereads: 0, slow: false, slowAt: 0, last: undefined,
      firstRead: false, acted: false, judged: false, missed: false, explained: false, delivered: false, explainedAt: 0, again: false, frozen: undefined });
    clearTimeout(note);
    style = document.createElement("style");
    style.textContent = `
      html.neurochat-study .neurochat-dim { opacity: .32 !important; transition: opacity .25s ease !important; }
      html.neurochat-study .neurochat-current { opacity: 1 !important; transition: opacity .25s ease, box-shadow .3s ease !important; }
      html.neurochat-study .neurochat-current.neurochat-slow { box-shadow: -12px 0 0 -9px rgba(229, 138, 0, .45) !important; }
      html.neurochat-study .neurochat-current.neurochat-slow.neurochat-stuck { box-shadow: -12px 0 0 -9px rgba(229, 138, 0, 1) !important; }`;
    document.documentElement.append(style, host);
    document.documentElement.classList.add("neurochat-study");
    paras.forEach((p) => p.el.classList.add("neurochat-dim"));
    // Capture: also hears pages whose text scrolls inside a panel rather than the window.
    addEventListener("scroll", onScroll, { capture: true, passive: true });
    addEventListener("resize", onScroll, { passive: true });
    addEventListener("keydown", onKey, true);
    for (const ev of ["keydown", "pointermove", "pointerdown", "wheel", "touchstart"]) addEventListener(ev, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    addEventListener("pagehide", onHide);
    watcher = new MutationObserver(onMutate);
    watcher.observe(document.body, { childList: true, subtree: true, characterData: true });
    ticker = setInterval(() => { if (at >= 0) mark(); }, 1000);
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
    document.removeEventListener("visibilitychange", onVisibility);
    removeEventListener("pagehide", onHide);
    document.documentElement.classList.remove("neurochat-study");
    paras.forEach((p) => p.el.classList.remove("neurochat-dim", "neurochat-current", "neurochat-slow", "neurochat-stuck"));
    style?.remove();
    host.remove();
    paras = [];
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === "neurochat:study") {
      (on ? (stop(), Promise.resolve()) : start()).then(() => reply({ on, paragraphs: paras.length }));
      return true;
    }
    // For tests (tests/study/*.mjs) and only from the extension itself: read the state.
    if (msg.type === "neurochat:study-test") {
      if (msg.flagFor && paras[at]) Object.assign(paras[at], { slow: true, slowAt: Date.now() - msg.flagFor }); // a flag shown this many ms ago
      if (msg.explainedAgo) for (const p of paras) if (p.explained) p.explainedAt = Date.now() - msg.explainedAgo; // the 20 s before "again"
      reply({ on, at, paragraphs: paras.length, slow: paras.map((p) => p.slow), rereads: paras.map((p) => p.rereads),
        explained: paras.map((p) => !!p.explained), delivered: paras.map((p) => !!p.delivered), again: paras.map((p) => !!p.again), samples: samples.size, ratio,
        expected: paras.map(expected), cue: $("cue").textContent, signals: session ? session.signals.map((s) => s.kind) : [],
        underline: !$("line").hidden, sim: !$("sim").hidden });
    }
  });
})();
