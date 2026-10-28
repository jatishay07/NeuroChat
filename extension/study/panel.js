// Study mode's features in the side chat, loaded after sidepanel.js and using its hooks and
// functions (ask, load, render, keyOf, busy, queued, conv, tab):
// - "Got it" / "Still lost" under an explanation study mode asked for: whether the explanation worked
//   (and "Still lost" asks for another way of putting it);
// - check-back questions: one question on a paragraph you struggled with, answered in your own words,
//   marked by the tutor and asked again after 1, 3 and 7 days;
// - "Before you read": the page's key terms and their definitions (study-content.js fetches them).
(() => {
  const M = self.StudyModel;
  const LABELS = "neurochat.study.l:", REVIEW = "neurochat.study.r:", RATIO = "neurochat.study.ratio", FLAGS = "neurochat.study.features";
  const KEEP_LABELS = 300, KEEP_REVIEW = 200;
  let flags = {};
  const has = (f) => flags[f] !== false;
  const review = new Map(); // review items by storage key, kept in step with storage
  chrome.storage.local.get(null).then((all) => {
    flags = all[FLAGS] || {};
    for (const [k, v] of Object.entries(all)) if (k.startsWith(REVIEW) && v) review.set(k, v);
    showDue();
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === "session" && Object.keys(c).some((k) => k.startsWith("terms:"))) showTerms();
    if (area !== "local") return;
    if (c[FLAGS]) { flags = c[FLAGS].newValue || {}; showTerms(); if (!has("checkback")) stopChecking(); }
    for (const [k, { newValue }] of Object.entries(c)) if (k.startsWith(REVIEW)) newValue ? review.set(k, newValue) : review.delete(k);
    showDue();
  });

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
  box.innerHTML = `<details id="terms" hidden><summary><b>Before you read</b> · <span id="termList"></span></summary><div class="defs" id="defs"></div></details><button type="button" id="due" hidden></button>`;
  document.querySelector("footer").insertBefore(box, document.getElementById("ask"));
  const $ = (id) => document.getElementById(id);
  const input = $("askInput"), placeholder = input.placeholder;

  async function trim(prefix, keep) { // the oldest go first
    const all = Object.entries(await chrome.storage.local.get(null)).filter(([k]) => k.startsWith(prefix));
    if (all.length > keep) await chrome.storage.local.remove(all.sort((a, b) => (a[1].t || 0) - (b[1].t || 0)).slice(0, all.length - keep).map(([k]) => k));
  }

  // ---- under an explanation: Got it / Still lost ----
  function button(text, onclick) {
    return Object.assign(document.createElement("button"), { type: "button", className: "study", textContent: text, onclick });
  }
  async function label(meta, value) {
    await chrome.storage.local.set({ [LABELS + meta.key]: { label: value, flagged: !!meta.flagged, t: Date.now() } });
    trim(LABELS, KEEP_LABELS);
    // Lost on a paragraph that wasn't flagged: the flag should have come sooner.
    if (has("tune") && value === "lost" && !meta.flagged) {
      const r = (await chrome.storage.local.get(RATIO))[RATIO];
      await chrome.storage.local.set({ [RATIO]: M.tune(r, "miss") });
    }
  }
  hooks.done.push((t, e) => {
    showTerms();
    if (e.type !== "done" || !t.meta) return;
    const m = t.meta, bar = t.el.querySelector(".actions");
    if (m.study === "explain") {
      stopChecking(); // a new explanation, not an answer to the question before it
      if (has("labels") && bar) {
        const got = button("Got it", () => { label(m, "got"); noted("Noted: got it"); });
        const lost = button("Still lost", () => {
          label(m, "lost");
          noted("Noted: still lost");
          ask("That still doesn't click for me. Explain it a different way: simpler, with one concrete example.", "Still lost", { ...m, study: "again" });
        });
        const noted = (text) => { got.remove(); lost.remove(); bar.append(Object.assign(document.createElement("span"), { className: "noted", textContent: text })); };
        bar.append(got, lost);
      }
    }
    if (m.study === "check-q" && has("checkback")) startChecking(m, bar);
    if (m.study === "check-a") graded(t, m);
  });

  // ---- check-back questions ----
  let checking = null; // {meta, conv key} of the question waiting for the reader's answer
  function startChecking(m, bar) {
    checking = { m, key: conv.key };
    input.placeholder = "Your answer, in your own words";
    bar?.append(Object.assign(button("Skip", stopChecking), { className: "study skip" }));
    input.focus();
  }
  function stopChecking() { checking = null; input.placeholder = placeholder; document.querySelector(".study.skip")?.remove(); }
  async function check(req) {
    if (!has("checkback")) return;
    if (busy) { queued.push(() => check(req)); return; }
    stopChecking();
    if (req.url && (!conv || keyOf(req.url) !== conv.key)) {
      tab = { ...(tab || {}), url: req.url, title: req.title };
      conv = await load(req.url, req.title);
      render();
    }
    ask(`Ask me one short why or how question about the main idea of this paragraph, one I can answer from memory in a sentence. Reply with the question only.\n\n"""${req.text}"""`,
      "Quick check", { ...req, study: "check-q", task: true });
  }
  hooks.pending.check = check;
  hooks.wrapAsk = (text) => {
    if (!checking) return null;
    const { m, key } = checking;
    stopChecking();
    if (conv?.key !== key) return null; // the reader moved to another page: this isn't the answer
    return [`My answer: ${text}\n\nMark my answer. Start your reply with exactly one word, RIGHT, PARTLY or WRONG, then say why in one or two sentences and give the correct answer if I missed it.`,
      text, { ...m, study: "check-a", task: true }];
  };
  async function graded(t, m) {
    const grade = M.parseGrade(t.text);
    const key = REVIEW + m.key;
    const was = review.get(key) || { key: m.key, text: m.text, url: m.url, title: m.title, index: m.index };
    const next = { ...M.schedule(was, grade), t: Date.now() };
    if (next.due) await chrome.storage.local.set({ [key]: next }); else await chrome.storage.local.remove(key);
    trim(REVIEW, KEEP_REVIEW);
    const days = next.due ? Math.round((next.due - Date.now()) / 86400000) : 0;
    t.el.querySelector(".actions")?.append(Object.assign(document.createElement("span"), { className: "noted",
      textContent: next.due ? `Asking again in ${days} day${days > 1 ? "s" : ""}` : "Learned: no more questions on this one" }));
  }
  const dueItems = () => [...review.values()].filter((v) => v.due && v.due <= Date.now()).sort((a, b) => a.due - b.due);
  function showDue() {
    const due = has("checkback") ? dueItems() : [];
    $("due").hidden = !due.length;
    $("due").textContent = `${due.length} question${due.length > 1 ? "s" : ""} to review`;
  }
  $("due").onclick = () => { const [first] = dueItems(); if (first && !busy) check(first); };

  // ---- before you read: the page's key terms ----
  let shown = null;
  async function showTerms() {
    const url = tab?.url || conv?.url;
    const all = url && has("terms") ? Object.entries(await chrome.storage.session.get(null)) : [];
    const got = all.find(([k, v]) => k.startsWith("terms:") && v?.url && keyOf(v.url) === keyOf(url))?.[1];
    $("terms").hidden = !got?.terms?.length;
    if (!got) return;
    const id = got.url + got.terms.join();
    if (shown !== id) { shown = id; $("terms").open = false; }
    $("termList").textContent = got.terms.join(", ");
    const defs = got.defs ? got.terms.filter((t) => got.defs[t]).map((t) => `**${t}**: ${got.defs[t]}`).join("\n\n") : "";
    $("defs").innerHTML = defs ? renderMarkdown(defs) : got.defs ? "The tutor couldn't define them just now." : "Defining…";
  }
  // The panel follows tabs itself; catch up when the tab or its page changes.
  chrome.tabs.onActivated.addListener(() => setTimeout(() => { stopChecking(); showTerms(); }, 50));
  chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.status === "complete") setTimeout(showTerms, 50); });
  setInterval(showDue, 60000); // a question can come due while the panel is open
  showTerms();
})();
