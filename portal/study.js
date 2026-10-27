// Study mode: one paragraph at a time, timed against the reader's own usual pace (study-pace.js).
// A paragraph read much slower than usual gets a quiet cue; Explain sends it to the local tutor
// over /ws/chat and streams the answer under it. No headset, no camera.
(() => {
  const $ = (id) => document.getElementById(id);
  const P = window.StudyPace;
  const TEXT_KEY = "neurochat.study.text";
  const SAMPLE = `How do batteries store energy?

A battery is a small chemical factory that runs in reverse when you charge it. Inside, two different materials sit on either side of a liquid or gel. When you connect a device, one side gives up electrons and the other side takes them, and that flow of electrons through your device is the electric current.

The side that gives up electrons is called the anode, and the side that accepts them is the cathode. In a typical phone battery the anode is made of graphite, the same material as pencil lead, and the cathode is a metal oxide containing lithium.

The electrochemical potential difference between electrodes arises from the disparity in Gibbs free energy of lithium in each host lattice; intercalation into graphite is thermodynamically favoured only when an external overpotential exceeds the open-circuit voltage, whereupon lithium ions migrate through the electrolyte while electrons traverse the external circuit, preserving charge neutrality.

When you plug your phone in, the charger pushes the electrons back the other way. Lithium ions travel back through the liquid to the graphite side and tuck themselves between its layers, ready to flow out again the next time you use the phone.

Batteries wear out because every trip back and forth slightly damages the materials. Tiny cracks form, and some lithium gets trapped where it can no longer move. That is why a two-year-old phone does not last as long on a charge as a new one.`;

  let store = null;
  try { store = window.localStorage; } catch { /* storage blocked: this session only */ }
  const baseline = new P.Baseline(store);

  let doc = null;      // { title, paragraphs }
  let at = -1;         // paragraph on screen
  let paras = [];      // per paragraph: { clock, words, visits, slow, chat: [{role, content}] }
  let ws = null, busy = false, current = null, serverOn = null; // serverOn: paragraph the server's conversation is about

  // ---- start screen ----
  function paceNote() {
    const { median, samples } = baseline.stats();
    const note = $("paceNote");
    note.replaceChildren();
    if (!samples) return;
    note.append(samples >= P.MIN_SAMPLES && median
      ? `Your usual pace: ${Math.round(median / 1000)} s per 100 words, from ${samples} paragraph${samples > 1 ? "s" : ""}. `
      : `Learning your pace: ${samples} of ${P.MIN_SAMPLES} paragraphs read. `);
    const reset = document.createElement("a");
    reset.href = "#";
    reset.textContent = "Reset";
    reset.onclick = (e) => { e.preventDefault(); baseline.clear(); paceNote(); };
    note.append(reset);
  }

  $("source").oninput = () => { $("startBtn").disabled = !$("source").value.trim(); };
  $("sampleBtn").onclick = (e) => { e.preventDefault(); $("source").value = SAMPLE; begin(); };
  $("startBtn").onclick = begin;
  $("againBtn").onclick = $("newBtn").onclick = () => { leave(); show("start"); };
  try { $("source").value = store?.getItem(TEXT_KEY) || ""; } catch { /* nothing saved */ }
  $("source").oninput();
  paceNote();

  function show(screen) {
    $("start").hidden = screen !== "start";
    $("reader").hidden = $("dock").hidden = screen !== "reader";
    $("finish").hidden = screen !== "finish";
    $("newBtn").hidden = screen !== "reader";
    if (screen === "start") paceNote();
    window.scrollTo(0, 0);
  }

  function begin() {
    const raw = $("source").value;
    doc = P.parseText(raw);
    if (!doc.paragraphs.length) return;
    try { store?.setItem(TEXT_KEY, raw); } catch { /* fine */ }
    paras = doc.paragraphs.map((text) => ({ text, clock: new P.Clock(), words: P.words(text), visits: 0, slow: false, chat: [] }));
    $("title").textContent = doc.title || "";
    $("title").hidden = !doc.title;
    at = -1;
    serverOn = null;
    show("reader");
    go(0);
  }

  // ---- moving between paragraphs ----
  function value(i) { return P.msPer100Words(paras[i].clock.elapsed(), paras[i].words); }

  function leave() {
    if (at < 0 || !paras[at]) return;
    paras[at].clock.stop();
    baseline.record(at, value(at));
    at = -1;
  }

  function go(i) {
    if (!doc) return;
    if (i >= paras.length) return finish();
    i = Math.max(0, i);
    if (i === at) return;
    leave();
    at = i;
    const p = paras[i];
    p.visits++;
    $("where").textContent = `Paragraph ${i + 1} of ${paras.length}`;
    $("title").hidden = !doc.title || i > 0;
    $("para").textContent = p.text;
    $("para").classList.remove("enter");
    void $("para").offsetWidth; // restart the fade
    $("para").classList.add("enter");
    $("count").textContent = `${i + 1} / ${paras.length}`;
    $("bar").style.width = `${((i + 1) / paras.length) * 100}%`;
    $("backBtn").disabled = i === 0;
    $("nextBtn").innerHTML = i === paras.length - 1 ? "Finish &#8250;" : "Next &#8250;";
    renderChat();
    mark();
    if (!document.hidden) p.clock.start();
    window.scrollTo(0, 0);
  }

  // The quiet cue: an amber edge on the paragraph and a short note next to Explain. Never a popup.
  function mark() {
    const p = paras[at];
    if (!p) return;
    if (!p.slow) {
      const { median, samples } = baseline.stats(at);
      p.slow = P.isSlow(value(at), median, samples);
    }
    $("para").classList.toggle("slow", p.slow);
    $("cue").hidden = !p.slow;
    $("explainBtn").classList.toggle("nudge", p.slow);
  }
  setInterval(() => { if (at >= 0 && !$("reader").hidden) mark(); }, 1000);

  function finish() {
    leave();
    const slow = paras.map((p, i) => ({ ...p, i })).filter((p) => p.slow);
    $("finishText").textContent = slow.length
      ? `You read ${paras.length} paragraphs. ${slow.length === 1 ? "This one" : "These"} took you longer than usual:`
      : `You read ${paras.length} paragraphs, none much slower than your usual pace.`;
    $("slowList").replaceChildren(...slow.map((p) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "quiet";
      b.textContent = p.text.length > 110 ? `${p.text.slice(0, 110).trim()}…` : p.text;
      b.onclick = () => { show("reader"); go(p.i); };
      li.append(b);
      return li;
    }));
    show("finish");
  }

  $("backBtn").onclick = () => go(at - 1);
  $("nextBtn").onclick = () => go(at + 1);

  // Scrolling moves between paragraphs once the page itself can't scroll further that way (a long
  // explanation scrolls first). One move per gesture.
  let wheel = 0, lockUntil = 0;
  const atEdge = (down) => down
    ? window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
    : window.scrollY <= 0;
  function nudge(delta) {
    if ($("reader").hidden || Date.now() < lockUntil || !atEdge(delta > 0)) { wheel = 0; return; }
    wheel += delta;
    if (Math.abs(wheel) < 80) return;
    lockUntil = Date.now() + 700;
    const down = wheel > 0;
    wheel = 0;
    go(at + (down ? 1 : -1));
  }
  window.addEventListener("wheel", (e) => { if (!e.target.closest?.(".chat")) nudge(e.deltaY); }, { passive: true });
  let touchY = null;
  window.addEventListener("touchstart", (e) => { touchY = e.touches[0].clientY; }, { passive: true });
  window.addEventListener("touchend", (e) => {
    if (touchY === null) return;
    const dy = touchY - e.changedTouches[0].clientY;
    touchY = null;
    if (Math.abs(dy) > 60) { lockUntil = 0; wheel = 0; nudge(dy > 0 ? 100 : -100); }
  }, { passive: true });
  window.addEventListener("keydown", (e) => {
    if ($("reader").hidden || e.target.closest("input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (["ArrowRight", "ArrowDown", "PageDown", "j"].includes(e.key) || (e.key === " " && !e.shiftKey && !e.target.closest("button"))) { e.preventDefault(); go(at + 1); }
    else if (["ArrowLeft", "ArrowUp", "PageUp", "k"].includes(e.key)) { e.preventDefault(); go(at - 1); }
  });

  // Only active, visible time counts (study-pace.js Clock).
  for (const ev of ["scroll", "keydown", "pointermove", "pointerdown", "wheel", "touchstart"]) {
    window.addEventListener(ev, () => paras[at]?.clock.poke(), { passive: true });
  }
  document.addEventListener("visibilitychange", () => {
    const c = paras[at]?.clock;
    if (!c) return;
    if (document.hidden) c.stop(); else c.start();
  });
  window.addEventListener("pagehide", () => { if (at >= 0) { paras[at].clock.stop(); baseline.record(at, value(at)); paras[at].clock.start(); } });

  // ---- the tutor (/ws/chat, owned by the side chat; see .graph/CONTRACTS.md) ----
  async function checkStatus() {
    try {
      const s = await (await fetch("/api/tutor")).json();
      $("tutorStatus").textContent = s.ready ? `Local model: ${s.model}` : s.error;
      $("tutorStatus").classList.toggle("warn", !s.ready);
    } catch {
      $("tutorStatus").textContent = "Can't reach the companion app.";
    }
  }

  function connect() {
    return new Promise((resolve) => {
      if (ws && ws.readyState === WebSocket.OPEN) return resolve(ws);
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/chat`);
      ws.onopen = () => resolve(ws);
      ws.onmessage = (ev) => onEvent(JSON.parse(ev.data));
      ws.onclose = () => { ws = null; serverOn = null; if (busy) onEvent({ type: "error", message: "Lost contact with the companion app." }); };
    });
  }

  function bubble(role, text = "") {
    const el = document.createElement("div");
    el.className = `msg ${role}`;
    el.textContent = text;
    $("chat").append(el);
    return el;
  }

  // Each paragraph keeps its own conversation; the one on screen is drawn here.
  function renderChat() {
    const p = paras[at];
    $("chat").replaceChildren();
    for (const m of p.chat) {
      const el = bubble(m.role === "user" ? "user" : "tutor", m.shown || m.content);
      if (m.error) el.replaceChildren(errorText(m.content));
      if (m === current?.msg) { current.el = el; el.classList.add("typing"); }
    }
    $("tutor").hidden = !p.chat.length;
    $("askForm").hidden = busy || !p.chat.some((m) => m.role === "assistant" && !m.error);
  }

  function errorText(msg) {
    const s = document.createElement("span");
    s.className = "error";
    s.textContent = msg;
    return s;
  }

  function onEvent(e) {
    if (!current) return;
    const { msg, para } = current;
    if (e.type === "start") return;
    if (e.type === "token") {
      msg.content += e.text;
      if (current.el?.isConnected) current.el.textContent = msg.content;
      return;
    }
    if (e.type === "done" || e.type === "error") {
      if (e.type === "error") { msg.content = e.message; msg.error = true; checkStatus(); }
      current.el?.classList.remove("typing");
      // The companion drops a failed turn from its history, so drop the question here too and keep
      // just the error to show.
      if (e.type === "error") para.chat.splice(para.chat.indexOf(msg) - 1, 1);
      current = null;
      busy = false;
      $("explainBtn").disabled = false;
      $("askBtn").disabled = false;
      if (para === paras[at]) renderChat();
    }
  }

  async function send(msg, shown) {
    if (busy) return;
    busy = true;
    $("explainBtn").disabled = true;
    $("askBtn").disabled = true;
    const p = paras[at];
    p.chat.push({ role: "user", content: msg.text || msg.paragraph, shown });
    const reply = { role: "assistant", content: "" };
    p.chat.push(reply);
    current = { msg: reply, para: p, el: null };
    renderChat();
    $("tutor").scrollIntoView({ block: "nearest", behavior: "smooth" });
    const sock = await connect();
    // A follow-up on a paragraph the server isn't on: give it that paragraph's conversation back first.
    if (msg.type === "ask" && serverOn !== at && p.chat.length > 2) {
      const past = p.chat.slice(0, -2).filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
      sock.send(JSON.stringify({ type: "load", messages: past, mode: "explain", title: doc.title || undefined }));
    }
    sock.send(JSON.stringify(msg));
    serverOn = at;
  }

  $("explainBtn").onclick = () => {
    const p = paras[at];
    if (!p || busy) return;
    p.chat = [];
    const { median, samples } = baseline.stats(at);
    const dwell = value(at);
    const msg = { type: "explain", paragraph: p.text, index: at };
    if (doc.title) msg.title = doc.title;
    // What study mode measured goes along so the tutor can pitch the explanation (companion/tutor.py).
    if (dwell) msg.dwellMsPer100Words = dwell;
    if (median && samples >= P.MIN_SAMPLES) msg.medianMsPer100Words = median;
    if (p.visits > 1) msg.rereads = p.visits - 1;
    checkStatus();
    send(msg, `Explain paragraph ${at + 1}`);
  };
  $("doneBtn").onclick = () => { $("tutor").hidden = true; };
  $("askForm").onsubmit = (ev) => {
    ev.preventDefault();
    const text = $("askInput").value.trim();
    if (!text) return;
    $("askInput").value = "";
    send({ type: "ask", text }, text);
  };

  // Test hook (tests/study): read-only view of the state.
  window.studyState = () => ({ at, slow: paras.map((p) => p.slow), baseline: baseline.values(), stats: baseline.stats(at) });
})();
