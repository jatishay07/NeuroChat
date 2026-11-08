// Recording session for Phase 2 of the Reading Signals Plan. Walks the reader through calibration
// (eyes closed, a fixation dot, dot jumps of known angle, blinks and jaw clenches on cue), then an easy
// and a hard text one paragraph at a time, then a rating per paragraph. Every step goes to the
// companion over /ws/record, which stamps it on the same clock as the EEG and saves both.

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// ?quick runs the calibration 50 times faster, for checking the page without sitting through it.
const QUICK = new URLSearchParams(location.search).has('quick');
const wait = ms => sleep(QUICK ? ms / 50 : ms);

// Easy text: plain prose with two planted garden-path sentences (paragraphs 2 and 5) and a scripted
// reread (paragraph 4), so the analysis has slow lines and rereads at known places.
const EASY = [
  'Every morning the bakery on the corner opens at six. The owner unlocks the door, switches on the ovens and sets out the first trays of bread. By the time the street wakes up, the windows are already warm and fogged.',
  'Most customers come in for the same thing every day. The old man the boat every summer, so he buys extra rolls for the crew in June. The rest of the year he takes one small loaf and a coffee.',
  'On Saturdays the queue reaches the bus stop. Children press their noses to the glass to look at the cakes. Their parents count coins and argue about whether a second pastry counts as breakfast or as lunch.',
  'The bakery keeps a notebook of every recipe it has ever sold. Some pages are stained with butter and some are held together with tape. New staff read it on their first day and are told never to take it home.',
  'Flour arrives in heavy sacks on Tuesday afternoons. The truck driver delivered the flour complained about the narrow street. Since then the sacks are carried in from the corner, two at a time.',
  'In the evening the shelves are nearly empty. Whatever is left goes to the shelter down the road. The owner sweeps the floor, turns off the lights and walks home the same way she came.',
];
const EASY_SCRIPT = {
  3: 'Before you go on: reread the second sentence of this paragraph twice.',
};

// Hard text used when the reader doesn't paste their own.
const HARD = [
  "A Kalman filter keeps an estimate of a system's state together with a covariance that says how uncertain that estimate is. Each cycle it predicts the next state through a linear model, inflating the covariance by the process noise, and then corrects the prediction with a measurement weighted by how much the filter trusts it relative to its own forecast.",
  'The weighting is the Kalman gain, the product of the predicted covariance, the transpose of the measurement matrix and the inverse of the innovation covariance. When measurement noise dominates, the gain shrinks and the filter leans on its model; when the model is uncertain, the gain grows and new measurements pull the estimate harder.',
  'Optimality holds only under assumptions that rarely survive contact with hardware: linear dynamics, Gaussian noise that is white and uncorrelated with the state, and noise covariances that are known exactly. Violate any of them and the filter remains well defined but is no longer the minimum-variance estimator, and it may diverge silently while reporting a covariance that looks perfectly healthy.',
  'The extended Kalman filter linearises a nonlinear model around the current estimate using Jacobians, which works when the nonlinearity is mild over the spread of the uncertainty. The unscented variant instead propagates a small, deterministically chosen set of sigma points through the true nonlinear functions and recovers the mean and covariance from their images, capturing second-order effects without derivatives.',
  'Tuning is where most practical failures originate. Setting the process noise too low makes the filter overconfident, so it rejects legitimate changes in the state as noise; setting it too high makes the estimate jittery because every measurement is believed. Engineers often inspect the normalised innovation squared, which should follow a chi-squared distribution when the noise models are consistent.',
  'Observability decides whether any of this can work at all. If some combination of states never influences the measurements, no amount of filtering recovers it, and the corresponding covariance grows without bound. Checking the rank of the observability matrix before deployment is cheaper than discovering, in the field, that a bias was never identifiable.',
];

const ws = {sock: null, queue: []};
let meta = null; // screen and distance, for converting degrees to pixels
const paragraphs = []; // {block, index, text}

