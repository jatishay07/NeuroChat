// Study mode's part of the background service worker (imported by background.js).
// - One-off questions to the tutor that aren't part of the side chat's conversation (a plainer
//   rewrite of a paragraph, definitions of key terms): a port named "neurochat:oneshot" sends
//   {prompt}, gets {type: "token", text}... then {type: "done"} or {type: "error", message}.
// - Key terms a page in study mode found, and their definitions once the tutor has given them, kept
//   per tab for the side chat ("terms:<tabId>").
// - "One question on ¶4?" from the page opens the side chat on a check-back question.
const STUDY_COMPANION = "ws://127.0.0.1:8765/ws/chat";

function oneshot(prompt, emit) {
  let ws;
  try { ws = new WebSocket(STUDY_COMPANION); } catch { emit({ type: "error", message: "Can't reach NeuroChat. Open a terminal and type: neurochat" }); return () => {}; }
  let ended = false;
  const end = (m) => { if (ended) return; ended = true; emit(m); try { ws.close(); } catch { /* already closed */ } };
  // A fresh socket has no history, so the companion answers it as a plain chat, not the page's conversation.
  ws.onopen = () => ws.send(JSON.stringify({ type: "ask", text: prompt, task: true }));
  ws.onmessage = (ev) => {
    const e = JSON.parse(ev.data);
    if (e.type === "token") emit(e);
    else if (e.type === "done" || e.type === "error") end(e);
  };
  ws.onerror = () => end({ type: "error", message: "Can't reach NeuroChat. Open a terminal and type: neurochat" });
  ws.onclose = () => end({ type: "error", message: "Lost contact with NeuroChat. Is it still running?" });
  return () => { ended = true; try { ws.close(); } catch { /* already closed */ } };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "neurochat:oneshot") return;
  let cancel = () => {};
  port.onMessage.addListener((m) => {
    if (typeof m?.prompt !== "string") return;
    cancel = oneshot(m.prompt.slice(0, 8000), (e) => { try { port.postMessage(e); } catch { cancel(); } });
  });
  port.onDisconnect.addListener(() => cancel());
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "neurochat:terms" && sender.tab) {
    chrome.storage.session.set({ [`terms:${sender.tab.id}`]: { terms: msg.terms.slice(0, 5), url: msg.url, title: msg.title, defs: msg.defs || null } });
    return;
  }
  if (msg.type === "neurochat:check" && sender.tab) {
    openPanel(sender.tab).then(() => reply({ ok: true }), (e) => reply({ ok: false, error: String(e) }));
    handOff({ ...msg.request, kind: "check" });
    return true;
  }
});
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(`terms:${tabId}`));
