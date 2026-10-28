// Study mode's features in the side chat, loaded after sidepanel.js and using its hooks and
// functions (ask, load, render, keyOf, conv, tab):
// - "Got it" / "Still lost" under an explanation study mode asked for: the only ground truth for
//   whether a slow flag was right (and "Still lost" asks for another way of putting it);
// - "Plainer on the page": the paragraph rewritten in plain words where it is;
// - check-back questions: one question on a paragraph you struggled with, answered in your own words,
//   marked by the tutor and asked again after 1, 3 and 7 days;
// - "Before you read": the page's key terms, defined when you open it.
(() => {
  const M = self.StudyModel;
  const LABELS = "neurochat.study.l:", REVIEW = "neurochat.study.r:", RATIO = "neurochat.study.ratio", FLAGS = "neurochat.study.features";
  let flags = {};
  const has = (f) => flags[f] !== false && (f !== "simulator" || flags[f]);
  chrome.storage.local.get(FLAGS).then((s) => (flags = s[FLAGS] || {}));
  chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c[FLAGS]) flags = c[FLAGS].newValue || {}; });

  const style = document.createElement("style");
  style.textContent = `
    .turn-user .also { align-self: flex-end; margin-top: 4px; font-size: 12px; color: #8a8f99; }
    .turn-tutor .actions .study { color: #0b0d12; }
    .turn-tutor .actions .noted { font-size: 12px; color: #8a8f99; padding: 4px 6px; }
    #study { display: flex; flex-direction: column; gap: 6px; margin: 0 2px 8px; font-size: 13px; }
    #study[hidden], #study [hidden] { display: none; }
    #study details { border: 1px solid rgba(11, 13, 18, .08); background: rgba(255, 255, 255, .7); border-radius: 14px; padding: 8px 12px; }
    #study summary { cursor: pointer; color: #4b5260; list-style: none; }
    #study summary::-webkit-details-marker { display: none; }
    #study summary b { color: #0b0d12; font-weight: 600; }
    #study .defs { margin-top: 6px; color: #0b0d12; line-height: 1.45; }
    #study .defs p { margin: 4px 0; }
    #study button { align-self: flex-start; border: 1px solid rgba(11, 13, 18, .08); background: rgba(255, 255, 255, .7); border-radius: 999px; padding: 6px 12px; font: inherit; color: #0b0d12; cursor: pointer; }`;
  document.head.append(style);
  const box = document.createElement("div");
  box.id = "study";
  box.innerHTML = `<details id="terms" hidden><summary><b>Before you read</b> · <span id="termList"></span></summary><div class="defs" id="defs">Defining…</div></details><button type="button" id="due" hidden></button>`;
  document.querySelector("footer").insertBefore(box, document.getElementById("ask"));
  const $ = (id) => document.getElementById(id);

  // The tab showing a page (the panel may know the page only by its address).
  async function tabFor(url) {
    if (tab?.id && keyOf(tab.url) === keyOf(url)) return tab.id;
    return (await chrome.tabs.query({})).find((t) => t.url && keyOf(t.url) === keyOf(url))?.id;
  }

  // ---- under an explanation: Got it / Still lost / Plainer on the page ----
  function button(text, onclick) {
    return Object.assign(document.createElement("button"), { type: "button", className: "study", textContent: text, onclick });
  }
  async function label(meta, value) {
    await chrome.storage.local.set({ [LABELS + meta.key]: { label: value, flagged: !!meta.flagged, t: Date.now() } });
    // Lost on a paragraph that wasn't flagged: the flag should have come sooner.
    if (has("tune") && value === "lost" && !meta.flagged) {
      const r = (await chrome.storage.local.get(RATIO))[RATIO];
      await chrome.storage.local.set({ [RATIO]: M.tune(r, "miss") });
    }
  }
  hooks.done.push((t, e) => {
    if (e.type !== "done" || !t.meta) return;
    const m = t.meta, bar = t.el.querySelector(".actions");
    if (m.study === "explain" && bar) {
      if (has("labels")) {
        const got = button("Got it", () => { label(m, "got"); noted("Noted: got it"); });
        const lost = button("Still lost", () => {
          label(m, "lost");
          noted("Noted: still lost");
          ask("That still doesn't click for me. Explain it a different way: simpler, with one concrete example.", "Still lost", { ...m, study: "again" });
        });
        const noted = (text) => { got.remove(); lost.remove(); bar.append(Object.assign(document.createElement("span"), { className: "noted", textContent: text })); };
        bar.append(got, lost);
      }
      if (has("plainer") && m.url) bar.append(button("Plainer on the page", async () => {
        const id = await tabFor(m.url);
        if (id) chrome.tabs.sendMessage(id, { type: "neurochat:plainer", key: m.key }).catch(() => {});
      }));
    }
    if (m.study === "check-q") checking = m;
    if (m.study === "check-a") graded(t, m);
  });

  // ---- check-back questions ----
  let checking = null; // the question waiting for the reader's answer
  async function check(req) {
    if (!has("checkback")) return;
    if (busy) { queued.push(() => check(req)); return; }
    if (req.url && (!conv || keyOf(req.url) !== conv.key)) {
      tab = { ...(tab || {}), url: req.url, title: req.title };
      conv = await load(req.url, req.title);
      render();
    }
    ask(`Ask me one short question that checks whether I understood this paragraph. Ask only the question; don't answer it.\n\n"""${req.text}"""`,
      `One question on ¶${req.index || "?"}`, { ...req, study: "check-q" });
  }
  hooks.pending.check = check;
  hooks.wrapAsk = (text) => {
    if (!checking) return null;
    const m = checking;
    checking = null;
    return [`My answer: ${text}\n\nMark my answer. Start your reply with exactly one word, RIGHT, PARTLY or WRONG, then say why in one or two sentences and give the correct answer if I missed it.`, text, { ...m, study: "check-a" }];
  };
  async function graded(t, m) {
    const grade = M.parseGrade(t.text);
    if (!grade) return;
    const key = REVIEW + m.key;
    const was = (await chrome.storage.local.get(key))[key] || { key: m.key, text: m.text, url: m.url, title: m.title, index: m.index };
    const next = M.schedule(was, grade);
    await chrome.storage.local.set({ [key]: next });
    const days = next.due ? Math.round((next.due - Date.now()) / 86400000) : 0;
    t.el.querySelector(".actions")?.append(Object.assign(document.createElement("span"), { className: "noted",
      textContent: next.due ? `Asking again in ${days} day${days > 1 ? "s" : ""}` : "Learned: no more questions on this one" }));
    showDue();
  }
  async function dueItems() {
    const now = Date.now();
    return Object.entries(await chrome.storage.local.get(null)).filter(([k, v]) => k.startsWith(REVIEW) && v?.due && v.due <= now).map(([, v]) => v).sort((a, b) => a.due - b.due);
  }
  async function showDue() {
    const due = has("checkback") ? await dueItems() : [];
    $("due").hidden = !due.length;
    $("due").textContent = `${due.length} question${due.length > 1 ? "s" : ""} to review`;
  }
  $("due").onclick = async () => { const [first] = await dueItems(); if (first && !busy) check(first); };

  // ---- before you read: the page's key terms ----
  let shownFor = null, defined = {};
  async function showTerms() {
    const url = tab?.url || conv?.url;
    const all = url && has("terms") ? Object.entries(await chrome.storage.session.get(null)) : [];
    const got = all.find(([k, v]) => k.startsWith("terms:") && v?.url && keyOf(v.url) === keyOf(url))?.[1];
    const ok = got && got.terms.length;
    $("terms").hidden = !ok;
    if (!ok || shownFor === got.url + got.terms.join()) return;
    shownFor = got.url + got.terms.join();
    $("terms").open = false;
    $("termList").textContent = got.terms.join(", ");
    $("defs").textContent = "Defining…";
    $("terms").dataset.title = got.title || "";
    $("terms").dataset.terms = JSON.stringify(got.terms);
  }
  $("terms").addEventListener("toggle", () => {
    if (!$("terms").open) return;
    const terms = JSON.parse($("terms").dataset.terms || "[]"), done = defined[shownFor];
    if (done) { $("defs").innerHTML = renderMarkdown(done); return; }
    let text = "";
    const forPage = shownFor, pageUrl = tab?.url || conv?.url;
    const port = chrome.runtime.connect({ name: "neurochat:oneshot" });
    port.onMessage.addListener((m) => {
      if (m.type === "token") { text += m.text; $("defs").innerHTML = renderMarkdown(text); return; }
      port.disconnect();
      if (m.type === "error") { $("defs").textContent = m.message; return; }
      defined[forPage] = text;
      // The page shows these when you hover an underlined term.
      const defs = {};
      for (const line of text.split("\n")) {
        const d = /^\W*\**([^*:]+?)\**\s*[:\-–—]\s*(.+)$/.exec(line.trim());
        if (d && terms.some((t) => t.toLowerCase() === d[1].trim().toLowerCase())) defs[d[1].trim().toLowerCase()] = d[2].replace(/\*\*/g, "").trim();
      }
      tabFor(pageUrl).then((id) => id && chrome.tabs.sendMessage(id, { type: "neurochat:term-defs", defs })).catch(() => {});
    });
    port.postMessage({ prompt: `I'm about to read "${$("terms").dataset.title}". Define each of these terms in one plain sentence, as the text ` +
      `probably uses it. Reply only with a list, one line each, as **term**: definition.\n\nTerms: ${terms.join(", ")}` });
  });

  chrome.storage.onChanged.addListener((c, area) => { if (area === "session" && Object.keys(c).some((k) => k.startsWith("terms:"))) showTerms(); });
  setInterval(() => { showTerms(); showDue(); }, 1500);
  showDue();
})();