function send(msg) {
  msg.client_ms = Math.round(performance.now());
  if (ws.sock && ws.sock.readyState === WebSocket.OPEN)
    ws.sock.send(JSON.stringify(msg));
  else ws.queue.push(msg);
}

function openSocket() {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(`ws://${location.host}/ws/record`);
    sock.onopen = () => {
      ws.sock = sock;
      ws.queue.splice(0).forEach(m => sock.send(JSON.stringify(m)));
      resolve();
    };
    sock.onerror = () =>
      reject(new Error("Couldn't reach the companion. Is neurochat running?"));
    sock.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.type === 'error') console.warn('record:', m.message);
    };
  });
}

function setStep(n) {
  [...$('steps').children].forEach((el, i) => el.classList.toggle('on', i < n));
  $('steps').setAttribute('aria-label', `Step ${n} of 4`);
}

function showOnly(id) {
  for (const s of ['setup', 'calib', 'reading', 'rate', 'done'])
    $(s).hidden = s !== id;
}

async function checkHeadset() {
  try {
    const r = await (await fetch('/api/record')).json();
    const on = r.headset === 'streaming';
    $('headsetDot').classList.toggle('on', on);
    $('headsetText').textContent = on
      ? 'Headset streaming'
      : 'Headset not streaming: connect it first, or record page events only';
  } catch {
    $('headsetText').textContent = 'Companion not reachable';
  }
}

// ---- calibration ------------------------------------------------------------------------------------

function beep(freq = 660, ms = 180) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, ms);
  } catch {
    /* no audio: the on-screen cue still shows */
  }
}

function cue(text) {
  const el = $('cue');
  el.textContent = text;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function degToPx(deg) {
  const mmPerPx = meta.screen_mm / meta.screen_px;
  return (
    window.innerWidth / 2 +
    (Math.tan((deg * Math.PI) / 180) * meta.distance_mm) / mmPerPx
  );
}

function placeDot(xDeg) {
  // Clamp to the window, and log the angle actually shown.
  const margin = 24;
  let x = degToPx(xDeg);
  x = Math.min(window.innerWidth - margin, Math.max(margin, x));
  const mmPerPx = meta.screen_mm / meta.screen_px;
  const shown =
    (Math.atan(((x - window.innerWidth / 2) * mmPerPx) / meta.distance_mm) *
      180) /
    Math.PI;
  const dot = $('dot');
  dot.hidden = false;
  dot.style.left = `${x}px`;
  dot.style.top = `${window.innerHeight / 2}px`;
  send({
    type: 'dot',
    x_deg: Math.round(shown * 100) / 100,
    x_px: Math.round(x),
  });
}

// Jumps of 5, 10 and 15 degrees in both directions, starting and ending at centre.
function dotSequence() {
  const seq = [0];
  const steps = [
    5, -5, 10, -10, 15, -15, 5, 10, -5, -10, 15, -15, 10, 5, -15, 15, -10, -5,
    5, 15, -5, -15, 10, -10,
  ];
  let at = 0;
  for (const s of steps) {
    let next = at + s;
    if (Math.abs(next) > 15) next = at - s; // stay within ±15°
    seq.push(next);
    at = next;
  }
  seq.push(0);
  return seq;
}

async function phase(name, fn) {
  send({type: 'step', name, state: 'start'});
  await fn();
  send({type: 'step', name, state: 'end'});
}

async function calibrate() {
  showOnly('calib');
  setStep(2);
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    /* fine without it */
  }
  await wait(500);
  await phase('eyes-closed', async () => {
    cue('Close your eyes and relax. A tone tells you when to open them.');
    await wait(4000);
    beep(440);
    await wait(60000);
    beep(880, 300);
  });
  await phase('fixate', async () => {
    cue('');
    placeDot(0);
    await wait(30000);
  });
  await phase('dots', async () => {
    cue('');
    for (const x of dotSequence()) {
      placeDot(x);
      await wait(1500);
    }
    $('dot').hidden = true;
  });
  await phase('blinks', async () => {
    for (let i = 0; i < 10; i++) {
      cue('Blink');
      send({type: 'cue', what: 'blink'});
      await wait(600);
      cue('');
      await wait(1900);
    }
  });
  await phase('clench', async () => {
    for (let i = 0; i < 5; i++) {
      cue('Clench your jaw');
      send({type: 'cue', what: 'clench'});
      await wait(1000);
      cue('Relax');
      await wait(3000);
    }
    cue('');
  });
  if (document.fullscreenElement)
    await document.exitFullscreen().catch(() => {});
}

