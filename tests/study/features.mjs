// Playwright check of study mode's extra features in the Chrome extension, with the side chat open
// as a page and a stand-in tutor on 127.0.0.1:8765 (tests/test_study.py starts it).
//   node tests/study/features.mjs <article-url>
// Real time throughout (content scripts are out of reach of Playwright's fake clock), so the usual
// pace is seeded fast: 3 s per 100 words.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [url] = process.argv.slice(2);
const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extension");

const context = await chromium.launchPersistentContext("", {
  headless: false, viewport: { width: 1280, height: 800 }, acceptDownloads: true,
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
  const local = () => sw.evaluate(() => chrome.storage.local.get(null));
  // Every Explain hand-off, caught as it is written (the side panel deletes it straight away).
  await sw.evaluate(() => {
    self.__handoffs = [];
    chrome.storage.onChanged.addListener((c, area) => { if (area === "session" && c.pending?.newValue) self.__handoffs.push(c.pending.newValue); });
  });
  const handoffs = () => sw.evaluate(() => self.__handoffs);
  const nextHandoff = async (n) => { for (let k = 0; k < 50; k++) { const h = await handoffs(); if (h.length > n) return h[n]; await page.waitForTimeout(100); } return null; };
  const sendSignal = (s) => page.evaluate((d) => dispatchEvent(new CustomEvent("neurochat:signal", { detail: JSON.stringify(d) })), s);

  assert.deepEqual(await tabMsg({ type: "neurochat:study" }), { on: true, paragraphs: 8 });
  await page.mouse.move(400, 400);

  // 1. Expected pace: the dense ¶3 is expected to take far longer than the plain ¶1.
  let s = await state();
  assert.ok(s.expected[2] > 1.8 * s.expected[0], `expected ${s.expected}`);
  assert.deepEqual(s.terms, ["electrons", "lithium", "graphite"]);
  assert.ok(s.sim, "the headset simulator shows when it's switched on");
  seen.expected = { plain: s.expected[0], dense: s.expected[2] };

  // Same 3.5 s on each: the plain ¶1 is slow for you, the dense ¶3 isn't.
  await page.waitForTimeout(3500);
  s = await state();
  assert.equal(s.slow[0], true, "plain paragraph read slowly is flagged");
  // 12. Key terms are underlined only in a paragraph that turned slow.
  assert.ok(await page.locator("article p").nth(1).locator("span.neurochat-term").count() >= 1);
  assert.equal(await page.locator("article p").nth(2).locator("span.neurochat-term").count(), 0);
  await page.keyboard.press("j"); await page.waitForTimeout(500);
  await page.keyboard.press("j"); await page.waitForTimeout(3500);
  s = await state();
  assert.equal(s.at, 2);
  assert.equal(s.slow[2], false, "the dense paragraph at the same speed is not");
  // 7. Self-tuning: leaving just after a flag doesn't count as a needless flag (that's a slow reader finishing).
  assert.equal(s.ratio, 1.5);
  seen.tune = s.ratio;

  // 3. Rereads: back to ¶2 and staying 2 s counts; a quick k-then-j doesn't.
  await page.keyboard.press("k");
  await page.waitForTimeout(2600);
  s = await state();
  assert.equal(s.at, 1);
  assert.equal(s.rereads[1], 1);
  assert.ok(s.signals.includes("reread"));
  await page.keyboard.press("k"); await page.waitForTimeout(450); await page.keyboard.press("j"); await page.waitForTimeout(2600);
  s = await state();
  assert.equal(s.rereads[0], 0, "an overshoot isn't a reread");
  seen.rereads = s.rereads;

  // 2. Signals: a reread on line 2 of a slow paragraph is underlined; a jaw clench presses Explain.
  await page.keyboard.press("k"); await page.waitForTimeout(600); // back on ¶1, which is slow
  await sendSignal({ kind: "reread", line: 1 });
  s = await state();
  assert.ok(s.underline, "the headset's line is underlined on a slow paragraph");
  await sendSignal({ kind: "clench" });
  let h = await nextHandoff(0);
  assert.equal(h.trigger, "clench");
  assert.equal(h.index, 1);
  seen.signals = "reread line underlined, clench → Explain";

  // 6. Got it / Still lost under the explanation, and Plainer on the page.
  await panel.locator(".turn-tutor .actions button", { hasText: "Got it" }).waitFor({ timeout: 10000 });
  assert.ok(await panel.locator(".turn-tutor .actions button", { hasText: "Still lost" }).count());
  await panel.locator(".turn-tutor .actions button", { hasText: "Got it" }).click();
  await panel.locator(".noted", { hasText: "got it" }).waitFor();
  const labelled = Object.entries(await local()).filter(([k]) => k.startsWith("neurochat.study.l:"));
  assert.equal(labelled.length, 1);
  assert.equal(labelled[0][1].label, "got");
  assert.equal(labelled[0][1].flagged, true);
  seen.labels = "Got it saved";

  // The signal path is closed while the simulator is off, so a page can't press Explain for you.
  await sw.evaluate(() => chrome.storage.local.set({ "neurochat.study.features": { simulator: false } }));
  await page.waitForTimeout(200);
  await sendSignal({ kind: "clench" });
  await page.waitForTimeout(600);
  assert.equal((await handoffs()).length, 1, "ignored with the simulator off");
  assert.equal((await state()).sim, false);

  // 4. The e key explains; a selection in the lit paragraph is explained in context.
  await page.keyboard.press("j"); await page.waitForTimeout(600);
  await page.keyboard.press("e");
  h = await nextHandoff(1);
  assert.equal(h.trigger, "key"); assert.equal(h.index, 2);
  await page.evaluate(() => {
    const p = document.querySelectorAll("article p")[2]; // ¶2 (the byline is article p 0)
    const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    while (w.nextNode() && !w.currentNode.data.includes("the cathode"));
    const t = w.currentNode, i = t.data.indexOf("the cathode");
    const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + "the cathode".length);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  });
  await page.waitForTimeout(200);
  assert.equal((await state()).pill, "Explain selection");
  await page.keyboard.press("e");
  h = await nextHandoff(2);
  assert.equal(h.text, "the cathode");
  assert.match(h.context, /^The side that gives up electrons/);
  await page.evaluate(() => getSelection().removeAllRanges());
  seen.explainKey = "e explains; selection explained in context";

  // 5. Look-back: Explain on ¶3 also sends ¶1, which slowed you down earlier in the same section.
  await page.keyboard.press("j"); await page.waitForTimeout(800);
  assert.equal((await state()).at, 2);
  await page.keyboard.press("e");
  h = await nextHandoff(3);
  assert.ok(h.earlier.map((e) => e.index).includes(1), JSON.stringify(h.earlier));
  assert.ok(h.earlier.length <= 2);
  await panel.locator(".turn-user .also", { hasText: /Also sent: ¶1/ }).last().waitFor({ timeout: 10000 });
  seen.lookback = h.earlier.map((e) => e.index);

  // 8. Plainer: p rewrites ¶3 in place; p again shows the original, exactly as it was.
  const before = await page.evaluate(() => document.querySelectorAll("article p")[3].innerHTML);
  assert.equal((await state()).alt, null, "no Plainer button on a paragraph that isn't slow");
  await page.keyboard.press("p");
  await page.waitForFunction(() => /^A battery only charges/.test(document.querySelectorAll("article p")[3].textContent) && document.querySelector("neurochat-study"), null, { timeout: 10000 });
  for (let k = 0; k < 30 && (await state()).alt !== "Original"; k++) await page.waitForTimeout(100);
  assert.equal((await state()).alt, "Original");
  await page.keyboard.press("p");
  assert.equal(await page.evaluate(() => document.querySelectorAll("article p")[3].innerHTML), before);
  assert.equal((await state()).alt, "Plainer");
  await page.keyboard.press("p"); // back to plain words for the rest
  seen.plainer = "rewritten in place, original restored exactly";

  // 9. Check-back: leaving the section you struggled in offers one question; the tutor marks the answer.
  await page.keyboard.press("j"); await page.waitForTimeout(800);
  s = await state();
  assert.equal(s.offer, "Quick check on what you just read?");
  await state({ press: "offer" });
  await panel.locator(".turn-tutor .answer", { hasText: "What has to be true" }).waitFor({ timeout: 10000 });
  await panel.waitForFunction(() => document.getElementById("askInput").placeholder === "Your answer, in your own words");
  await panel.locator("#askInput").fill("The charger has to push harder than the battery's own voltage.");
  await panel.locator("#askInput").press("Enter");
  await panel.locator(".noted", { hasText: "Asking again in 1 day" }).waitFor({ timeout: 10000 });
  assert.equal(await panel.locator("#askInput").getAttribute("placeholder"), "Ask about this page");
  const review = Object.entries(await local()).filter(([k]) => k.startsWith("neurochat.study.r:"));
  assert.equal(review.length, 1);
  assert.equal(review[0][1].step, 1);
  assert.equal(review[0][1].last, "right");
  seen.checkback = "question, answer marked RIGHT, due in 1 day";

  // 12. Before you read: the key terms, defined on opening; the page's underlined term gets the definition.
  await panel.locator("#terms summary", { hasText: "electrons, lithium, graphite" }).waitFor({ timeout: 5000 });
  await panel.locator("#terms summary").click();
  await panel.locator("#defs", { hasText: "pencil lead" }).waitFor({ timeout: 10000 });
  assert.match(await page.evaluate(() => document.querySelector("span.neurochat-term").title), /charged particles/);
  seen.terms = "listed, defined, and the underline shows the definition";

  // Read on to the end, so the session has enough for a review.
  for (let k = 0; k < 4; k++) { await page.keyboard.press("j"); await page.waitForTimeout(1800); }

  // 10. Session review at Exit: a card with what was hard, and the session as a CSV.
  await page.keyboard.press("Escape");
  s = await state();
  assert.equal(s.on, false);
  assert.match(s.card, /paragraphs?, \d+ words in \d+ min/);
  assert.equal(await page.locator(".neurochat-dim, .neurochat-current, .neurochat-plain, span.neurochat-term, html.neurochat-study").count(), 0, "Exit leaves the page as it was");
  const [download] = await Promise.all([page.waitForEvent("download"), state({ press: "csv" })]);
  const csv = fs.readFileSync(await download.path(), "utf8").trim().split("\n");
  assert.match(csv[0], /^paragraph,start_ms,end_ms,words,word_length,long_words,sentence_length,symbols,expected_ms_per_100_words,actual_ms_per_100_words,ratio,slow,rereads,explained,label,signals,text$/);
  assert.ok(csv.length >= 5, csv.join("\n"));
  assert.match(csv[1], /^1,\d{13},\d{13},/);
  assert.match(csv[1], /,1,[12],1,got,/, "¶1: slow, reread, explained, labelled got it");
  await state({ press: "done" });
  assert.equal((await state()).card, null);
  seen.review = `${csv.length - 1} rows`;

  // Switches: with everything off, it is plain study mode again.
  const off = Object.fromEntries(["expected", "rereads", "signals", "simulator", "explainKey", "selection", "lookback", "labels", "tune", "plainer", "checkback", "review", "fatigue", "terms"].map((k) => [k, false]));
  await sw.evaluate((f) => chrome.storage.local.set({ "neurochat.study.features": f }), off);
  await tabMsg({ type: "neurochat:study" });
  s = await state();
  const sent = (await handoffs()).length;
  assert.deepEqual(s.terms, []);
  assert.equal(s.threshold, 1.5);
  await page.keyboard.press("e");
  await page.waitForTimeout(500);
  assert.equal((await handoffs()).length, sent, "e does nothing with the Explain key off");
  await page.keyboard.press("Escape");
  assert.equal((await state()).card, null, "no review card with it off");
  seen.switches = "all off = plain study mode";

  console.log(JSON.stringify({ ok: true, ...seen }));
} finally {
  await context.close();
}
