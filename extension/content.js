// NeuroChat on any page: an "Explain" button next to text you select, and the selection plus
// the paragraph around it for the side chat (also used by the right-click menu and the shortcut).
// When eye tracking (extension/gaze/) says you're stuck on a paragraph, it offers to explain it.
(() => {
  const MIN = 2, MAX = 4000;

  function paragraphOf(node) {
    let el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    while (el && el !== document.body) {
      if (/^(P|LI|BLOCKQUOTE|TD|DD|DT|PRE|FIGCAPTION|H[1-6])$/.test(el.tagName)) break;
      if (getComputedStyle(el).display === "block" && el.innerText.trim().length > 80) break;
      el = el.parentElement;
    }
    return el && el !== document.body ? el.innerText.trim().slice(0, MAX) : "";
  }

  function selection() {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    if (text.length < MIN) return null;
    return {
      text: text.slice(0, MAX),
      context: paragraphOf(sel.anchorNode),
      title: document.title,
      url: location.href,
    };
  }

  // The readable text of the page, for "Summarize this page" and questions about it.
  function pageText() {
    const main = document.querySelector("article, main, [role=main]") || document.body;
    const text = (main.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
    return { title: document.title, url: location.href, text: text.slice(0, 12000) };
  }

  // The floating button, in a shadow root so the page's styles can't reach it.
  const host = document.createElement("neurochat-pill");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    button { all: initial; position: fixed; z-index: 2147483647; display: none; align-items: center; gap: 6px;
      padding: 6px 12px 6px 10px; border-radius: 999px; cursor: pointer; white-space: nowrap;
      font: 500 13px/1.2 -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", system-ui, sans-serif;
      color: #fff; background: #0b0d12; box-shadow: 0 6px 20px rgba(20, 30, 60, .25), inset 0 1px 0 rgba(255, 255, 255, .15); }
    button:hover { background: #262a33; }
    button.on { display: inline-flex; }
    i { width: 7px; height: 7px; border-radius: 50%; background: #fff; opacity: .85; }
    .offer { position: absolute; z-index: 2147483647; display: none; align-items: center; gap: 4px; padding: 4px 4px 4px 12px;
      border-radius: 999px; background: rgba(255, 255, 255, .92); border: 1px solid rgba(11, 13, 18, .1);
      box-shadow: 0 8px 26px rgba(20, 30, 60, .18);
      font: 500 13px/1.2 -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", system-ui, sans-serif; color: #0b0d12; }
    .offer.on { display: inline-flex; }
    .offer button { position: static; display: inline-flex; padding: 5px 12px; }
    .offer button.x { background: transparent; color: #4b5260; box-shadow: none; padding: 5px 9px; }
    .offer button.x:hover { background: rgba(11, 13, 18, .06); }
  </style><button type="button" id="pill" aria-label="Explain the selected text with NeuroChat"><i></i>Explain</button>
  <div class="offer" id="offer" role="dialog" aria-label="NeuroChat">
    <span>Stuck here?</span>
    <button type="button" id="offerYes">Explain</button>
    <button type="button" class="x" id="offerNo" aria-label="Not now">✕</button>
  </div>`;
  const pill = root.getElementById("pill");
  let pending = null;

  function hide() { pill.classList.remove("on"); pending = null; }

  function showFor(sel) {
    const range = window.getSelection().getRangeAt(0);
    const r = range.getBoundingClientRect();
    if (!r.width && !r.height) return hide();
    pending = sel;
    pill.classList.add("on");
    const w = pill.offsetWidth || 90;
    pill.style.left = `${Math.min(Math.max(8, r.right - w), innerWidth - w - 8)}px`;
    pill.style.top = `${r.bottom + 8 + 32 > innerHeight ? Math.max(8, r.top - 40) : r.bottom + 8}px`;
  }

  document.addEventListener("mouseup", (e) => {
    if (e.composedPath().includes(host)) return;
    setTimeout(() => {
      const sel = selection();
      // In study mode a selection in the lit paragraph gets study mode's own "Explain selection".
      const s = window.getSelection(), inLit = (n) => n?.parentElement?.closest(".neurochat-current");
      const lit = document.documentElement.hasAttribute("data-neurochat-selection") && inLit(s.anchorNode) && inLit(s.anchorNode) === inLit(s.focusNode);
      sel && !lit ? showFor(sel) : hide();
    }, 0);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  addEventListener("scroll", hide, { passive: true });

  pill.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
  pill.addEventListener("click", () => {
    if (!pending) return;
    chrome.runtime.sendMessage({ type: "neurochat:explain", request: pending }).catch(() => {});
    hide();
  });

  // Offer to explain a paragraph eye tracking says you're stuck on. gaze/gaze-content.js sends
  // window "neurochat:slow" with {index, text, dwellMsPer100Words, rereads, element}.
  const offer = root.getElementById("offer");
  const declined = new Set();
  let offered = null;

  function hideOffer() { offer.classList.remove("on"); offered = null; }

  addEventListener("neurochat:slow", (e) => {
    const d = e.detail || {};
    if (!d.text || offered || declined.has(d.text)) return;
    offered = d;
    offer.classList.add("on");
    const r = d.element?.getBoundingClientRect();
    const w = offer.offsetWidth || 200;
    offer.style.left = `${scrollX + (r ? Math.min(r.right - w, innerWidth - w - 8) : innerWidth - w - 16)}px`;
    offer.style.top = `${scrollY + (r ? Math.max(8, r.top - offer.offsetHeight - 6) : 16)}px`;
  });
  root.getElementById("offerYes").addEventListener("click", () => {
    if (!offered) return;
    chrome.runtime.sendMessage({ type: "neurochat:explain", request: {
      text: offered.text.slice(0, MAX), title: document.title, url: location.href,
      dwellMsPer100Words: offered.dwellMsPer100Words, rereads: offered.rereads,
    } }).catch(() => {});
    hideOffer();
  });
  root.getElementById("offerNo").addEventListener("click", () => { if (offered) declined.add(offered.text); hideOffer(); });

  document.documentElement.append(host); // not body: a positioned body would shift the offer

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === "neurochat:selection") reply(selection());
    if (msg.type === "neurochat:page") reply(pageText());
  });
})();
