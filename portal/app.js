// Connect screen: scan for the headset, connect, and show a live per-sensor signal check.
const $ = id => document.getElementById(id);
const SENSOR_POS = {
  AF7: [72, 48],
  AF8: [148, 48],
  TP9: [54, 140],
  TP10: [166, 140],
};
const TIPS = {
  flat: ch =>
    `${ch} isn't touching skin. Push the band down a little or move hair out of the way.`,
  noisy: ch =>
    `${ch} is noisy. Sit still, relax your jaw, and check the band isn't loose.`,
};

let status = null;
let readingTab = false; // reading opened in a new tab while this one holds the headset
let bt = null; // the Web Bluetooth session, when the browser connected the headset itself
const webBluetooth = !!window.MuseBluetooth?.supported();

async function call(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Request failed (${res.status})`);
  }
  return res.json();
}

function say(text, isError = false) {
  $('message').textContent = text || '';
  $('message').classList.toggle('error', isError);
}

function render(s) {
  status = s;
  const busy = s.state === 'scanning' || s.state === 'connecting';
  const live = s.state === 'streaming' || s.state === 'connecting';
  $('find').hidden = live;
  $('live').hidden = !live;
  $('scanBtn').disabled = busy;
  $('scanBtn').textContent =
    s.state === 'scanning'
      ? 'Looking…'
      : s.devices.length && !webBluetooth
        ? 'Look again'
        : 'Find my headset';
  // Web Bluetooth is the main way in; the companion's own scan stays for other browsers.
  $('simLink').hidden = !s.simulated || busy;
  $('nativeLink').hidden = !webBluetooth || s.simulated || busy;

  const list = $('devices');
  list.innerHTML = '';
  for (const d of s.devices) {
    const li = document.createElement('li');
    li.innerHTML = `<span><strong></strong><br><span class="addr"></span></span>`;
    li.querySelector('strong').textContent = d.name;
    li.querySelector('.addr').textContent =
      d.rssi != null ? `${d.address} · signal ${d.rssi} dBm` : d.address;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Connect';
    btn.disabled = busy;
    btn.onclick = () => connect(d.address);
    li.append(btn);
    list.append(li);
  }

  $('deviceName').textContent = s.device ? s.device.name : '';
  $('liveDot').classList.toggle('on', s.state === 'streaming');
  $('rate').textContent =
    s.state === 'connecting'
      ? 'connecting…'
      : s.srate
        ? `${Math.round(s.srate)} samples/s`
        : '';

  const g = $('sensors');
  g.innerHTML = '';
  s.channels.forEach((ch, i) => {
    const [x, y] = SENSOR_POS[ch] || [110, 100];
    const q = s.quality[i] || 'unknown';
    g.insertAdjacentHTML(
      'beforeend',
      `<g class="sensor"><circle cx="${x}" cy="${y}" r="13" class="q-${q}"><title>${ch}: ${q}</title></circle>` +
        `<text x="${x}" y="${ch.startsWith('TP') ? y - 19 : y + 30}" text-anchor="middle">${ch}</text></g>`
    );
  });
  renderWaves(s);
  const tips = s.channels
    .map((ch, i) => TIPS[s.quality[i]]?.(ch))
    .filter(Boolean);
  $('tips').innerHTML = tips.map(t => `<li>${t}</li>`).join('');
  const allGood = s.state === 'streaming' && s.quality.every(q => q === 'good');
  $('continueBtn').disabled = !allGood;

  if (s.state === 'error') say(s.error, true);
  else if (s.state === 'streaming' && readingTab)
    say(
      'Reading is open in another tab. Keep this tab open: it holds the headset connection.'
    );
  else if (s.state === 'streaming')
    say(
      allGood
        ? 'All four sensors look good.'
        : s.quality.includes('unknown')
          ? 'Checking the signal…'
          : 'Adjust the headset until every sensor is green.'
    );
  else if (s.error) say(s.error);
  else if (s.state === 'idle' && !s.devices.length) say('');
}

async function findHeadset() {
  if (webBluetooth) return connectBluetooth();
  if (status?.simulated) {
    return say(
      "This browser can't use Bluetooth. Open this page in Chrome or Edge to connect your headset.",
      true
    );
  }
  scan();
}

async function connectBluetooth() {
  say('Pick your Muse in the list your browser shows.');
  bt?.stop();
  bt = new MuseBluetooth(message => {
    bt = null;
    readingTab = false;
    if (message) say(message, true);
  });
  try {
    await bt.connect();
  } catch (e) {
    bt = null;
    // Closing the browser's list isn't an error.
    say(
      /cancel/i.test(e.message) ? '' : e.message || String(e),
      !/cancel/i.test(e.message)
    );
  }
}

// Live waveforms under the head: the last 2 s per channel, centred on 0 µV, drawn at a fixed scale
// so a noisy or loose sensor visibly jumps around.
const WAVE_UV = 100; // ±µV that fills the row
function renderWaves(s) {
  const box = $('waves');
  box.hidden = !s.wave;
  if (!s.wave) return;
  box.innerHTML = '';
  s.channels.forEach((ch, i) => {
    const w = s.wave[i] || [];
    const q = s.quality[i] || 'unknown';
    const pts = w
      .map(
        (v, j) =>
          `${(j / Math.max(1, w.length - 1)) * 300},${11 - Math.max(-1, Math.min(1, v / WAVE_UV)) * 10}`
      )
      .join(' ');
    const row = document.createElement('div');
    row.className = `wave q-${q}`;
    row.innerHTML = `<span></span><svg viewBox="0 0 300 22" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>`;
    row.querySelector('span').textContent = ch;
    box.append(row);
  });
}

async function scan() {
  say('Looking for headsets nearby…');
  try {
    render(await call('/api/device/scan'));
  } catch (e) {
    say(e.message, true);
  }
}

async function connect(address) {
  say('Connecting… this can take up to 20 seconds.');
  try {
    render(await call('/api/device/connect', {address}));
  } catch (e) {
    say(e.message, true);
  }
}

async function disconnect() {
  bt?.stop();
  bt = null;
  try {
    render(await call('/api/device/disconnect'));
  } catch (e) {
    say(e.message, true);
  }
}

function listen() {
  const ws = new WebSocket(
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/device`
  );
  ws.onmessage = ev => render(JSON.parse(ev.data));
  ws.onclose = () => {
    say('Lost contact with the companion app. Retrying…', true);
    setTimeout(listen, 2000);
  };
}

$('scanBtn').onclick = findHeadset;
$('simBtn').onclick = e => {
  e.preventDefault();
  scan();
};
$('nativeBtn').onclick = e => {
  e.preventDefault();
  scan();
};
$('disconnectBtn').onclick = disconnect;
$('continueBtn').onclick = () => {
  if (!bt) {
    location.href = '/eyes.html';
    return;
  }
  // The browser's Bluetooth link lives in this page, so reading opens in a new tab and this one stays.
  window.open('/eyes.html', '_blank');
  readingTab = true;
  render(status);
};
// Leaving this page would drop a headset the browser connected.
window.addEventListener('beforeunload', e => {
  if (bt) e.preventDefault();
});
listen();
