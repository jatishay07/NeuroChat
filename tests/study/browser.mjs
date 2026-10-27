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
  assert.match(answer, /^Main idea: batteries move ions\. Ions slot/);
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
  // The follow-up box stays above the floating dock as the long answer streams in.
  const [askBottom, dockTop] = await page.evaluate(() => [document.getElementById("askForm").getBoundingClientRect().bottom, document.getElementById("dock").getBoundingClientRect().top]);
  assert.ok(askBottom <= dockTop, `ask box ${askBottom} under the dock ${dockTop}`);
  // Reading the answer doesn't count as reading the paragraph.
  await page.clock.fastForward(50000);
  assert.equal(await page.evaluate(() => window.studyState().pace), explain.dwellMsPer100Words);
  if (shots) await page.screenshot({ path: `${shots}/study-explain.png`, animations: "disabled" });

  // Finish lists the slow paragraph.
  // Wheel with the pointer over the answer, at the bottom of the page, still turns the page.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.locator("#chat .msg.tutor").first().hover();
  await page.clock.fastForward(1500);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(100);
  assert.equal((await page.evaluate(() => window.studyState())).at, 4, "wheel over the explanation turns the page");
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
  const paced = s.baseline.find((v) => v > 40000);
  assert.equal(paced, explain.dwellMsPer100Words, "the explained paragraph keeps its pace from before Explain");

  // A second text adds to the baseline (it doesn't replace the first text's paragraphs).
  assert.equal(await page.locator("#startBtn").isEnabled(), true);
  await page.locator("#source").fill("A second text\n\n" + "Words to read here again and again. ".repeat(5) + "\n\n" + "More words for the next paragraph now. ".repeat(5));
  await page.locator("#startBtn").click();
  await page.clock.fastForward(8000);
  await page.keyboard.press("ArrowRight");
  assert.equal((await page.evaluate(() => window.studyState())).baseline.length, 6);

  // Round-1 critique fixes, on a fresh text.
  // Resume: reload mid-text offers to continue where you were.
  await page.reload();
  assert.equal(await page.locator("#resumeBtn").textContent(), "Continue at paragraph 2 of 2");
  await page.locator("#source").fill("Something else entirely.");
  assert.equal(await page.locator("#resume").isVisible(), false, "the resume link goes with the text it was for");
  const tall = "Long text\n\n" + Array.from({ length: 4 }, (_, k) => `Paragraph ${k} begins. ` + "This sentence keeps going so the paragraph is tall on screen. ".repeat(14)).join("\n\n");
  await page.locator("#source").fill(tall);
  await page.locator("#startBtn").click();

  // A trackpad flick (one gesture with ~2 s of inertia) moves one paragraph, not three.
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.mouse.move(600, 400);
  for (let k = 0; k < 120; k++) { await page.mouse.wheel(0, Math.max(4, 120 * Math.exp(-k / 30))); await page.clock.fastForward(16); }
  await page.waitForTimeout(150); // let the last queued wheel events land
  assert.equal((await page.evaluate(() => window.studyState())).at, 1, "one flick, one paragraph");
  seen.flick = "120 wheel events over 2 s → 1 move";
  // A plain mouse wheel: notches 400 ms apart add up, two notches turn the page.
  await page.clock.fastForward(1500);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(100);
  await page.clock.fastForward(400);
  assert.equal((await page.evaluate(() => window.studyState())).at, 1, "one notch is not enough");
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(100);
  assert.equal((await page.evaluate(() => window.studyState())).at, 2, "two notches turn the page");
  await page.clock.fastForward(400);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(100);
  assert.equal((await page.evaluate(() => window.studyState())).at, 2, "a turn uses up the pull: the next notch alone doesn't turn");
  await page.keyboard.press("ArrowLeft");

  // A paragraph taller than the window: ↓ scrolls it first and only then moves on.
  await page.setViewportSize({ width: 390, height: 500 });
  await page.clock.fastForward(1000);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(400); // the browser's own smooth scroll
  assert.equal((await page.evaluate(() => window.studyState())).at, 1, "↓ scrolled the page instead of skipping");
  assert.ok(await page.evaluate(() => window.scrollY > 0));
  // One long wheel gesture that starts mid-paragraph scrolls to the end but doesn't also turn the page.
  await page.clock.fastForward(1500);
  for (let k = 0; k < 40; k++) { await page.mouse.wheel(0, 120); await page.clock.fastForward(16); }
  await page.waitForTimeout(300);
  assert.equal((await page.evaluate(() => window.studyState())).at, 1, "rested on the last lines");
  await page.keyboard.press("End");
  await page.waitForTimeout(400);
  await page.keyboard.press("ArrowDown");
  assert.equal((await page.evaluate(() => window.studyState())).at, 2);

  // Explain again adds another take to the same conversation; "Got it" stays collapsed.
  await page.getByRole("button", { name: "Explain" }).click();
  await page.locator("#chat .msg.tutor:not(.typing)").waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.id), "askInput", "focus moves to the follow-up box");
  await page.getByRole("button", { name: "Explain again" }).click();
  await page.waitForFunction(() => document.querySelectorAll("#chat .msg.tutor:not(.typing)").length === 2);
  assert.equal(sent.filter((m) => m.type === "explain").at(-1).append, true);
  await page.getByRole("button", { name: "Got it" }).click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.locator("#tutor").isVisible(), false, "collapsed answer stays collapsed");
  await page.getByRole("button", { name: "Show explanation" }).click();
  assert.equal(await page.locator("#chat .msg.tutor").count(), 2);
  if (shots) await page.screenshot({ path: `${shots}/study-mobile.png`, animations: "disabled", fullPage: true });

  // S6: never asked for a camera.
  seen.cameraAsks = await page.evaluate(() => window.__cameraAsks);
  assert.equal(seen.cameraAsks, 0);
  console.log(JSON.stringify({ ok: true, ...seen }));
} finally {
  await browser.close();
}
