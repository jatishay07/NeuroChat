// The side chat: explains what you selected on the page with the local tutor (the companion's
// /ws/chat), and takes follow-up questions. A new "Explain" starts a new conversation.
const COMPANION = "127.0.0.1:8765";
const $ = (id) => document.getElementById(id);
let ws = null, busy = false, current = null, queued = null;

function setStatus(text, warn = false) {
  $("status").textContent = text || "";
  $("status").classList.toggle("warn", warn);
}

async function checkStatus() {
  try {
    const s = await (await fetch(`http://${COMPANION}/api/tutor`)).json();
    setStatus(s.ready ? "" : s.error, !s.ready);
    return true;
  } catch {
    setStatus("NeuroChat isn't running. Open a terminal and type: neurochat", true);
    return false;
  }
}

function connect() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) return resolve(ws);
    const sock = new WebSocket(`ws://${COMPANION}/ws/chat`);
    sock.onopen = () => { ws = sock; resolve(sock); };
    sock.onerror = () => reject(new Error("closed"));
    sock.onmessage = (ev) => onEvent(JSON.parse(ev.data));
    sock.onclose = () => {
      if (ws === sock) ws = null;
      if (busy) onEvent({ type: "error", message: "Lost contact with NeuroChat. Is it still running?" });
    };
  });
}

function add(cls, text = "") {
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = text;
  $("log").append(el);
  el.scrollIntoView({ block: "end" });
  return el;
}

function onEvent(e) {
  if (e.type === "start") {
    current = add("msg tutor typing");
  } else if (e.type === "token") {
    current.textContent += e.text;
    current.scrollIntoView({ block: "end" });
  } else if (e.type === "done" || e.type === "error") {
    if (e.type === "error") {
      const span = document.createElement("span");
      span.className = "error";
      span.textContent = e.message;
      (current || add("msg tutor")).replaceChildren(span);
      checkStatus();
    }
    current?.classList.remove("typing");
    current = null;
    busy = false;
    $("askBtn").disabled = false;
    if (queued) { const q = queued; queued = null; explain(q); }
  }
}

async function send(msg) {
  busy = true;
  $("askBtn").disabled = true;
  $("empty").hidden = true;
  $("newBtn").hidden = false;
  try {
    (await connect()).send(JSON.stringify(msg));
  } catch {
    busy = false;
    $("askBtn").disabled = false;
    add("msg tutor").replaceChildren(Object.assign(document.createElement("span"), {
      className: "error", textContent: "Can't reach NeuroChat. Open a terminal and type: neurochat" }));
    checkStatus();
  }
}

function reset() {
  ws?.close(); // a fresh socket is a fresh conversation on the companion
  ws = null;
  current = null;
  busy = false;
  $("askBtn").disabled = false;
  $("log").replaceChildren($("empty"));
  $("empty").hidden = false;
  $("newBtn").hidden = true;
}

function explain(req) {
  if (busy) { queued = req; return; } // wait for the current answer, then start the new one
  reset();
  const quote = add("quote", req.text);
  if (req.title) quote.append(Object.assign(document.createElement("small"), { textContent: req.title }));
  send({ type: "explain", paragraph: req.text, context: req.context, title: req.title });
}

// Requests from the page (Explain button, right-click menu, shortcut) arrive through session storage.
async function takePending() {
  const { pending } = await chrome.storage.session.get("pending");
  if (!pending) return;
  await chrome.storage.session.remove("pending");
  if (Date.now() - pending.at < 60_000) explain(pending);
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.pending?.newValue) takePending();
});

$("ask").onsubmit = (ev) => {
  ev.preventDefault();
  const text = $("askInput").value.trim();
  if (!text || busy) return;
  $("askInput").value = "";
  add("msg user", text);
  send({ type: "ask", text });
};
$("newBtn").onclick = reset;

checkStatus();
setInterval(() => { if (!busy) checkStatus(); }, 10_000);
takePending();
