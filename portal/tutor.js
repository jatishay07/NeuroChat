// Tutor chat on the reading page: offers to re-explain a paragraph the reader was slow on,
// streams the local model's answer over /ws/chat, and takes follow-up questions.
// "Continue in Open WebUI" copies the conversation into Open WebUI to carry on there.
// Also used on chat.html, the chat without eye tracking (no paragraphs, just questions).
(() => {
  const $ = (id) => document.getElementById(id);
  const title = () => document.querySelector("#text h1")?.textContent.trim();
  let ws = null, busy = false, current = null, offered = null, webui = false;
  const declined = new Set();

  // The hand-off button, added here so the reading page's markup doesn't need to change.
  const more = document.createElement("button");
  more.type = "button";
  more.className = "quiet webui-btn";
  more.textContent = "Continue in Open WebUI";
  more.hidden = true;
  more.onclick = async () => {
    more.disabled = true;
    more.textContent = "Opening Open WebUI…";
    (await connect()).send(JSON.stringify({ type: "continue" }));
  };
  $("askForm").after(more);
  const showMore = () => { more.hidden = !webui || !$("chat").children.length; };

  async function checkWebUI() {
    try { webui = (await (await fetch("/api/webui")).json()).ready; } catch { webui = false; }
    showMore();
  }

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
      ws.onclose = () => { ws = null; if (busy) onEvent({ type: "error", message: "Lost contact with the companion app." }); };
    });
  }

  function bubble(role, text = "") {
    const el = document.createElement("div");
    el.className = `msg ${role}`;
    el.textContent = text;
    $("chat").append(el);
    el.scrollIntoView({ block: "nearest" });
    return el;
  }

  function onEvent(e) {
    if (e.type === "continued") {
      more.disabled = false;
      more.textContent = "Continue in Open WebUI";
      window.open(e.url, "_blank", "noopener");
    } else if (e.type === "start") {
      current = bubble("tutor");
      current.classList.add("typing");
    } else if (e.type === "token") {
      current.textContent += e.text;
      current.scrollIntoView({ block: "nearest" });
    } else if (e.type === "done" || e.type === "error") {
      if (e.type === "error") (current || bubble("tutor")).replaceChildren(errorText(e.message));
      current?.classList.remove("typing");
      current = null;
      busy = false;
      $("askBtn").disabled = false;
      $("askForm").hidden = false;
      more.disabled = false;
      more.textContent = "Continue in Open WebUI";
      showMore();
      if (e.type === "error") { checkStatus(); checkWebUI(); }
    }
  }

  function errorText(msg) {
    const s = document.createElement("span");
    s.className = "error";
    s.textContent = msg;
    return s;
  }

  async function send(msg, shown) {
    if (busy) return;
    busy = true;
    $("askBtn").disabled = true;
    bubble("user", shown);
    (await connect()).send(JSON.stringify(msg));
  }

  function explain({ index, text, dwellMsPer100Words, medianMsPer100Words, rereads }) {
    $("offer").hidden = true;
    offered = null;
    $("chat").replaceChildren(); // a new paragraph starts a new conversation
    // What the eye tracker measured goes along, so the tutor can pitch the explanation (companion/tutor.py).
    send({ type: "explain", paragraph: text, title: title(), index, dwellMsPer100Words, medianMsPer100Words, rereads }, `Explain paragraph ${index + 1}`);
  }

  function offer(detail) {
    if (busy || declined.has(detail.index) || offered) return;
    offered = detail;
    $("offerText").textContent = `Paragraph ${detail.index + 1} seemed to take you a while. Want it explained another way?`;
    $("offer").hidden = false;
  }

  window.addEventListener("paragraph:slow", (e) => offer(e.detail));
  window.addEventListener("paragraph:explain", (e) => explain(e.detail));
  $("offerYes").onclick = () => offered && explain(offered);
  $("offerNo").onclick = () => { declined.add(offered.index); offered = null; $("offer").hidden = true; };
  $("askForm").onsubmit = (ev) => {
    ev.preventDefault();
    const text = $("askInput").value.trim();
    if (!text) return;
    $("askInput").value = "";
    send({ type: "ask", text }, text);
  };
  checkStatus();
  checkWebUI();
})();
