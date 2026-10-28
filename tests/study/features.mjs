// Playwright check of study mode's hands-free flow in the Chrome extension, with the side chat open
// as a page and a stand-in tutor on 127.0.0.1:8765 (tests/test_study.py starts it).
//   node tests/study/features.mjs <article-url>
// Real time throughout (content scripts are out of reach of Playwright's fake clock), so the usual
// pace is seeded fast: 3 s per 100 words.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [url] = process.argv.slice(2);
const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extension");

const context = await chromium.launchPersistentContext("", {
  headless: false, viewport: { width: 1280, height: 800 },
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const seen = {};
try {
  const sw = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = new URL(sw.url()).host;
  await sw.evaluate(() => chrome.storage.local.set({
    ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`neurochat.study.s:seed${i}`, { v: 3000, t: i, x: [0, 0, 0, 0] }])),
    "neurochat.study.features": { simulator: true },
  }));
  await sw.evaluate(() => { chrome.sidePanel.open = async () => {}; }); // the panel is a page here
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  const page = await context.newPage();
  await page.goto(url);
  await page.bringToFront();

  const tabMsg = (msg) => sw.evaluate(async ([u, m]) => {
    const [tab] = await chrome.tabs.query({ url: u });
    return chrome.tabs.sendMessage(tab.id, m);
  }, [url, msg]);
  const state = (extra = {}) => tabMsg({ type: "neurochat:study-test", ...extra });
  // Every hand-off to the side chat, caught as it is written (the side panel deletes it straight away).
  await sw.evaluate(() => {
    self.__handoffs = [];
    chrome.storage.onChanged.addListener((c, area) => { if (area === "session" && c.pending?.newValue) self.__handoffs.push(c.pending.newValue); });
  });
  const handoffs = () => sw.evaluate(() => self.__handoffs);
  const nextHandoff = async (n) => { for (let k = 0; k < 50; k++) { const h = await handoffs(); if (h.length > n) return h[n]; await page.waitForTimeout(100); } return null; };
  const sendSignal = (s) => page.evaluate((d) => dispatchEvent(new CustomEvent("neurochat:signal", { detail: JSON.stringify(d) })), s);
  const tutorAnswers = () => panel.locator(".turn-tutor:not(.typing)").count();
  const answered = async (n) => { for (let k = 0; k < 100 && (await tutorAnswers()) < n; k++) await page.waitForTimeout(100); assert.equal(await tutorAnswers(), n); };

  assert.deepEqual(await tabMsg({ type: "neurochat:study" }), { on: true, paragraphs: 8 });
  await page.mouse.move(400, 400);

  // Expected pace: the dense ¶3 is expected to take far longer than the plain ¶1.
  let s = await state();
  assert.ok(s.expected[2] > 1.8 * s.expected[0], `expected ${s.expected}`);
  assert.ok(s.sim, "the headset simulator shows when it's switched on");
  seen.expected = { plain: s.expected[0], dense: s.expected[2] };

  // Same 3.5 s on each: the plain ¶1 is slow for you, the dense ¶3 isn't. Slow alone explains nothing,
  // and nothing is shown but the amber edge.
  await page.waitForTimeout(3500);
  s = await state();
  assert.equal(s.slow[0], true, "plain paragraph read slowly is flagged");
  assert.equal(s.cue, "");
  await page.keyboard.press("j"); await page.waitForTimeout(500);
  await page.keyboard.press("j"); await page.waitForTimeout(3500);
  s = await state();
  assert.equal(s.at, 2);
  assert.equal(s.slow[2], false, "the dense paragraph at the same speed is not");
  assert.equal(s.ratio, 1.5, "leaving just after a flag doesn't count as a needless flag");
  assert.equal((await handoffs()).length, 0);

  // Rereads: back to ¶2 after 3.5 s away, staying 2 s, counts. ¶2 wasn't slow on its first read, so nothing is sent.
  await page.keyboard.press("k"); await page.waitForTimeout(2600);
  s = await state();
  assert.equal(s.rereads[1], 1);
  assert.equal((await handoffs()).length, 0, "a reread alone explains nothing");
  // A scroll just past ¶1 and straight back isn't a reread, however long you then stay.
  await page.keyboard.press("k"); await page.waitForTimeout(800);
  await page.keyboard.press("j"); await page.waitForTimeout(600);
  await page.keyboard.press("k"); await page.waitForTimeout(2600);
  s = await state();
  assert.equal(s.rereads[0], 0, "a scroll past and back isn't a reread");
  assert.equal((await handoffs()).length, 0);
  seen.rereads = s.rereads;

  // Slow on the first read and gone back to after a while away: explained in the side chat, nothing pressed.
  await page.keyboard.press("j"); await page.waitForTimeout(3200);
  const before = (await state()).ratio;
  await page.keyboard.press("k"); await page.waitForTimeout(2600);
  let h = await nextHandoff(0);
  assert.equal(h.trigger, "auto");
  assert.equal(h.index, 1);
  assert.equal(h.rereads, 1);
  assert.ok(h.dwellMsPer100Words > h.medianMsPer100Words);
  s = await state();
  assert.equal(s.explained[0], true);
  assert.equal(s.delivered[0], true);
  assert.equal(s.cue, "Explained in the side chat");
  assert.ok(s.ratio < before, `going back to a flag lowers the bar a little: ${before} → ${s.ratio}`);
  await answered(1);
  seen.auto = "slow + reread → explained";

  // Going back to check it against the explanation straight away isn't being stuck again…
  await page.keyboard.press("j"); await page.waitForTimeout(3200);
  await page.keyboard.press("k"); await page.waitForTimeout(2600);
  assert.equal((await state()).rereads[0], 2);
  assert.equal((await handoffs()).length, 1, "checking the paragraph just after the explanation");
  // …but still going back well after it is: once more, a different way. After that, nothing more.
  await state({ explainedAgo: 25000 });
  await page.keyboard.press("j"); await page.waitForTimeout(3200);
  await page.keyboard.press("k"); await page.waitForTimeout(2600);
  h = await nextHandoff(1);
  assert.equal(h.again, true);
  await panel.locator(".turn-user", { hasText: "Still stuck on it" }).waitFor({ timeout: 10000 });
  await panel.locator(".turn-tutor", { hasText: "two buckets" }).waitFor({ timeout: 10000 });
  await page.keyboard.press("j"); await page.waitForTimeout(3200);
  await page.keyboard.press("k"); await page.waitForTimeout(2600);
  await sendSignal({ kind: "clench" });
  await page.waitForTimeout(400);
  assert.equal((await handoffs()).length, 2, "explained differently once, not again and again (a clench neither)");
  seen.again = "a different way, once";

  // Headset (simulated): a reread on line 2 of a slow paragraph is underlined; a jaw clench explains now.
  await sendSignal({ kind: "reread", line: 1 });
  assert.ok((await state()).underline, "the headset's line is underlined on a slow paragraph");
  await page.keyboard.press("j"); await page.waitForTimeout(600);
  await page.keyboard.press("j"); await page.waitForTimeout(800);
  assert.equal((await state()).at, 2);
  await sendSignal({ kind: "clench" });
  h = await nextHandoff(2);
  assert.equal(h.trigger, "clench");
  assert.equal(h.index, 3);
  // Look-back: explaining ¶3 also sends ¶1, which slowed you down earlier in the same section.
  assert.ok(h.earlier.map((e) => e.index).includes(1), JSON.stringify(h.earlier));
  seen.headset = "line underlined, clench explains, look-back sent ¶1";

  // The headset's own "stuck" confirms a slow paragraph without a reread.
  await page.keyboard.press("j"); await page.waitForTimeout(600);
  await sendSignal({ kind: "stuck" });
  await page.waitForTimeout(400);
  assert.equal((await handoffs()).length, 3, "stuck on a paragraph that isn't slow is ignored");
  await state({ flagFor: 1000 });
  await sendSignal({ kind: "stuck" });
  h = await nextHandoff(3);
  assert.equal(h.trigger, "headset");
  assert.equal(h.index, 4);

  // The signal path is closed while the simulator is off, so a page can't trigger explanations.
  await sw.evaluate(() => chrome.storage.local.set({ "neurochat.study.features": { simulator: false } }));
  await page.waitForTimeout(200);
  await page.keyboard.press("j"); await page.waitForTimeout(600);
  await sendSignal({ kind: "clench" });
  await page.waitForTimeout(600);
  assert.equal((await handoffs()).length, 4, "ignored with the simulator off");
  assert.equal((await state()).sim, false);

  // Self-tuning, the other way: a flag in view 10 s and left without going back raises the bar a step…
  let r0 = (await state({ flagFor: 11000 })).ratio;
  await page.keyboard.press("j"); await page.waitForTimeout(1800);
  assert.equal((await state()).ratio, Math.round((r0 + 0.05) * 10000) / 10000);
  // …but Exit with a flag in view isn't the reader judging it.
  r0 = (await state({ flagFor: 11000 })).ratio;
  await page.keyboard.press("Escape");
  s = await state();
  assert.equal(s.on, false);
  assert.equal(s.ratio, r0, "Exit doesn't judge a flag");
  assert.equal(await page.locator(".neurochat-dim, .neurochat-current, html.neurochat-study, neurochat-study").count(), 0, "Exit leaves the page as it was");
  seen.tune = "down on a reread flag, up on an ignored one, Exit not judged";

  console.log(JSON.stringify({ ok: true, ...seen }));
} finally {
  await context.close();
}
