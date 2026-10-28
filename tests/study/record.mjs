// Records a narrated video of the study-mode flow (not part of the suite):
//   python -m companion --simulate  (or any running companion), then
//   node tests/study/record.mjs http://127.0.0.1:8765 <out-dir>
// Reading time is simulated with Playwright's clock (each paragraph's seconds are fast-forwarded);
// the caption bar at the top says what is being done and what was simulated.
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const [base, out = '.'] = process.argv.slice(2);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: {width: 1280, height: 800},
  recordVideo: {dir: out, size: {width: 1280, height: 800}},
});
const page = await context.newPage();
await page.clock.install();
await page.clock.resume();
const pause = ms => page.waitForTimeout(ms);
async function say(text, ms = 1800) {
  await page.evaluate(t => {
    let el = document.getElementById('__caption');
    if (!el) {
      el = document.createElement('div');
      el.id = '__caption';
      el.style.cssText =
        'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9999;max-width:760px;padding:10px 18px;border-radius:14px;background:rgba(11,13,18,.82);color:#fff;font:500 14px/1.4 -apple-system,Inter,system-ui,sans-serif;text-align:center;pointer-events:none';
      document.body.append(el);
    }
    el.textContent = t;
  }, text);
  await pause(ms);
}
const state = () => page.evaluate(() => window.studyState());
const words = () =>
  page.evaluate(() =>
    window.StudyPace.parseText(
      document.getElementById('source').value
    ).paragraphs.map(p => window.StudyPace.words(p))
  );
const readFor = async (n, factor, label) => {
  const w = (await words())[n];
  const ms = Math.round(w * 200 * factor);
  await say(
    `${label}: simulating ${Math.round(ms / 1000)} s of reading (${w} words)`,
    1400
  );
  await page.clock.fastForward(ms);
  await pause(1300);
};

await page.goto(`${base}/study.html`);
await page.evaluate(() => {
  localStorage.clear();
});
await page.reload();
await say(
  'Study mode: no headset, no camera. Start with the sample passage.',
  2600
);
await page.getByRole('link', {name: 'try a sample passage'}).click();
await say(
  'One paragraph at a time. The dock at the bottom shows where you are.',
  2400
);

await readFor(0, 1, 'Paragraph 1 at a normal pace');
await say(
  'Scrolling down moves to the next paragraph (one per gesture).',
  1500
);
await page.mouse.move(640, 420);
await page.mouse.wheel(0, 300);
await pause(1200);
await readFor(1, 1, 'Paragraph 2 at a normal pace');
await say('The → arrow key also moves on.', 1300);
await page.keyboard.press('ArrowRight');
await pause(900);
await readFor(2, 1.1, 'Paragraph 3 at a normal pace');
await page.getByRole('button', {name: 'Next paragraph'}).click();
let s = await state();
await say(
  `Baseline so far: ${Math.round(s.stats.median / 1000)} s per 100 words over ${s.stats.samples} paragraphs (your own pace).`,
  2800
);

await readFor(3, 2.2, 'Paragraph 4, read 2.2× slower than usual');
await say(
  'Much slower than your usual pace: a quiet amber cue, and Explain turns dark. No popup.',
  3200
);
await say(
  'Press Explain: the paragraph goes to the local tutor with your pace attached.',
  2000
);
await page.getByRole('button', {name: 'Explain'}).click();
await page.locator('#chat .msg.tutor:not(.typing)').waitFor();
await say(
  'The answer streams in under the paragraph (stand-in tutor in this recording).',
  2600
);
await page
  .locator('#askInput')
  .pressSequentially('What is graphite?', {delay: 60});
await page.locator('#askInput').press('Enter');
await page.waitForFunction(
  () => document.querySelectorAll('#chat .msg.tutor:not(.typing)').length === 2
);
await say('Follow-up questions keep the same conversation.', 2200);
await page.getByRole('button', {name: 'Got it'}).click();
await say('Got it collapses the answer.', 1500);

await page.getByRole('button', {name: 'Next paragraph'}).click();
await readFor(4, 1, 'Paragraph 5 at a normal pace');
await page.getByRole('button', {name: 'Next paragraph'}).click();
await say('Finished: the slow paragraph is listed to revisit.', 2600);
await page.reload();
await say('After a reload, your pace is remembered for next time.', 2800);

await context.close();
const video = await page.video().path();
await browser.close();
console.log(video);
