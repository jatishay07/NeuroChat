// The switches for study mode's features, saved as {feature: true|false} under
// "neurochat.study.features" (study-content.js reads them and notices changes at once).
const KEY = "neurochat.study.features";
const GROUPS = [
  ["Noticing where you struggle", [
    ["expected", "Expected pace", "Compares your time with what this paragraph should take you, from its word length, rare words and sentence length, so dense text isn't flagged just for being dense. Learns your own weights after 30 paragraphs."],
    ["rereads", "Rereads", "Going back to a paragraph you'd left, and staying 2 s, counts as a reread. Slow plus a reread makes the amber edge solid."],
    ["tune", "Self-tuning threshold", "When you ignore a flag, the bar for the next one rises a little; when you ask about a paragraph it didn't flag, it drops. Aims at about 1 needless flag in 10."],
    ["fatigue", "Break reminder", "After 20 minutes, if you're reading much slower than when you started (for the same kind of text), the dock suggests a break. At most every 30 minutes."],
  ]],
  ["Getting unstuck", [
    ["explainKey", "Explain key", "Press <b>e</b> to explain the lit paragraph. A headset's jaw clench will press it for you."],
    ["selection", "Explain a selection", "Select a phrase in the lit paragraph and the button becomes <b>Explain selection</b>: the tutor explains that phrase, in context."],
    ["lookback", "Look-back Explain", "Explain also sends up to two earlier paragraphs from the same section that slowed you down, since confusion often starts there."],
    ["labels", "Got it / Still lost", "Two buttons under each explanation. They tell study mode whether its flag was right, and <b>Still lost</b> asks the tutor to try another way."],
    ["plainer", "Plainer", "Press <b>p</b> (or <b>Plainer on the page</b> in the side chat) to rewrite the lit paragraph in plain words, in place. The original is one tap away."],
    ["terms", "Key terms", "The side chat lists the page's key terms under <b>Before you read</b>. They're underlined only in a paragraph that slows you down."],
  ]],
  ["Remembering it", [
    ["checkback", "Check-back question", "Leaving a section you struggled in, the dock offers <b>One question on ¶4?</b>. Answer in your own words; the tutor marks it and asks again in 1, 3 and 7 days."],
    ["review", "Session review", "At Exit, a card shows what was hard, with every paragraph as a bar you can jump to, and <b>Download CSV</b> of the whole session."],
  ]],
  ["Headset", [
    ["signals", "Signals", "Headset signals (rereads on a line, blinks, a jaw clench to explain) arrive in study mode through one channel. Today the page itself sends rereads."],
    ["simulator", "Headset simulator <em>developers</em>", "A small panel on the page that sends fake headset signals, so the headset features can be tried without one."],
  ]],
];
const DEFAULTS = { simulator: false };

(async () => {
  const saved = (await chrome.storage.local.get(KEY))[KEY] || {};
  const on = (k) => saved[k] ?? DEFAULTS[k] ?? true;
  for (const [title, items] of GROUPS) {
    const h = Object.assign(document.createElement("h2"), { textContent: title });
    const card = Object.assign(document.createElement("div"), { className: "card" });
    for (const [k, name, about] of items) {
      const l = document.createElement("label");
      l.innerHTML = `<b></b><input type="checkbox"><span>${about}</span>`;
      l.querySelector("b").innerHTML = name;
      const box = l.querySelector("input");
      box.checked = on(k);
      box.dataset.k = k;
      box.onchange = async () => {
        const now = (await chrome.storage.local.get(KEY))[KEY] || {};
        await chrome.storage.local.set({ [KEY]: { ...now, [k]: box.checked } });
      };
      card.append(l);
    }
    document.getElementById("groups").append(h, card);
  }
  document.getElementById("reset").onclick = async () => {
    const all = Object.keys(await chrome.storage.local.get(null)).filter((k) => /^neurochat\.study\.(s|l|r):|^neurochat\.study\.ratio$/.test(k));
    await chrome.storage.local.remove(all);
    document.getElementById("said").textContent = `Forgot ${all.length} items.`;
  };
})();