// ---- reading ----------------------------------------------------------------------------------------

function renderParagraph(text) {
  const p = $('para');
  p.replaceChildren(
    ...text.split(/(\s+)/).map(tok => {
      if (/^\s+$/.test(tok)) return document.createTextNode(tok);
      const s = document.createElement('span');
      s.className = 'w';
      s.textContent = tok;
      return s;
    })
  );
}

// Group word spans into visual lines and report their screen boxes and words.
function lineLayout() {
  const lines = [];
  for (const w of $('para').querySelectorAll('.w')) {
    const r = w.getBoundingClientRect();
    let line = lines.at(-1);
    if (!line || Math.abs(r.top - line.top) > r.height / 2) {
      line = {
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        words: [],
      };
      lines.push(line);
    }
    line.right = Math.max(line.right, r.right);
    line.bottom = Math.max(line.bottom, r.bottom);
    line.words.push(w.textContent);
    w.dataset.line = String(lines.length - 1);
  }
  return lines.map(l => ({
    top: Math.round(l.top),
    bottom: Math.round(l.bottom),
    left: Math.round(l.left),
    right: Math.round(l.right),
    text: l.words.join(' '),
  }));
}

function waitForNext() {
  return new Promise(resolve => {
    const done = () => {
      $('nextBtn').removeEventListener('click', done);
      document.removeEventListener('keydown', key);
      resolve();
    };
    const key = e => {
      if (e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        done();
      }
    };
    $('nextBtn').addEventListener('click', done);
    document.addEventListener('keydown', key);
  });
}

async function readBlock(block, texts, script = {}) {
  await phase(block, async () => {
    for (let i = 0; i < texts.length; i++) {
      $('where').textContent =
        `${block === 'easy' ? 'Easy' : 'Hard'} text · ${i + 1} of ${texts.length}`;
      renderParagraph(texts[i]);
      $('script').hidden = !script[i];
      $('script').textContent = script[i] || '';
      await new Promise(requestAnimationFrame);
      const n = paragraphs.push({block, index: i, text: texts[i]}) - 1;
      send({
        type: 'paragraph',
        state: 'show',
        block,
        index: i,
        n,
        lines: lineLayout(),
        window: [window.innerWidth, window.innerHeight],
      });
      if (script[i])
        send({
          type: 'script',
          what: 'reread',
          block,
          index: i,
          n,
          sentence: 2,
          times: 2,
        });
      await waitForNext();
      send({type: 'paragraph', state: 'hide', block, index: i, n});
    }
  });
}

$('para').addEventListener('click', e => {
  const w = e.target.closest('.w');
  if (!w) return;
  const line = Number(w.dataset.line);
  for (const s of $('para').querySelectorAll(`.w[data-line="${line}"]`))
    s.classList.toggle('explain');
  const p = paragraphs.at(-1);
  send({
    type: 'explain',
    block: p.block,
    index: p.index,
    n: paragraphs.length - 1,
    line,
    on: w.classList.contains('explain'),
  });
});

// ---- ratings and save -------------------------------------------------------------------------------

