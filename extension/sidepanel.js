// The side chat. Each page (its address without the #part) has its own conversation, saved in the
// extension's storage, so coming back to a page, switching tabs or reopening the panel picks it up
// again. Answers stream from the local tutor over the companion's /ws/chat; on a new socket or a
// different page the conversation is loaded into the companion first ({"type": "load"}).
const COMPANION = "127.0.0.1:8765";
const KEEP = 60;            // conversations kept; the oldest go first
const PAGE_CHARS = 6000;    // how much of the page goes along with the first question
const $ = (id) => document.getElementById(id);

let ws = null, synced = null;            // socket, and the page whose conversation it holds
let busy = false, turn = null, queued = [];
let tab = null;                          // {id, url, title} of the tab the panel is following
let conv = null;                         // {key, url, title, mode, messages: [{role, content, shown}]}
// Study mode's side-chat features (study/panel.js) hook in here: `done` runs after each answer is
// saved, `pending` handles hand-offs with a `kind`, and `wrapAsk` can reword a typed message.
const hooks = { done: [], pending: {}, wrapAsk: null };

// ---------- conversations ----------
const keyOf = (url) => { try { const u = new URL(url); u.hash = ""; return u.href; } catch { return url || "none"; } };

async function load(url, title) {
  const key = keyOf(url);
  const stored = (await chrome.storage.local.get(`conv:${key}`))[`conv:${key}`];
  return stored || { key, url, title, mode: "chat", messages: [], updated: 0 };
}

async function save() {
  if (!conv.messages.length) { await chrome.storage.local.remove(`conv:${conv.key}`); return; }
  conv.updated = Date.now();
  await chrome.storage.local.set({ [`conv:${conv.key}`]: conv });
  const all = Object.entries(await chrome.storage.local.get(null)).filter(([k]) => k.startsWith("conv:"));
  if (all.length > KEEP) {
    all.sort((a, b) => a[1].updated - b[1].updated);
    await chrome.storage.local.remove(all.slice(0, all.length - KEEP).map(([k]) => k));
  }
}

async function follow(t) {
  if (!t || !t.url || t.url.startsWith(`chrome-extension://${chrome.runtime.id}`)) return;
  if (busy) { tab = t; return; } // switch once the current answer finishes
  tab = t;
  if (conv && conv.key === keyOf(t.url)) { showPage(); return; }
  conv = await load(t.url, t.title);
  render();
}

// ---------- rendering ----------
function showPage() {
  const title = (tab && tab.title) || (conv && conv.title) || "";
  $("page").hidden = !title;
  $("pageTitle").textContent = title;
}

function render() {
  $("log").replaceChildren($("empty"));
  $("empty").hidden = conv.messages.length > 0;
  $("newBtn").hidden = !conv.messages.length;
  for (const m of conv.messages) {
    if (m.role === "user") addUser(m.shown || { text: m.content });
    else { const t = addTutor(); t.answer.innerHTML = renderMarkdown(m.content); t.copy(); }
  }
  showPage();
  $("log").scrollTop = $("log").scrollHeight;
}

function addUser(shown) {
  const el = document.createElement("div");
  el.className = "turn-user";
  if (shown.quote) el.append(Object.assign(document.createElement("div"), { className: "quote", textContent: shown.quote }));
  // Study mode's look-back: the earlier paragraphs that went along with this one.
  if (shown.also?.length) el.append(Object.assign(document.createElement("div"), { className: "also", textContent: `Also sent: ${shown.also.map((i) => `¶${i}`).join(", ")}` }));
  if (shown.text) el.append(Object.assign(document.createElement("div"), { className: "bubble", textContent: shown.text }));
  $("log").append(el);
  el.scrollIntoView({ block: "end" });
}

function addTutor() {
  const el = document.createElement("div");
  el.className = "turn-tutor";
  el.innerHTML = `<span class="spark" aria-hidden="true"></span><div class="answer"></div>`;
  $("log").append(el);
  const answer = el.querySelector(".answer");
  const copy = () => {
    const bar = document.createElement("div");
    bar.className = "actions";
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: "Copy" });
    b.onclick = () => navigator.clipboard.writeText(answer.innerText).then(() => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1200); });
    bar.append(b);
    el.append(bar);
  };
  return { el, answer, copy };
}

