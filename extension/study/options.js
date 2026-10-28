// The switches for study mode's features, saved as {feature: true|false} under
// "neurochat.study.features" (study-content.js and the side chat notice changes at once).
const KEY = "neurochat.study.features";
const MAIN = [
  ["explainKey", "Explain key", "Press <b>E</b> to explain the paragraph you're reading."],
  ["selection", "Explain a selection", "Select a phrase in the lit paragraph and the button becomes <b>Explain selection</b>: the tutor explains that phrase, in context."],
  ["plainer", "Plainer", "On a paragraph that slows you down, <b>Plainer</b> (or <b>P</b>) rewrites it in plain words where it is. The original is one tap away."],
  ["labels", "Got it / Still lost", "Tell the tutor whether its explanation worked. <b>Still lost</b> asks it to try another way."],
  ["terms", "Key terms", "The side chat lists the page's key terms and what they mean under <b>Before you read</b>. They're underlined only in a paragraph that slows you down."],
  ["checkback", "Quick check", "When you move on from a paragraph you struggled with, the dock offers one question on it. Answer in your own words; the tutor marks it and asks again over the next week, sooner if you missed it."],
  ["review", "Session review", "At Exit after 5 or more paragraphs, a card shows what slowed you down; tap a bar to go back to it."],
  ["fatigue", "Break reminder", "After 20 minutes, if you've slowed down a lot since you started (for the same kind of text), the dock suggests a break. At most every 30 minutes."],
];
const ADVANCED = [
  ["expected", "Expected pace", "Compares your time with what this paragraph should take you, from its word length, long words and sentence length, so dense text isn't flagged just for being dense. Gets more accurate for you after 30 paragraphs."],
  ["rereads", "Rereads", "Going back to a paragraph you'd left, and staying 2 s, counts as a reread. Slow plus a reread makes the amber edge solid."],
  ["tune", "Self-tuning threshold", "A flag you look at for 10 s and move on from raises the bar for the next one a little; asking about a paragraph it didn't flag lowers it. Aims at about 1 needless flag in 10."],
  ["lookback", "Look-back Explain", "Explain also sends up to two earlier paragraphs from the same section that slowed you down, since confusion often starts there."],
  ["export", "Data export", "<b>Download data (CSV)</b> on the session card: every paragraph's timing, rereads and labels, with clock times that line up with a headset recording."],
  ["signals", "Headset signals", "A headset's rereads (with the line), blinks and jaw clench (which presses Explain) reach study mode. Off: only study mode's own rereads count."],
  ["simulator", "Headset simulator", "A small panel on the page that sends fake headset signals, for trying the headset features without one."],
];
const DEFAULTS = { simulator: false };

(async () => {
  const saved = (await chrome.storage.local.get(KEY))[KEY] || {};
  const on = (k) => saved[k] ?? DEFAULTS[k] ?? true;
  function card(items) {
    const c = Object.assign(document.createElement("div"), { className: "card" });
    for (const [k, name, about] of items) {
      const l = document.createElement("label");
      l.innerHTML = `<b></b><input type="checkbox"><span>${about}</span>`;
      l.querySelector("b").textContent = name;
      const box = l.querySelector("input");
      box.checked = on(k);
      box.onchange = async () => {
        const now = (await chrome.storage.local.get(KEY))[KEY] || {};
        await chrome.storage.local.set({ [KEY]: { ...now, [k]: box.checked } });
      };
      c.append(l);
    }
    return c;
  }
  document.getElementById("main").append(card(MAIN));
  document.getElementById("advanced").append(card(ADVANCED));
  document.getElementById("reset").onclick = async () => {
    const all = Object.keys(await chrome.storage.local.get(null)).filter((k) => /^neurochat\.study\.(s|l|r):|^neurochat\.study\.ratio$/.test(k));
    await chrome.storage.local.remove(all);
    document.getElementById("said").textContent = `Forgot ${all.length} items.`;
  };
})();
