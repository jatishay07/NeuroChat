// Playwright check of the extension's signals page against a running companion
// on 127.0.0.1:8765 (the page's fixed address) that is replaying EEG.
// tests/test_signals.py runs: node tests/signals/browser.mjs <out-dir> <source-label> [--video]
// Chromium's own --headless=new, because only it loads extensions.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const [out, label, flag] = process.argv.slice(2);
const video = flag === '--video';
const ext = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../extension'
);

const context = await chromium.launchPersistentContext('', {
  headless: false,
  viewport: {width: 900, height: 1100},
  args: [
    '--headless=new',
    `--disable-extensions-except=${ext}`,
    `--load-extension=${ext}`,
  ],
  ...(video ? {recordVideo: {dir: out, size: {width: 900, height: 1100}}} : {}),
});
const seen = {};
try {
  const sw =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  const id = new URL(sw.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/signals/signals.html`);
  await page.waitForFunction(
    label => document.getElementById('sourceText').textContent.includes(label),
    label,
    {timeout: 15000}
  );
  seen.source = await page.textContent('#sourceText');
  // The waves are drawn as soon as a few seconds have streamed; the score
  // needs the 15 s window.
  await page.waitForFunction(
    () => document.getElementById('score').textContent !== '–',
    null,
    {timeout: 30000}
  );
  seen.score = await page.textContent('#score');
  seen.bucket = await page.textContent('#bucket');
  seen.alphaHz = await page.textContent('#alphaHz');
  const inked = await page.evaluate(() =>
    ['alphaWave', 'betaWave', 'bands', 'scoreLine'].map(id => {
      const c = document.getElementById(id);
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
      return n;
    })
  );
  assert.ok(
    inked.every(n => n > 200),
    `blank canvas: ${inked}`
  );
  // The prompt the tutor got (the test sent one explain before starting us).
  await page.waitForFunction(
    () =>
      document.getElementById('prompt').textContent.includes('patient tutor'),
    null,
    {timeout: 10000}
  );
  seen.marked = await page.textContent('#prompt mark');
  assert.ok(seen.marked.includes('EEG engagement'), seen.marked);
  await page.screenshot({
    path: path.join(out, 'signals-page.png'),
    fullPage: true,
  });
  await page.click('#tabNow');
  seen.preview = await page.textContent('#prompt');
  assert.ok(seen.preview.includes('patient tutor'));
  if (video)
    await page.waitForTimeout(
      Number(process.env.SIGNALS_VIDEO_SECONDS || 25) * 1000
    );
  // Narrow, as in a side panel.
  await page.setViewportSize({width: 400, height: 900});
  await page.click('#tabLast');
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: path.join(out, 'signals-narrow.png'),
    fullPage: true,
  });
  seen.ok = true;
} finally {
  await context.close();
  console.log(JSON.stringify(seen));
}
