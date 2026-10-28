// Records a narrated video of study mode's features in the Chrome extension (not part of the suite):
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
await page.goto(`chrome-extension://${id}/study/options.html`);
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

// ---- the switches ----
await say("13 new study-mode features, each with its own switch. You choose which to keep.", 3600);
await page.mouse.wheel(0, 380);
await say("The main ones: E to explain, explain a selection, Plainer, Got it / Still lost, key terms, quick check, review, break reminder.", 4200);
await page.locator("summary").click();
await page.mouse.wheel(0, 600);
await say("Advanced: expected pace, rereads, self-tuning, look-back, data export, and the headset signals + simulator.", 4200);

// ---- the article ----
await page.goto(url);
await page.mouse.move(420, 420);
await say("A normal article. Alt+Shift+S (or right-click › Study this page) turns study mode on.", 3000);
await tabMsg({ type: "neurochat:study" });
// The real side panel follows the tab it was opened on; this stand-in page is pointed at it by hand.
await panel.evaluate(async (u) => { const [t] = await chrome.tabs.query({ url: u }); await follow(t); }, url);
let s = await state();
await say(`Expected pace: ¶3 is dense, so it's expected to take ${(s.expected[2] / s.expected[0]).toFixed(1)}× as long as ¶1. Dense text isn't flagged just for being dense.`, 4600);
await say("Before you read: the side chat lists the page's key terms, and the tutor has defined them.", 1500);
await panel.locator("#terms summary").click();
await say("Before you read: the side chat lists the page's key terms, and the tutor has defined them.", 3000);
await say("Your usual pace is seeded for this video (4 s per 100 words). Now I read ¶1 slowly…", 1500);
await until(async () => (await state()).slow[0], 12000);
await say("…slower than expected for you: a quiet amber edge, and the key terms in it get a dotted underline (hover shows the meaning).", 4600);
await say("The Plainer button only shows up on a paragraph that slowed you down.", 2800);

// ---- headset simulator ----
await say("Headset simulator (a developer switch): a headset says you reread line 2…", 1600);
await signal({ kind: "reread", line: 1 });
await say("…and on a slow paragraph that line gets underlined. Never a popup.", 3200);
await say("A jaw clench presses Explain for you.", 1200);
await signal({ kind: "clench" });
await answered(1);
await say("The tutor explains it, knowing how slow you were and that you reread it.", 2600);
await say("Under the answer: Got it / Still lost. They tell study mode whether the explanation worked.", 2800);
await panel.locator(".turn-tutor .actions button", { hasText: "Still lost" }).click();
await answered(2);
await say("Still lost asks the tutor for another way of putting it.", 3400);

// ---- selection and the e key ----
await page.keyboard.press("j");
await pause(900);
await page.evaluate(() => {
  const p = document.querySelectorAll("article p")[2];
  const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  while (w.nextNode() && !w.currentNode.data.includes("the cathode"));
  const t = w.currentNode, i = t.data.indexOf("the cathode");
  const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + "the cathode".length);
  getSelection().removeAllRanges(); getSelection().addRange(r);
});
await say("Select a phrase in the lit paragraph: the button becomes “Explain selection”.", 2800);
await page.keyboard.press("e");
await answered(3);
await page.evaluate(() => getSelection().removeAllRanges());
await say("E explains it. The tutor gets the phrase and the paragraph around it.", 3000);

// ---- look-back ----
await page.keyboard.press("j");
await pause(900);
await page.keyboard.press("e");
await say("Look-back: explaining ¶3 also sends the earlier paragraphs in this section that slowed you down.", 1800);
await answered(4);
await say("Look-back: explaining ¶3 also sends the earlier paragraphs in this section that slowed you down (“Also sent”).", 2600);

// ---- plainer ----
await say("Press P: the paragraph is rewritten in plain words, right where it is…", 1200);
await page.keyboard.press("p");
await until(async () => (await state()).alt === "Original", 15000);
await say("…with a thin rule to show it's rewritten. P (or Original) brings back the author's words.", 3000);
await page.keyboard.press("p");
await say("The original, exactly as it was.", 1800);
await page.keyboard.press("p");
await pause(600);

// ---- quick check ----
await page.keyboard.press("j");
await pause(900);
await say("Moving on from a section you struggled in: the dock offers a quick check. Never by itself.", 3200);
await state({ press: "offer" });
await answered(5);
await say("One question, answered from memory in your own words.", 1200);
await panel.locator("#askInput").pressSequentially("The charger has to push harder than the battery's own voltage.", { delay: 28 });
await panel.locator("#askInput").press("Enter");
await answered(6);
await say("The tutor marks it, and it comes back for review in 1 day, then 3, then 7.", 3600);

// ---- break reminder ----
await state({ suggestBreak: true });
await say("Break reminder: after 20 min, if you've slowed down a lot since the start (shown by hand here).", 3800);
await state({ press: "close" });

// ---- read on, then the review ----
await say("Read on…", 600);
for (let k = 0; k < 4; k++) { await page.keyboard.press("j"); await pause(1900); }
await page.keyboard.press("Escape");
await say("Exit: a session card. Amber bars slowed you down; tap one to go back. Download data (CSV) is for research.", 5000);
await state({ press: "done" });
await say("The page is exactly as it was. Every feature here can be switched off.", 3000);

const videos = [await page.video().path(), await panel.video().path()];
await context.close();
console.log(JSON.stringify(videos));
