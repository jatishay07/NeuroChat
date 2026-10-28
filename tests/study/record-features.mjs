// Records a narrated video of hands-free study mode in the Chrome extension (not part of the suite):
// the page on the left, the side chat on the right (opened as a page, because a headless browser
// can't show Chrome's side panel). Needs the stand-in tutor on 127.0.0.1:8765:
//   python tests/study/standin.py 0.04 &   node tests/study/record-features.mjs <article-url> <out-dir>
// Real time throughout. Seeded or simulated parts say so in the caption.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [url, out = "."] = process.argv.slice(2);
const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extension");
const H = 760;

const context = await chromium.launchPersistentContext("", {
  headless: false, viewport: { width: 960, height: H },
  recordVideo: { dir: out, size: { width: 960, height: H } },
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const sw = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
const id = new URL(sw.url()).host;
await sw.evaluate(() => chrome.storage.local.set({
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`neurochat.study.s:seed${i}`, { v: 4000, t: i, x: [0, 0, 0, 0] }])),
  "neurochat.study.features": { simulator: true },
}));
await sw.evaluate(() => { chrome.sidePanel.open = async () => {}; }); // the chat is a page in this video

const panel = await context.newPage();
await panel.setViewportSize({ width: 400, height: H });
await panel.goto(`chrome-extension://${id}/sidepanel.html`);
const page = await context.newPage();
await page.goto(url);
await page.bringToFront();

const pause = (ms) => page.waitForTimeout(ms);
async function say(text, ms = 2600) {
  await page.evaluate((t) => {
    let el = document.getElementById("__caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "__caption";
      el.style.cssText = "position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483647;width:max-content;max-width:860px;padding:9px 16px;border-radius:12px;background:rgba(11,13,18,.84);color:#fff;font:500 14px/1.4 -apple-system,Inter,system-ui,sans-serif;text-align:center;pointer-events:none";
      document.documentElement.append(el);
    }
    el.textContent = t;
  }, text);
  await pause(ms);
}
const tabMsg = (msg) => sw.evaluate(async ([u, m]) => {
  const [tab] = await chrome.tabs.query({ url: u });
  return chrome.tabs.sendMessage(tab.id, m);
}, [url, msg]);
const state = (extra = {}) => tabMsg({ type: "neurochat:study-test", ...extra });
const signal = (s) => page.evaluate((d) => dispatchEvent(new CustomEvent("neurochat:signal", { detail: JSON.stringify(d) })), s);
const until = async (f, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return; await pause(150); } };
const n = async () => panel.locator(".turn-tutor").count();
const answered = async (k) => { await until(async () => (await n()) >= k && !(await panel.locator(".turn-tutor.typing").count())); };

await page.mouse.move(420, 420);
await say("Study mode, kept to the minimum: nothing to press while you read.", 3200);
await say("Alt+Shift+S (or right-click › Study this page) turns it on and opens the side chat.", 2400);
await tabMsg({ type: "neurochat:study" });
// The real side panel follows the tab it was opened on; this stand-in page is pointed at it by hand.
await panel.evaluate(async (u) => { const [t] = await chrome.tabs.query({ url: u }); await follow(t); }, url);
let s = await state();
await say(`Only the paragraph you're on stays lit. ¶3 is dense, so it's expected to take ${(s.expected[2] / s.expected[0]).toFixed(1)}× as long as ¶1.`, 3800);
await say("Your usual pace is seeded for this video (4 s per 100 words). I read ¶1 slowly…", 1500);
await until(async () => (await state()).slow[0], 12000);
await say("…slower than expected for you: a quiet amber edge. Slow alone doesn't interrupt you.", 3400);
await page.keyboard.press("j");
await say("I move on…", 1400);
await page.keyboard.press("k");
await say("…and go back to it. Slow on the first read, then reread: two signs that agree.", 2400);
await answered(1);
await say("So it's explained in the side chat by itself, knowing how slow you were and that you went back.", 4200);
await page.keyboard.press("j");
await pause(900);
await page.keyboard.press("k");
await say("Still going back after the explanation? Once, it's explained a different way.", 2400);
await answered(2);
await say("Still going back after the explanation? Once, it's explained a different way.", 2600);

// ---- headset simulator ----
await say("With the headset (a simulator here): it says you reread line 2…", 1600);
await signal({ kind: "reread", line: 1 });
await say("…and on a slow paragraph that line gets underlined. Never a popup.", 3000);
await page.keyboard.press("j");
await pause(700);
await page.keyboard.press("j");
await pause(900);
await say("A jaw clench means \"explain this now\", slow or not.", 1400);
await signal({ kind: "clench" });
await answered(3);
await say("The tutor also gets the earlier paragraphs in this section that slowed you down (“Also sent”).", 3600);

await say("Read on…", 600);
for (let k = 0; k < 3; k++) { await page.keyboard.press("j"); await pause(1600); }
await page.keyboard.press("Escape");
await say("Esc or Exit: the page is exactly as it was.", 3000);

const videos = [await page.video().path(), await panel.video().path()];
await context.close();
console.log(JSON.stringify(videos));
