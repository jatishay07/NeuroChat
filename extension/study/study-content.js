// Study mode on any page: the paragraph you're reading stays lit and the rest dim, so the time it
// spends at the reading line is the time you spent reading it. That time, per 100 words, is
// compared with your own usual pace (study-pace.js, the same engine as the portal's study.html).
// A paragraph much slower than usual gets a quiet amber edge, and Explain sends it to the side
// chat. Turn it on with "Study this page" (right-click) or Alt+Shift+S; Esc or Exit turns it off.
(() => {
  const P = self.StudyPace;
  const LINE = 0.38;      // the reading line, as a share of the window's height from the top
  const SAMPLES = "neurochat.study.samples.v1"; // [{k, v}]: one reading per paragraph, shared by every tab
  const KEEP = 200;

  let on = false, paras = [], at = -1, raf = 0, ticker = 0, watcher = null, recollect = 0;
  let samples = [];
  const state = new WeakMap(); // element -> its clock, visits, slow, frozen pace (survives re-collecting)

  // ---- the baseline: one reading per paragraph (keyed by page and text), merged across tabs ----
  const parse = (v) => { try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a.filter((s) => s && s.k && s.v > 0) : []; } catch { return []; } };
  const get = async () => parse((await chrome.storage.local.get(SAMPLES))[SAMPLES]);
  chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c[SAMPLES]) samples = parse(c[SAMPLES].newValue); });
  function keyOf(text) {
    let h = 5381;
    for (const ch of location.origin + location.pathname + "\n" + text) h = (h * 33 + ch.codePointAt(0)) >>> 0;
    return h.toString(36);
  }
  async function record(p) {
    const v = value(p);
    if (!v) return;
    const all = await get(); // re-read so another tab's readings aren't overwritten
    const i = all.findIndex((s) => s.k === p.key);
    if (i >= 0) all[i].v = v; else all.push({ k: p.key, v });
    samples = all.slice(-KEEP);
    chrome.storage.local.set({ [SAMPLES]: JSON.stringify(samples) }).catch(() => {});
  }
  // The usual pace without this paragraph, so it's never compared with itself.
  function stats(p) {
    const v = samples.filter((s) => s.k !== p.key).map((s) => s.v);
    return { median: P.median(v), samples: v.length };
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
    return [...contentRoot().querySelectorAll(BLOCK)]
      .filter((el) => !el.closest(SKIP) && !el.parentElement.closest(BLOCK))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map((el) => {
        const text = textOf(el);
        let p = state.get(el);
        if (!p || p.text !== text) {
          p = { el, text, key: keyOf(text), words: P.words(text), clock: new P.Clock(), visits: 0, slow: false };
          state.set(el, p);
        }
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

  function leave() {
    const p = paras[at];
    at = -1;
    if (!p) return;
    p.clock.stop();
    record(p);
    p.el.classList.remove("neurochat-current");
    p.el.classList.add("neurochat-dim");
  }

  function focus(i) {
    if (i === at) return;
    leave();
    if (i < 0) { draw(); return; }
    at = i;
    const p = paras[i];
    p.visits++;
    p.el.classList.remove("neurochat-dim");
    p.el.classList.add("neurochat-current");
    if (!document.hidden) p.clock.start();
    mark();
  }

  function mark() {
    const p = paras[at];
    if (p && !p.slow) {
      const { median, samples: n } = stats(p);
      p.slow = P.isSlow(value(p), median, n);
    }
    paras.forEach((q) => q.el.classList.toggle("neurochat-slow", q.slow));
    draw();
  }

  // ---- the Explain pill next to the lit paragraph, and the dock ----
  const host = document.createElement("neurochat-study");
  const root = host.attachShadow({ mode: "closed" });
  const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", system-ui, sans-serif`;
  root.innerHTML = `<style>
    :host { all: initial; }
    button { all: initial; box-sizing: border-box; cursor: pointer; font: 500 13px/1.2 ${FONT}; display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; white-space: nowrap; }
    button:focus-visible { outline: 2px solid #0b0d12; outline-offset: 2px; }
    .pill { position: absolute; z-index: 2147483646; padding: 6px 12px; color: #0b0d12; background: rgba(255, 255, 255, .92);
      border: 1px solid rgba(11, 13, 18, .12); box-shadow: 0 6px 20px rgba(20, 30, 60, .14); transition: background .2s, color .2s; }
    .pill:hover { background: #fff; }
    .pill.slow { color: #fff; background: #0b0d12; border-color: #0b0d12; }
    .pill.slow::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #e58a00; }
    .pill[hidden], .dock[hidden], .dock [hidden] { display: none; }
    .dock { position: fixed; z-index: 2147483646; left: 50%; bottom: 20px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
      padding: 6px 6px 6px 16px; border-radius: 999px; font: 500 13px/1.2 ${FONT}; color: #4b5260; white-space: nowrap; max-width: calc(100vw - 24px);
      background: linear-gradient(180deg, rgba(255, 255, 255, .86), rgba(255, 255, 255, .66)); border: 1px solid rgba(255, 255, 255, .9);
      -webkit-backdrop-filter: blur(30px) saturate(180%); backdrop-filter: blur(30px) saturate(180%);
      box-shadow: inset 0 1px 0 #fff, 0 16px 50px rgba(20, 30, 60, .16); }
    .dock i { flex: none; width: 7px; height: 7px; border-radius: 50%; background: #1f9d63; box-shadow: 0 0 0 3px rgba(31, 157, 99, .18); }
    .dock.slow i { background: #e58a00; box-shadow: 0 0 0 3px rgba(229, 138, 0, .2); }
    .dock b { font-weight: 500; color: #0b0d12; }
    .dock .count { font: 500 12px ui-monospace, "SF Mono", Menlo, monospace; }
    .dock #cue { overflow: hidden; text-overflow: ellipsis; }
    .dock button { padding: 7px 12px; color: #0b0d12; }
    .dock button:hover { background: rgba(11, 13, 18, .06); }
    @media (max-width: 480px) { .dock #cue { display: none; } }
  </style>
  <button type="button" class="pill" id="pill" hidden>Explain</button>
  <div class="dock" id="dock" role="status" hidden><i></i><b>Study mode</b><span class="count" id="count"></span><span id="cue"></span><button type="button" id="exit" aria-label="Turn off study mode">Exit</button></div>`;
  const $ = (id) => root.getElementById(id);

  function draw() {
    const p = paras[at];
    $("dock").hidden = !on;
    $("pill").hidden = !on || !p;
    $("count").textContent = on ? `${at < 0 ? "–" : at + 1} / ${paras.length}` : "";
    $("cue").textContent = p?.slow ? "Slower than your usual pace" : "";
    $("dock").classList.toggle("slow", !!p?.slow);
    if (!p) return;
    $("pill").classList.toggle("slow", p.slow);
    $("pill").setAttribute("aria-label", `Explain paragraph ${at + 1} with NeuroChat`);
    const r = p.el.getBoundingClientRect();
    const w = $("pill").offsetWidth || 80, h = $("pill").offsetHeight || 30;
    // Beside the paragraph's top-right corner; above it when the paragraph runs to the window's edge.
    const beside = r.right + 12 + w <= innerWidth - 8;
    const left = beside ? r.right + 12 : Math.min(r.right, innerWidth - 8) - w;
    const top = beside ? Math.max(r.top, 8) : Math.max(r.top - h - 6, 8);
    $("pill").style.left = `${scrollX + Math.max(8, left)}px`;
    $("pill").style.top = `${scrollY + top}px`;
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

  $("pill").addEventListener("click", () => {
    const p = paras[at];
    if (!p) return;
    // Pace stops at Explain: reading the answer isn't reading the paragraph.
    if (p.frozen === undefined) { p.frozen = value(p); p.clock.stop(); }
    const { median, samples: n } = stats(p);
    const request = { text: p.text.slice(0, 4000), title: document.title, url: location.href };
    if (p.frozen) request.dwellMsPer100Words = p.frozen;
    if (median && n >= P.MIN_SAMPLES) request.medianMsPer100Words = median;
    if (p.visits > 1) request.rereads = p.visits - 1;
    chrome.runtime.sendMessage({ type: "neurochat:explain", request }).catch(() => {});
  });
  $("exit").addEventListener("click", () => stop());

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
  const onVisibility = () => { const c = paras[at]?.clock; if (c) document.hidden ? c.stop() : c.start(); };
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
    next.el.style.scrollMarginTop = `${Math.round(innerHeight * LINE - 4)}px`;
    next.el.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  // Infinite scroll and single-page apps change the article while you read: collect again.
  function refresh() {
    recollect = 0;
    if (!on) return;
    const lit = paras[at];
    const next = collect();
    for (const p of paras) if (!next.includes(p)) p.el.classList.remove("neurochat-dim", "neurochat-current", "neurochat-slow");
    for (const p of next) if (p !== lit) p.el.classList.add("neurochat-dim");
    if (lit && !next.includes(lit)) { lit.clock.stop(); record(lit); }
    paras = next;
    at = lit ? paras.indexOf(lit) : -1;
    follow();
  }
  const onMutate = (records) => {
    if (records.every((r) => host.contains(r.target) || r.target === document.documentElement)) return;
    clearTimeout(recollect);
    recollect = setTimeout(refresh, 400);
  };

  let style = null;
  async function start() {
    if (on) return;
    samples = await get();
    paras = collect();
    if (!paras.length) { say("No paragraphs to study on this page"); return; }
    on = true;
    clearTimeout(note);
    style = document.createElement("style");
    style.textContent = `
      html.neurochat-study .neurochat-dim { opacity: .32 !important; transition: opacity .25s ease !important; }
      html.neurochat-study .neurochat-current { opacity: 1 !important; transition: opacity .25s ease, box-shadow .3s ease !important; }
      html.neurochat-study .neurochat-current.neurochat-slow { box-shadow: -12px 0 0 -9px rgba(229, 138, 0, .75) !important; }`;
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
    follow();
  }

  function stop() {
    if (!on) return;
    leave();
    on = false;
    clearInterval(ticker);
    clearTimeout(recollect);
    watcher?.disconnect();
    removeEventListener("scroll", onScroll, { capture: true });
    removeEventListener("resize", onScroll);
    removeEventListener("keydown", onKey, true);
    for (const ev of ["keydown", "pointermove", "pointerdown", "wheel", "touchstart"]) removeEventListener(ev, onActivity);
    document.removeEventListener("visibilitychange", onVisibility);
    removeEventListener("pagehide", onHide);
    document.documentElement.classList.remove("neurochat-study");
    paras.forEach((p) => p.el.classList.remove("neurochat-dim", "neurochat-current", "neurochat-slow"));
    style?.remove();
    host.remove();
    paras = [];
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type !== "neurochat:study") return;
    (on ? (stop(), Promise.resolve()) : start()).then(() => reply({ on, paragraphs: paras.length }));
    return true;
  });

  // Read-only view for tests (tests/study/extension.mjs).
  self.__neurochatStudy = { state: () => ({ on, at, paragraphs: paras.length, slow: paras.map((p) => p.slow), samples: samples.length }) };
})();
