// Playwright check of study mode inside the Chrome extension, on a made-up news page.
// tests/test_study.py serves tests/study/fixtures/ and runs: node tests/study/extension.mjs <article-url>
// Chromium's own --headless=new (not Playwright's headless shell) because only it loads extensions.
// Real time (content scripts run in their own world, which Playwright's fake clock doesn't reach),
// so the baseline is seeded fast and a few seconds on a paragraph counts as slow.
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
  // A usual pace of 3 s per 100 words, from 10 earlier paragraphs.
  await sw.evaluate(() => chrome.storage.local.set(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`neurochat.study.s:seed${i}`, { v: 3000, t: i }]))));
  const page = await context.newPage();
  await page.goto(url);
  const study = () => sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.tabs.sendMessage(tab.id, { type: "neurochat:study" });
  });
  const lit = () => page.evaluate(() => document.querySelector(".neurochat-current")?.textContent.slice(0, 40) ?? null);

  // Off until asked: the page is untouched.
  assert.equal(await page.locator(".neurochat-dim").count(), 0);
  const on = await study();
  assert.deepEqual(on, { on: true, paragraphs: 8 }, "the article's 8 paragraphs: no nav, byline, sidebar or footer");
  assert.equal(await page.locator("html.neurochat-study").count(), 1);
  assert.equal(await page.locator(".neurochat-dim").count(), 7, "all but the lit paragraph dim");
  assert.match(await lit(), /^A battery is a small chemical factory/);
  assert.equal(await page.locator("neurochat-study").count(), 1);

  // Scrolling moves the light to the paragraph at the reading line; j moves one paragraph.
  await page.mouse.move(400, 400);
  // Scroll just enough to bring paragraph 2 up to the reading line.
  const delta = await page.evaluate(() => document.querySelectorAll("article p:not(.byline)")[1].getBoundingClientRect().top - innerHeight * 0.38 + 12);
  await page.mouse.wheel(0, delta);
  await page.waitForFunction(() => /^The side that gives/.test(document.querySelector(".neurochat-current")?.textContent));
  await page.keyboard.press("j");
  await page.waitForFunction(() => /^The electrochemical/.test(document.querySelector(".neurochat-current")?.textContent));
  seen.follows = "wheel and j";

  // A few seconds on the dense paragraph is well over 1.5× a 3 s/100 words pace: quiet cue, no popup.
  await page.waitForFunction(() => document.querySelector(".neurochat-current.neurochat-slow"), null, { timeout: 15000 });
  await page.waitForTimeout(400); // the edge fades in
  const edge = await page.evaluate(() => getComputedStyle(document.querySelector(".neurochat-current")).boxShadow);
  assert.match(edge, /rgba\(229, 138, 0/);
  assert.equal(await page.locator("[role=dialog]:visible, dialog[open]").count(), 0);
  seen.slow = "amber edge, dark Explain pill";

  // Explain hands the paragraph and its pace to the side chat.
  const pill = await page.evaluateHandle(() => document.querySelector("neurochat-study"));
  assert.ok(pill);
  const box = await page.evaluate(() => {
    const r = document.querySelector(".neurochat-current").getBoundingClientRect();
    return { x: Math.min(r.right + 40, innerWidth - 40), y: Math.max(r.top, 8) + 14 };
  });
  // Catch the handoff as it is written: the side panel deletes "pending" as soon as it reads it.
  await sw.evaluate(() => {
    self.__pending = null;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "session" && changes.pending?.newValue && !self.__pending) self.__pending = changes.pending.newValue;
    });
  });
  await page.mouse.click(box.x, box.y);
  const pending = await sw.evaluate(async () => {
    for (let k = 0; k < 50 && !self.__pending; k++) await new Promise((r) => setTimeout(r, 100));
    return self.__pending;
  });
  assert.ok(pending, "Explain reached the side chat");
  assert.match(pending.text, /^The electrochemical potential difference/);
  assert.equal(pending.medianMsPer100Words, 3000);
  assert.ok(pending.dwellMsPer100Words >= 4500, JSON.stringify(pending));
  assert.equal(pending.url, url);
  seen.explain = { dwellMsPer100Words: pending.dwellMsPer100Words, medianMsPer100Words: pending.medianMsPer100Words };

  // Leaving a paragraph adds it to the shared baseline; Esc turns study mode off and cleans up.
  await page.keyboard.press("j");
  await page.waitForFunction(() => /^When you plug/.test(document.querySelector(".neurochat-current")?.textContent));
  const readings = () => sw.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith("neurochat.study.s:")));
  const stored = await readings();
  assert.ok(stored.length >= 11, `baseline grew: ${stored.length}`);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".neurochat-dim, .neurochat-current, html.neurochat-study, neurochat-study").count(), 0);
  seen.cleanup = "Esc removes every trace";

  // Turning it off and on again on the same page doesn't count a paragraph twice.
  const before = (await readings()).length;
  await study(); await page.waitForTimeout(300); await study();
  assert.equal((await readings()).length, before, "re-lighting a paragraph replaces its reading instead of adding one");

  // Real-site shapes (fixtures/tricky.html).
  await page.goto(new URL("tricky.html", url).href);
  const t = await study();
  assert.equal(t.paragraphs, 6, "the main text: not the promo card, table, reference, or the dd's inner p twice");
  assert.equal(await page.locator("dd.neurochat-dim p.neurochat-dim, dd p.neurochat-current").count(), 0, "no nested paragraph is dimmed separately");
  // Typing j in a search box inside a web component types; it doesn't move the light or exit.
  await page.locator("search-box input").click();
  await page.keyboard.type("jk");
  assert.equal(await page.locator("search-box input").inputValue(), "jk");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("html.neurochat-study").count(), 1, "Esc in a text box doesn't turn study mode off");
  // The text scrolls inside a panel: the light follows it, and new paragraphs join as they load.
  await page.locator("#content").click({ position: { x: 600, y: 10 } });
  await page.mouse.move(700, 400);
  for (let k = 0; k < 8; k++) { await page.mouse.wheel(0, 250); await page.waitForTimeout(80); }
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => [document.querySelectorAll(".neurochat-dim, .neurochat-current").length, document.querySelector(".neurochat-current")?.textContent.slice(0, 22)]);
  assert.ok(after[0] > 6, `paragraphs that loaded later joined: ${after[0]}`);
  assert.ok(after[1] && !/^Docs paragraph one/.test(after[1]), `the light followed the panel: ${after[1]}`);
  await page.keyboard.press("Escape");
  seen.realSites = "promo card, panel scrolling, late paragraphs, web-component input, dd>p, references, table";

  // A page with nothing to study says so instead of doing nothing.
  await page.goto(new URL("empty.html", url).href);
  assert.deepEqual(await study(), { on: false, paragraphs: 0 });
  await page.waitForFunction(() => document.querySelector("neurochat-study"));
  seen.empty = "says there's nothing to study";
  console.log(JSON.stringify({ ok: true, ...seen }));
} finally {
  await context.close();
}