// ---------- talking to the companion ----------
function setStatus(text, warn = false) {
  $("status").textContent = text || "";
  $("status").classList.toggle("warn", warn);
}

async function checkStatus() {
  try {
    const s = await (await fetch(`http://${COMPANION}/api/tutor`)).json();
    setStatus(s.ready ? "" : s.error, !s.ready);
  } catch {
    setStatus("NeuroChat isn't running. Open a terminal and type: neurochat", true);
  }
}

function connect() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) return resolve(ws);
    const sock = new WebSocket(`ws://${COMPANION}/ws/chat`);
    sock.onopen = () => { ws = sock; synced = null; resolve(sock); };
    sock.onerror = () => reject(new Error("closed"));
    sock.onmessage = (ev) => onEvent(JSON.parse(ev.data));
    sock.onclose = () => {
      if (ws === sock) { ws = null; synced = null; }
      if (busy) onEvent({ type: "error", message: "Lost contact with NeuroChat. Is it still running?" });
    };
  });
}

function onEvent(e) {
  if (e.type === "loaded") return;
  if (e.type === "start") return;
  if (e.type === "token") {
    turn.text += e.text;
    turn.answer.innerHTML = renderMarkdown(turn.text);
    $("log").scrollTop = $("log").scrollHeight;
  } else if (e.type === "done" || e.type === "error") finish(e);
}

function finish(e) {
  const t = turn;
  turn = null;
  busy = false;
  $("askBtn").disabled = false;
  if (t) {
    t.el.classList.remove("typing");
    if (e.type === "done") {
      t.copy();
      t.conv.messages.push({ role: "assistant", content: t.text });
    } else {
      t.answer.replaceChildren(Object.assign(document.createElement("span"), { className: "error", textContent: e.message }));
      t.conv.messages.pop(); // the question goes back out of the history, like on the companion
      checkStatus();
    }
    const saved = t.conv === conv ? save() : saveOther(t.conv);
    saved.finally(() => { for (const f of hooks.done) try { f(t, e); } catch (err) { console.error(err); } });
  }
  if (tab && conv && keyOf(tab.url) !== conv.key) follow(tab);
  else if (queued.length) { const next = queued.shift(); next(); }
}

async function saveOther(c) {
  c.updated = Date.now();
  await chrome.storage.local.set({ [`conv:${c.key}`]: c });
}

// Send one user turn. content goes to the model; shown is what the chat displays; meta rides along
// to the done hooks.
async function send(msg, content, shown, meta) {
  if (busy) { queued.push(() => send(msg, content, shown, meta)); return; }
  busy = true;
  $("askBtn").disabled = true;
  $("empty").hidden = true;
  $("newBtn").hidden = false;
  conv.messages.push({ role: "user", content, shown });
  addUser(shown);
  const t = addTutor();
  t.el.classList.add("typing");
  turn = { ...t, text: "", conv, meta };
  try {
    const sock = await connect();
    if (synced !== conv.key) {
      sock.send(JSON.stringify({ type: "load", mode: conv.mode, title: conv.title, messages: conv.messages.slice(0, -1).map(({ role, content }) => ({ role, content })) }));
      synced = conv.key;
    }
    sock.send(JSON.stringify(msg));
  } catch {
    finish({ type: "error", message: "Can't reach NeuroChat. Open a terminal and type: neurochat" });
  }
}

async function pageText() {
  if (!tab) return null;
  try { return await chrome.tabs.sendMessage(tab.id, { type: "neurochat:page" }); } catch { return null; }
}

// A question. The first one in a conversation takes the page's text along, so "what does this mean"
// has something to go on.
async function ask(text, shownText = text, meta) {
  let content = text;
  if (!conv.messages.length && !meta?.study) { // study mode's questions carry their paragraph already
    const page = await pageText();
    if (page && page.text) {
      content = `I'm reading "${page.title}". Here is the page:\n\n"""${page.text.slice(0, PAGE_CHARS)}"""\n\n${text}`;
    }
  }
  send({ type: "ask", text: content, ...(meta?.task ? { task: true } : {}) }, content, { text: shownText }, meta);
}

