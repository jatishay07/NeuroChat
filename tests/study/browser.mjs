// Playwright check of study mode (S1, S3, S5, S6) against a running companion with a stand-in tutor.
// tests/test_study.py starts the server and runs: node tests/study/browser.mjs <base-url> [screenshot-dir]
// Prints one JSON line with what it saw; exits non-zero on the first failed check.
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const P = require("../../portal/study-pace.js");
const [base, shots] = process.argv.slice(2);

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const seen = {};
try {
  // No camera permission is granted: study mode must never ask for one (S6).
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await context.addInitScript(() => {
    window.__cameraAsks = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.__cameraAsks++; throw new Error("no camera"); };
  });
  const page = await context.newPage();
  const sent = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => { try { sent.push(JSON.parse(f.payload)); } catch {} }));
  await page.clock.install();
  await page.goto(`${base}/study.html`);
  await page.getByRole("link", { name: "try a sample passage" }).click();

  // S1: one paragraph at a time; next/back, keys and scrolling move between them.
  const paras = await page.evaluate(() => document.getElementById("para").textContent);
  assert.match(paras, /^A battery is a small chemical factory/);
  assert.equal(await page.locator("#where").textContent(), "Paragraph 1 of 5");
  assert.equal(await page.locator("#reader p, #reader article").count(), 2, "eyebrow + one paragraph");
  const words = await page.evaluate(() => window.StudyPace.parseText(document.getElementById("source").value).paragraphs.map((p) => window.StudyPace.words(p)));
  // Read at 20 s per 100 words: ms on a paragraph = words * 200.
  const read = async (i, factor = 1) => { await page.clock.fastForward(Math.round(words[i] * 200 * factor)); };

  await read(0);
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 300); // scroll down → next
  await page.waitForFunction(() => window.studyState().at === 1);
  await page.clock.fastForward(1000);
  await page.mouse.wheel(0, -300); // scroll up → back
  await page.waitForFunction(() => window.studyState().at === 0);
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => window.studyState().at === 1);
  await read(1);
  await page.getByRole("button", { name: "Next paragraph" }).click();
  await read(2);
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#where").textContent(), "Paragraph 4 of 5");
  seen.navigation = "wheel, keys and buttons";

  // S3 (first session): the baseline is the paragraphs read so far.
  let s = await page.evaluate(() => window.studyState());
  assert.equal(s.stats.samples, 3, JSON.stringify(s));
  assert.ok(Math.abs(s.stats.median - 20000) < 1500, `median ${s.stats.median}`);
  assert.equal(await page.locator("#cue").isVisible(), false);

  // S4: much slower than usual → a quiet cue, never a popup.
  await read(3, 2.2);
  await page.waitForFunction(() => window.studyState().slow[3]);
  assert.equal(await page.locator("#cue").isVisible(), true);
  assert.equal(await page.locator("#para.slow").count(), 1);
  assert.equal(await page.locator("dialog, [role=dialog], [role=alertdialog]").count(), 0);
  seen.slowCue = await page.locator("#cue").textContent();
  if (shots) await page.screenshot({ path: `${shots}/study-slow.png`, animations: "disabled" });

  // S5: Explain streams the tutor's answer in place, with the reading numbers attached.
  await page.getByRole("button", { name: "Explain" }).click();
  await page.locator("#chat .msg.tutor:not(.typing)").waitFor();
  const answer = await page.locator("#chat .msg.tutor").textContent();
  assert.equal(answer, "Main idea: batteries move ions.");
  const explain = sent.find((m) => m.type === "explain");
  assert.equal(explain.index, 3);
  assert.ok(explain.dwellMsPer100Words > 40000, JSON.stringify(explain));
  assert.ok(Math.abs(explain.medianMsPer100Words - 20000) < 1500, JSON.stringify(explain));
  assert.match(explain.paragraph, /^When you plug your phone in/);
  assert.equal(explain.title, "How do batteries store energy?");
  await page.locator("#askInput").fill("What is graphite?");
  await page.locator("#askInput").press("Enter");
  await page.waitForFunction(() => document.querySelectorAll("#chat .msg.tutor:not(.typing)").length === 2);
  seen.explain = explain;
  if (shots) await page.screenshot({ path: `${shots}/study-explain.png`, animations: "disabled" });

  // Finish lists the slow paragraph.
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.getByRole("button", { name: "Next paragraph" }).click();
  await read(4);
  await page.getByRole("button", { name: "Next paragraph" }).click();
  assert.equal(await page.locator("#finish").isVisible(), true);
  assert.equal(await page.locator("#slowList li").count(), 1);
  if (shots) await page.screenshot({ path: `${shots}/study-finish.png`, animations: "disabled" });

  // S3 (across sessions): the baseline is still there after a reload.
  await page.reload();
  s = await page.evaluate(() => window.studyState());
  assert.equal(s.baseline.length, 5, JSON.stringify(s));
  assert.match(await page.locator("#paceNote").textContent(), /Your usual pace: \d+ s per 100 words, from 5 paragraphs/);
  if (shots) await page.screenshot({ path: `${shots}/study-start.png`, animations: "disabled" });

  // S6: never asked for a camera.
  seen.cameraAsks = await page.evaluate(() => window.__cameraAsks);
  assert.equal(seen.cameraAsks, 0);
  console.log(JSON.stringify({ ok: true, ...seen }));
} finally {
  await browser.close();
}