function rateAll() {
  showOnly('rate');
  setStep(4);
  const ratings = new Map();
  const list = $('ratings');
  list.replaceChildren(
    ...paragraphs.map((p, n) => {
      const li = document.createElement('li');
      const snip = document.createElement('span');
      snip.className = 'snip';
      snip.textContent = `${p.block === 'easy' ? 'Easy' : 'Hard'} ${p.index + 1}: ${p.text}`;
      const choice = document.createElement('span');
      choice.className = 'choice';
      for (const value of ['easy', 'ok', 'hard']) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent =
          value === 'ok' ? 'OK' : value[0].toUpperCase() + value.slice(1);
        b.addEventListener('click', () => {
          ratings.set(n, value);
          choice
            .querySelectorAll('button')
            .forEach(x => x.classList.toggle('on', x === b));
          $('finishBtn').disabled = ratings.size < paragraphs.length;
        });
        choice.append(b);
      }
      li.append(snip, choice);
      return li;
    })
  );
  return new Promise(resolve => {
    $('finishBtn').onclick = () => {
      for (const [n, value] of ratings) {
        const p = paragraphs[n];
        send({type: 'rating', block: p.block, index: p.index, n, value});
      }
      resolve();
    };
  });
}

async function save() {
  await sleep(300); // let the last events reach the companion
  const r = await fetch('/api/record/stop', {method: 'POST'});
  const s = await r.json();
  showOnly('done');
  $('savedWhere').textContent =
    `Session ${s.id}: ${Math.round(s.seconds / 60)} min, ${s.events} events.`;
  const rows = [];
  if (s.note) rows.push(s.note);
  if (s.blinks !== undefined)
    rows.push(
      `Blinks found: ${s.blinks}${s.blink_cues ? ` (${s.blink_cues_caught} of ${s.blink_cues} cued)` : ''}`
    );
  if (s.clench_cues)
    rows.push(
      `Jaw clenches caught: ${s.clench_cues_caught} of ${s.clench_cues}`
    );
  for (const row of s.dot_jumps || []) {
    if (row.jumps)
      rows.push(`Dot jumps ${row.size_deg}°: ${row.hits} of ${row.jumps} seen`);
  }
  if (s.gain_uv_per_degree)
    rows.push(`Eye signal: ${s.gain_uv_per_degree} µV per degree`);
  $('summary').replaceChildren(
    ...rows.map(t =>
      Object.assign(document.createElement('li'), {textContent: t})
    )
  );
}

$('startBtn').addEventListener('click', async () => {
  $('message').textContent = '';
  $('message').classList.remove('error');
  const screenCm = Number($('screenCm').value),
    distanceCm = Number($('distanceCm').value);
  if (!(screenCm > 0 && distanceCm > 0)) {
    $('message').textContent =
      'Enter the screen width and your distance from it.';
    $('message').classList.add('error');
    return;
  }
  meta = {
    screen_mm: screenCm * 10,
    screen_px: window.screen.width,
    distance_mm: distanceCm * 10,
    device_pixel_ratio: window.devicePixelRatio,
    user_agent: navigator.userAgent,
  };
  const pasted = $('hardText')
    .value.split(/\n\s*\n/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const hard = pasted.length ? pasted : HARD;
  try {
    const r = await fetch('/api/record/start', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        ...meta,
        easy: EASY,
        hard,
        hard_source: pasted.length ? 'pasted' : 'built-in',
      }),
    });
    if (!r.ok)
      throw new Error((await r.json()).detail || "Couldn't start recording.");
    await openSocket();
  } catch (e) {
    $('message').textContent = e.message;
    $('message').classList.add('error');
    return;
  }
  await calibrate();
  showOnly('reading');
  setStep(3);
  await readBlock('easy', EASY, EASY_SCRIPT);
  await readBlock('hard', hard);
  await rateAll();
  await save();
});

checkHeadset();
setInterval(() => {
  if (!$('setup').hidden) checkHeadset();
}, 3000);
