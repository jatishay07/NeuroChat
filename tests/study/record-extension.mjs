// Records a narrated video of study mode in the Chrome extension (not part of the suite):
// the article on the left, the side chat on the right (opened as a page, because a headless
// browser can't show Chrome's side panel). Needs a companion on 127.0.0.1:8765 for the chat.
//   node tests/study/record-extension.mjs <article-url> <out-dir>
// Real time throughout; the usual pace is seeded (the caption says so) so the slow cue shows up
// in seconds rather than after a real reading session.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [url, out = "."] = process.argv.slice(2);
const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extension");
const H = 760;

const context = await chromium.launchPersistentContext("", {
  channel: "chromium", headless: true, viewport: { width: 960, height: H },
  recordVideo: { dir: out, size: { width: 960, height: H } },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const sw = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
const id = new URL(sw.url()).host;
await sw.evaluate(() => chrome.storage.local.set(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`neurochat.study.s:seed${i}`, { v: 6000, t: i }]))));
// The real side panel would take space from this window; the recording shows the chat as a page instead.
await sw.evaluate(() => { chrome.sidePanel.open = async () => {}; });

const panel = await context.newPage();
await panel.setViewportSize({ width: 400, height: H });
await panel.goto(`chrome-extension://${id}/sidepanel.html`);
const page = await context.newPage();
await page.goto(url);
await page.bringToFront();

const pause = (ms) => page.waitForTimeout(ms);
async function say(text, ms = 2200) {
  await page.evaluate((t) => {
    let el = document.getElementById("__caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "__caption";
      el.style.cssText = "position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483647;width:max-content;max-width:820px;padding:9px 16px;border-radius:12px;background:rgba(11,13,18,.84);color:#fff;font:500 14px/1.4 -apple-system,Inter,system-ui,sans-serif;text-align:center;pointer-events:none";
      document.documentElement.append(el);
    }
    el.textContent = t;
  }, text);
  await pause(ms);
}
const study = () => sw.evaluate(async (u) => {
  const [tab] = await chrome.tabs.query({ url: u });
  return chrome.tabs.sendMessage(tab.id, { type: "neurochat:study" });
}, url);
const scrollTo = async (i) => {
  const d = await page.evaluate((k) => document.querySelectorAll("article p:not(.byline)")[k].getBoundingClientRect().top - innerHeight * 0.38 + 12, i);
  await page.mouse.wheel(0, d);
};

await say("A normal news site in Chrome, with the NeuroChat extension and its side chat on the right.", 3200);
await say("Right-click › “Study this page” (or Alt+Shift+S) turns on study mode.", 2400);
await study();
await say("The paragraph you're reading stays lit, the rest dim. It is being timed.", 3000);
await say("Your usual pace was learned from earlier reading (seeded for this video: 6 s per 100 words).", 3200);
await page.mouse.move(420, 420);
await scrollTo(1);
await say("Scroll as usual: the light follows the paragraph at your reading line.", 3200);
await page.keyboard.press("j");
await say("Or press j / k to move one paragraph. This one is dense…", 2600);
await say("…so you slow down. Watch the left edge and the Explain button.", 5200);
await say("Much slower than your usual pace: a quiet amber edge, and Explain turns dark. No popup.", 3600);
const box = await page.evaluate(() => {
  const r = document.querySelector(".neurochat-current").getBoundingClientRect();
  return { x: Math.min(r.right + 40, innerWidth - 40), y: Math.max(r.top, 8) + 14 };
});
await page.mouse.click(box.x, box.y);
await say("Explain sends the paragraph, and how long it took you, to the side chat.", 1500);
await panel.locator(".tutor, .msg, [class*=answer]").first().waitFor({ timeout: 15000 }).catch(() => {});
await say("The local tutor's answer streams in beside the page (stand-in tutor in this video).", 6500);
await page.keyboard.press("j");
await say("Carry on reading. Esc or Exit turns study mode off and leaves the page as it was.", 3000);
await page.keyboard.press("Escape");
await pause(2000);

const videos = [await page.video().path(), await panel.video().path()];
await context.close();
console.log(JSON.stringify(videos));