// Explain a selection or a paragraph. On a page that already has a conversation it carries on there.
async function explain(req) {
  if (req.url && (!conv || keyOf(req.url) !== conv.key)) {
    if (busy) { queued.push(() => explain(req)); return; }
    tab = { ...(tab || {}), url: req.url, title: req.title };
    conv = await load(req.url, req.title);
    render();
  }
  const append = conv.messages.length > 0;
  if (!append) conv.mode = "explain";
  const msg = { type: "explain", paragraph: req.text, context: req.context, title: req.title, rereads: req.rereads, append };
  // Study mode's pace numbers (study/study-content.js), so the tutor can pitch the explanation.
  if (req.dwellMsPer100Words) msg.dwellMsPer100Words = req.dwellMsPer100Words;
  if (req.medianMsPer100Words) msg.medianMsPer100Words = req.medianMsPer100Words;
  // Study mode's look-back: earlier paragraphs in the same section that also slowed the reader.
  const earlier = Array.isArray(req.earlier) ? req.earlier.slice(0, 3) : [];
  if (earlier.length) msg.earlier = earlier.map((e) => e.text);
  // What the companion builds from this; kept here so the conversation can be restored later.
  let content = `I got stuck on this part${req.title ? ` in a text titled "${req.title}"` : ""}. Can you explain it differently?\n\n"""${req.text}"""` +
    (req.context && req.context.trim() !== req.text.trim() ? `\n\nIt's from this paragraph:\n\n"""${req.context}"""` : "");
  if (earlier.length) {
    content = `Earlier in the same section I also slowed down on:\n\n${earlier.map((e, i) => `(earlier ${i + 1}) """${e.text}"""`).join("\n\n")}\n\n${content}` +
      "\n\nExplain the one I'm stuck on now. If one of the earlier ones is the real gap, say so in one sentence first.";
  }
  send(msg, content, { quote: req.text, text: "Explain this", also: earlier.map((e) => e.index) }, req.key ? { ...req, study: "explain" } : undefined);
}

const CHIPS = {
  summarize: ["Summarize this page in a few short bullet points, then say in one sentence what it's mainly about.", "Summarize this page"],
  simple: ["Explain the main idea of this page simply, as if I'm new to the topic. Use one everyday analogy.", "Explain the main idea simply"],
  quiz: ["Ask me three short questions to check I understood this page, one at a time. Start with the first one.", "Quiz me on it"],
};

// ---------- wiring ----------
async function takePending() {
  const { pending } = await chrome.storage.session.get("pending");
  if (!pending) return;
  await chrome.storage.session.remove("pending");
  if (Date.now() - pending.at >= 60_000) return;
  if (pending.kind && hooks.pending[pending.kind]) hooks.pending[pending.kind](pending); else explain(pending);
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.pending?.newValue) takePending();
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => follow(await chrome.tabs.get(tabId)));
chrome.tabs.onUpdated.addListener((tabId, info, t) => {
  if (tab && tabId === tab.id && t.active && (info.url || info.title)) follow(t);
});

$("chips").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-ask]");
  if (b && !busy) ask(...CHIPS[b.dataset.ask]);
});

const input = $("askInput");
const grow = () => { input.style.height = "auto"; input.style.height = `${input.scrollHeight}px`; };
input.addEventListener("input", grow);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("ask").requestSubmit(); }
});
$("ask").onsubmit = (ev) => {
  ev.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = "";
  grow();
  ask(...(hooks.wrapAsk?.(text) || [text]));
};

$("newBtn").onclick = async () => {
  if (busy) return;
  conv.messages = [];
  conv.mode = "chat";
  synced = null;
  await save();
  render();
};

(async () => {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  await follow(t);
  if (!conv) { conv = { key: "none", url: "", title: "", mode: "chat", messages: [], updated: 0 }; render(); }
  checkStatus();
  setInterval(() => { if (!busy) checkStatus(); }, 10_000);
  takePending();
})();
