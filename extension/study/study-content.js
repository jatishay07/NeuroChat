// Study mode on any page: the paragraph you're reading stays lit and the rest dim, so the time it
// spends at the reading line is the time you spent reading it. That time, per 100 words, is
// compared with your own usual pace (study-pace.js, the same engine as the portal's study.html).
// A paragraph much slower than usual gets a quiet amber edge, and Explain sends it to the side
// chat. Turn it on with "Study this page" (right-click) or Alt+Shift+S; Esc or Exit turns it off.
(() => {
  const P = self.StudyPace;
  const LINE = 0.38; // the reading line, as a share of the window's height from the top

  let on = false, paras = [], at = -1, baseline = null, raf = 0, ticker = 0;

  // ---- the baseline lives in the extension's storage, so every site shares one pace ----
  async function loadBaseline() {
    const mem = { [P.KEY]: (await chrome.storage.local.get(P.KEY))[P.KEY] ?? null };
    return new P.Baseline({
      getItem: (k) => mem[k] ?? null,
      setItem: (k, v) => { mem[k] = v; chrome.storage.local.set({ [k]: v }).catch(() => {}); },
      removeItem: (k) => { delete mem[k]; chrome.storage.local.remove(k).catch(() => {}); },
    });
  }

  // ---- what counts as a paragraph on a real page ----
  const SKIP = "nav, header, footer, aside, form, button, [role=navigation], [role=banner], [role=contentinfo], [aria-hidden=true], neurochat-pill, neurochat-study";
  function collect() {
    const root = document.querySelector("article") || document.querySelector("main, [role=main]") || document.body;
    return [...root.querySelectorAll("p, li, blockquote, dd, figcaption")]
      .filter((el) => !el.closest(SKIP) && !el.parentElement.closest("p, li, blockquote"))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map((el) => {
        const text = el.innerText.replace(/\s+/g, " ").trim();
        return { el, text, words: P.words(text), clock: new P.Clock(), visits: 0, slow: false };
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

  const value = (i) => paras[i].frozen !== undefined ? paras[i].frozen : P.msPer100Words(paras[i].clock.elapsed(), paras[i].words);

  function leave() {
    if (at < 0) return;
    const p = paras[at];
    p.clock.stop();
    baseline.record(p.text, value(at));
    p.el.classList.remove("neurochat-current");
    p.el.classList.add("neurochat-dim");
    at = -1;
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
      const { median, samples } = baseline.stats(p.text);
      p.slow = P.isSlow(value(at), median, samples);
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
    .pill[hidden], .dock[hidden] { display: none; }
    .dock { position: fixed; z-index: 2147483646; left: 50%; bottom: 20px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
      padding: 6px 6px 6px 16px; border-radius: 999px; font: 500 13px/1.2 ${FONT}; color: #4b5260;
      background: linear-gradient(180deg, rgba(255, 255, 255, .86), rgba(255, 255, 255, .66)); border: 1px solid rgba(255, 255, 255, .9);
      -webkit-backdrop-filter: blur(30px) saturate(180%); backdrop-filter: blur(30px) saturate(180%);
      box-shadow: inset 0 1px 0 #fff, 0 16px 50px rgba(20, 30, 60, .16); }
    .dock i { width: 7px; height: 7px; border-radius: 50%; background: #1f9d63; box-shadow: 0 0 0 3px rgba(31, 157, 99, .18); }
    .dock.slow i { background: #e58a00; box-shadow: 0 0 0 3px rgba(229, 138, 0, .2); }
    .dock b { font-weight: 500; color: #0b0d12; }
    .dock .count { font: 500 12px ui-monospace, "SF Mono", Menlo, monospace; }
    .dock button { padding: 7px 12px; color: #0b0d12; }
    .dock button:hover { background: rgba(11, 13, 18, .06); }
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
    const w = $("pill").offsetWidth || 80;
    // Beside the paragraph's top-right corner, inside the window.
    const left = Math.min(r.right + 12, innerWidth - w - 12);
    $("pill").style.left = `${scrollX + Math.max(8, left)}px`;
    $("pill").style.top = `${scrollY + Math.max(r.top, 8)}px`;
  }

  $("pill").addEventListener("click", () => {
    const p = paras[at];
    if (!p) return;
    // Pace stops at Explain: reading the answer isn't reading the paragraph.
    if (p.frozen === undefined) { p.frozen = value(at); p.clock.stop(); }
    const { median, samples } = baseline.stats(p.text);
    const request = { text: p.text.slice(0, 4000), title: document.title, url: location.href };
    if (p.frozen) request.dwellMsPer100Words = p.frozen;
    if (median && samples >= P.MIN_SAMPLES) request.medianMsPer100Words = median;
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
  const onHide = () => { if (at >= 0) { paras[at].clock.stop(); baseline.record(paras[at].text, value(at)); if (!document.hidden) paras[at].clock.start(); } };
  function onKey(e) {
    if (e.target.closest?.("input, textarea, select, [contenteditable=''], [contenteditable=true]") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") { stop(); return; }
    // j / k move one paragraph, like a feed reader; the page's own keys keep scrolling as usual.
    const dir = { j: 1, k: -1 }[e.key];
    if (!dir) return;
    const next = paras[Math.min(paras.length - 1, Math.max(0, (at < 0 ? current() : at) + dir))];
    if (!next) return;
    e.preventDefault();
    const r = next.el.getBoundingClientRect();
    scrollBy({ top: r.top - innerHeight * LINE + 4, behavior: "smooth" });
  }

  let style = null;
  async function start() {
    if (on) return;
    baseline = baseline || await loadBaseline();
    baseline.newSession();
    paras = collect();
    if (!paras.length) return;
    on = true;
    style = document.createElement("style");
    style.textContent = `
      html.neurochat-study .neurochat-dim { opacity: .32 !important; transition: opacity .25s ease !important; }
      html.neurochat-study .neurochat-current { opacity: 1 !important; transition: opacity .25s ease, box-shadow .3s ease !important; }
      html.neurochat-study .neurochat-current.neurochat-slow { box-shadow: -12px 0 0 -9px rgba(229, 138, 0, .75) !important; }`;
    document.documentElement.append(style, host);
    document.documentElement.classList.add("neurochat-study");
    paras.forEach((p) => p.el.classList.add("neurochat-dim"));
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll, { passive: true });
    addEventListener("keydown", onKey, true);
    for (const ev of ["keydown", "pointermove", "pointerdown", "wheel", "touchstart"]) addEventListener(ev, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    addEventListener("pagehide", onHide);
    ticker = setInterval(() => { if (at >= 0) mark(); }, 1000);
    follow();
  }

  function stop() {
    if (!on) return;
    leave();
    on = false;
    clearInterval(ticker);
    removeEventListener("scroll", onScroll);
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
  self.__neurochatStudy = { state: () => ({ on, at, paragraphs: paras.length, slow: paras.map((p) => p.slow), pace: at >= 0 ? value(at) : null, baseline: baseline?.values() ?? [] }) };
})();
