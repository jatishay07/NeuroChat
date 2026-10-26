// NeuroChat on any page: an "Explain" button next to text you select, and the selection plus
// the paragraph around it for the side chat (also used by the right-click menu and the shortcut).
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
  </style><button type="button" aria-label="Explain the selected text with NeuroChat"><i></i>Explain</button>`;
  const pill = root.querySelector("button");
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
    setTimeout(() => { const sel = selection(); sel ? showFor(sel) : hide(); }, 0);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  addEventListener("scroll", hide, { passive: true });

  pill.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
  pill.addEventListener("click", () => {
    if (!pending) return;
    chrome.runtime.sendMessage({ type: "neurochat:explain", request: pending }).catch(() => {});
    hide();
  });

  (document.body || document.documentElement).append(host);

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === "neurochat:selection") reply(selection());
  });
})();
