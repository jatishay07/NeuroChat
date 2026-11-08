// The signals page: draws what the companion's headset buffer holds (alpha and
// beta waves, band power over the last minute, the engagement score and its
// band) and shows the system prompt the tutor was last given. Polls the
// companion's /api/engagement/signals and /api/engagement/prompt.
const COMPANION = '127.0.0.1:8765';
const MEASURED = 'What the eye tracker and headset measured';
const $ = id => document.getElementById(id);
const css = name =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let prompts = {last: null, preview: ''};
let tab = 'last';

// ---------- drawing ----------

function sized(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = Number(canvas.getAttribute('height'));
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = `${h}px`;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return [ctx, w, h];
}

function line(ctx, points, color, width = 1.6) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let pen = false;
  for (const p of points) {
    if (p === null) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(p[0], p[1]);
    else ctx.moveTo(p[0], p[1]);
    pen = true;
  }
  ctx.stroke();
}

function drawWave(canvas, values, color) {
  const [ctx, w, h] = sized(canvas);
  if (!values || !values.length) return;
  const peak = Math.max(4, ...values.map(Math.abs));
  const mid = h / 2 + 6;
  ctx.fillStyle = 'rgba(11, 13, 18, 0.06)';
  ctx.fillRect(0, mid, w, 1);
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    mid - (v / peak) * (h / 2 - 10),
  ]);
  line(ctx, pts, color);
  ctx.fillStyle = css('--muted');
  ctx.font = '11px ' + css('--font');
  ctx.textAlign = 'right';
  ctx.fillText(`±${peak.toFixed(0)} µV`, w, 12);
}

function drawBands(canvas, s) {
  const [ctx, w, h] = sized(canvas);
  const n = s.seconds.length;
  if (!n) return;
  const x = i => (n === 1 ? w : (i / (n - 1)) * w);
  const y = share => h - 4 - share * (h - 8);
  ctx.fillStyle = 'rgba(11, 13, 18, 0.05)';
  for (const share of [0.25, 0.5, 0.75]) ctx.fillRect(0, y(share), w, 1);
  const share = key =>
    s[key].map((v, i) => {
      const total = (s.theta[i] ?? 0) + (s.alpha[i] ?? 0) + (s.beta[i] ?? 0);
      return v === null || !total ? null : [x(i), y(v / total)];
    });
  line(ctx, share('theta'), css('--theta'));
  line(ctx, share('alpha'), css('--alpha'), 2);
  line(ctx, share('beta'), css('--beta'), 2);
}

function drawScore(canvas, s) {
  const [ctx, w, h] = sized(canvas);
  const n = s.seconds.length;
  const y = v => h - 2 - v * (h - 4);
  // The three bands behind the line.
  ctx.fillStyle = css('--low');
  ctx.fillRect(0, y(0.3), w, y(0) - y(0.3));
  ctx.fillStyle = css('--moderate');
  ctx.fillRect(0, y(0.6), w, y(0.3) - y(0.6));
  ctx.fillStyle = css('--high');
  ctx.fillRect(0, y(1), w, y(0.6) - y(1));
  if (!n) return;
  const x = i => (n === 1 ? w : (i / (n - 1)) * w);
  line(
    ctx,
    s.score.map((v, i) => (v === null ? null : [x(i), y(v)])),
    css('--fg'),
    2
  );
}

// ---------- the prompt ----------

function showPrompt() {
  $('tabLast').setAttribute('aria-selected', String(tab === 'last'));
  $('tabNow').setAttribute('aria-selected', String(tab === 'now'));
  const last = prompts.last;
  let text;
  if (tab === 'last') {
    text = last ? last.system : '';
    $('promptMeta').textContent = last
      ? `Sent ${new Date(last.at * 1000).toLocaleTimeString()} with a ${last.turn === 'ask' ? 'question' : 'passage to explain'}.`
      : 'Nothing sent yet. Ask the side chat about something you are reading.';
  } else {
    text = prompts.preview;
    $('promptMeta').textContent =
      'The system prompt a passage you asked about right now would get.';
  }
  const box = $('prompt');
  box.textContent = '';
  const at = text.indexOf(MEASURED);
  if (at < 0) {
    box.textContent = text;
    return;
  }
  // Light up the part that comes from the eye tracker and the headset.
  box.append(document.createTextNode(text.slice(0, at).trimEnd()));
  const mark = document.createElement('mark');
  mark.textContent = text.slice(at);
  box.append(mark);
}

$('tabLast').onclick = () => {
  tab = 'last';
  showPrompt();
};
$('tabNow').onclick = () => {
  tab = 'now';
  showPrompt();
};

// ---------- polling ----------

function showSignals(d) {
  const live = d.state === 'streaming';
  $('dot').classList.toggle('live', live);
  $('sourceText').textContent = live
    ? d.source || 'Headset'
    : d.state === 'idle'
      ? 'No headset streaming'
      : d.state;
  const note = $('note');
  note.hidden = live && d.reaches_tutor;
  note.textContent = !live
    ? 'Connect the headset from the NeuroChat portal, or start the companion with --replay bird to play recorded EEG.'
    : 'This is the simulated headset’s noise. It is drawn here but never reaches the tutor.';
  const s = d.signals;
  if (!s) return;
  const hz = b => `${b[0]}–${b[1]} Hz`;
  $('alphaHz').textContent = hz(s.bands_hz.alpha);
  $('betaHz').textContent = hz(s.bands_hz.beta);
  drawWave($('alphaWave'), s.waves.alpha, css('--alpha'));
  drawWave($('betaWave'), s.waves.beta, css('--beta'));
  drawBands($('bands'), s);
  drawScore($('scoreLine'), s);
  const now = s.now;
  $('score').textContent = now ? now.score.toFixed(2) : '–';
  $('bucket').textContent = now ? now.bucket : 'waiting for 15 s of signal';
  $('mark').hidden = !now;
  if (now) $('mark').style.left = `${now.score * 100}%`;
  $('engSub').textContent = s.calibrated
    ? 'β / (α + θ) over 15 s, against your calibration'
    : 'β / (α + θ) over 15 s, against this session so far';
}

async function poll() {
  try {
    const r = await fetch(`http://${COMPANION}/api/engagement/signals`);
    showSignals(await r.json());
  } catch {
    $('dot').classList.remove('live');
    $('sourceText').textContent = 'Companion not running';
    $('note').hidden = false;
    $('note').textContent =
      'Start NeuroChat with the neurochat command, then this page fills in.';
  }
}

async function pollPrompt() {
  try {
    const r = await fetch(`http://${COMPANION}/api/engagement/prompt`);
    prompts = await r.json();
    showPrompt();
  } catch {
    // poll() already says the companion isn't running.
  }
}

poll();
pollPrompt();
setInterval(poll, 1000);
setInterval(pollPrompt, 2000);
