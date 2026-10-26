// Eye tracking with WebEyeTrack (MIT, github.com/RedForestAI/WebEyeTrack): calibrate on 9 points,
// check accuracy on 5 more, then track which paragraph of a reading passage the gaze lands on and for how long.
const $ = (id) => document.getElementById(id);
const CALIB_POINTS = [[50, 50], [6, 8], [50, 8], [94, 8], [94, 50], [94, 92], [50, 92], [6, 92], [6, 50]];
const CHECK_POINTS = [[50, 50], [25, 28], [75, 28], [75, 72], [25, 72]];
const LOOK_BEFORE_MS = 300, LOOK_AFTER_MS = 900; // frames around a dot click that calibrate it
const CHECK_SETTLE_MS = 700, CHECK_MS = 1200; // check: wait for the eyes to land, then measure
const MAX_GAP_MS = 250; // a longer gap between gaze samples (tab hidden, face lost) isn't reading time
const MOVED_CM = 7, MOVED_MS = 3000; // head this far from where it was at calibration, this long: offer a refresh
const REFRESH_POINTS = [[50, 30], [22, 70], [78, 70]];
const PURSUIT_ROWS = [12, 31, 50, 69, 88], PURSUIT_ROW_MS = 3000, PURSUIT_PAUSE_MS = 700; // follow-the-dot, % of the page
const CAMERA = { width: 1280, height: 720 }; // more pixels on the eyes than WebEyeTrack's default 640x480
const SLOW_FACTOR = 1.5; // this many times the median time per word = "slow here"

let showDot = true, showCam = true;
let tracking = false;
let current = -1, lastT = null; // paragraph being read
const tracker = new ParagraphTracker(); // paragraph-tracker.js: reading-order model + drift correction
const correction = new GazeCorrection(); // gaze-correction.js: personal fit on top of WebEyeTrack's
let history = []; // the tracker's last few seconds of raw output {t (Date.now()), g}, for clicks and refreshes
let pursuit = null; // samples while following the moving dot
let pose = null, poseSamples = null, movedSince = null; // head position (cm) at calibration
let dwell = []; // ms per paragraph
let rereads = [], furthest = -1; // times the eyes came back to a paragraph after reading past it
let paras = [];
let webcam = null, proxy = null;
let face = false; // is a face with open eyes in view right now?
let latest = null; // latest gaze point {x, y, t} in page pixels
let collect = null; // array that gaze samples go into during the accuracy check
let frames = 0, fps = 0;
let onReady = null;

// Paragraph visits go live to the companion over /ws/gaze, which lines each one up with the EEG
// recorded during it (gaze says where, the headset says whether you were engaged there).
let gazeWs = null, sentParagraph = null;
function sendGaze(msg) {
  if (!gazeWs || gazeWs.readyState > WebSocket.OPEN) {
    gazeWs = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/gaze`);
    gazeWs.onclose = () => { gazeWs = null; sentParagraph = null; };
  }
  if (gazeWs.readyState === WebSocket.OPEN) gazeWs.send(JSON.stringify(msg));
  else gazeWs.addEventListener("open", () => gazeWs && gazeWs.send(JSON.stringify(msg)), { once: true });
}
function gazeOn(i) { // i = paragraph index, or -1 when the eyes are off the text
  if (i === sentParagraph) return;
  sentParagraph = i;
  sendGaze(i >= 0 ? { type: "enter", paragraph: i } : { type: "leave" });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The tracker works in screen coordinates (-0.5 to 0.5, centre 0), so moving or resizing the window
// doesn't break calibration. Any mouse event tells us exactly where the page sits on the screen.
let chrome = null; // page origin relative to the window's top-left corner, from the last mouse event
addEventListener("mousemove", (e) => { chrome = { x: e.screenX - e.clientX - screenX, y: e.screenY - e.clientY - screenY }; }, { passive: true });
function pageOrigin() {
  const c = chrome || { x: 0, y: outerHeight - innerHeight }; // until the mouse moves: toolbar on top
  return { x: screenX + c.x, y: screenY + c.y };
}
function toScreen(x, y) {
  const o = pageOrigin();
  return [(o.x + x) / screen.width - 0.5, (o.y + y) / screen.height - 0.5];
}
function fromScreen([nx, ny]) {
  const o = pageOrigin();
  return { x: (nx + 0.5) * screen.width - o.x, y: (ny + 0.5) * screen.height - o.y };
}

function say(text, isError = false) {
  $("message").textContent = text || "";
  $("message").classList.toggle("error", isError);
}

function setFace(found, open) {
  face = found && open;
  const chip = $("faceChip");
  const rate = fps ? ` · ${fps} fps` : "";
  chip.textContent = !found ? "Can't see your face" : open ? `Tracking your eyes${rate}` : "Eyes closed";
  chip.className = `chip ${face ? "ok" : "bad"}`;
}

setInterval(() => { fps = frames; frames = 0; }, 1000);

function onResult(r) {
  frames++;
  const found = r.facialLandmarks && r.facialLandmarks.length > 0;
  setFace(found, r.gazeState === "open");
  if (onReady) { onReady(); onReady = null; }
  if (!face) { $("gazeDot").hidden = true; if (tracking) offText(); return; }
  watchHead(r.faceOrigin3D);
  const g = { pog: r.normPog, origin: r.faceOrigin3D, head: r.headVector };
  history.push({ t: Date.now(), g });
  while (history.length && history[0].t < Date.now() - 3000) history.shift();
  if (pursuit) pursuit.push({ t: performance.now(), g });
  const { x, y } = fromScreen(correction.apply(g));
  latest = { x, y, t: performance.now() };
  if (collect) collect.push(latest);
  const dot = $("gazeDot");
  dot.hidden = !showDot;
  const d = tracking ? tracker.drift : { x: 0, y: 0 }; // show the gaze as the reading model sees it
  dot.style.transform = `translate(${x - d.x}px, ${y - d.y}px)`;
  onGaze(latest);
}

async function start() {
  if (typeof WebEyeTrackProxy === "undefined") {
    say("Couldn't load the eye tracker. Reload the page.", true);
    return;
  }
  $("startBtn").disabled = true;
  say("Starting the camera… allow access when your browser asks. Loading the eye tracker takes a few seconds.");
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach((t) => t.stop()); // just asking for permission; WebEyeTrack opens its own stream
  } catch (e) {
    $("startBtn").disabled = false;
    say(`The camera didn't start: ${e.message || e}. Allow camera access for this page and try again.`, true);
    return;
  }
  $("cam").hidden = false;
  webcam = new WebcamClient("camVideo", CAMERA);
  // We send calibration points ourselves (in screen coordinates), so turn off its own click listener.
  proxy = new WebEyeTrackProxy(webcam, {
    autoClick: false,
    maxCalibPoints: CALIB_POINTS.length + CHECK_POINTS.length,
    mediapipeUrl: new URL("vendor/mediapipe/", location.href).href, // served locally: works offline
  });
  proxy.onGazeResults = onResult;
  const timeout = setTimeout(() => say("Still loading the eye tracker… if this doesn't finish, reload the page.", true), 30000);
  onReady = () => { clearTimeout(timeout); say(""); calibrate(); };
}

// While reading, a click is a hint that the eyes are on the spot clicked: it refines the personal
// correction (not WebEyeTrack's own fit, which the correction is built on top of).
addEventListener("pointerdown", (e) => {
  if (!tracking || !e.isPrimary) return;
  const recent = history.filter((h) => h.t > Date.now() - 200);
  if (recent.length) correction.addClick(recent[recent.length - 1].g, toScreen(e.clientX, e.clientY));
});

async function calibrate() {
  tracking = false;
  if (sentParagraph != null) gazeOn(-1);
  proxy.resetCalibration();
  correction.clear();
  document.body.classList.remove("reading");
  document.body.classList.add("calibrating");
  $("intro").hidden = true;
  $("reader").hidden = true;
  $("calib").hidden = false;
  $("dots").innerHTML = "";
  for (let n = 0; n < CALIB_POINTS.length; n++) await calibrationDot(CALIB_POINTS[n], n + 1, CALIB_POINTS.length, trainTracker);
  poseSamples = [];
  await followTheDot();
  await checkAccuracy();
  setPose();
  tracker.reset(0, true);
  read();
}

// What a looked-at dot trains: WebEyeTrack itself (first calibration) or the personal correction
// on top of it (refreshes). Each returns how many frames it used.
const trainTracker = (target, from, to) => proxy.calibrate(...target, from, to);
function trainCorrection(target, from, to) {
  const frames = history.filter((h) => h.t >= from && h.t <= to);
  frames.forEach((h) => correction.add(h.g, target, 4));
  if (frames.length) correction.fit();
  return Promise.resolve(frames.length);
}

function calibrationDot([px, py], n, of, train) {
  const help = (t) => ($("calibHelp").textContent = t);
  help(`Look right at the dot and click it, then keep looking until it shrinks (${n} of ${of}).`);
  const b = document.createElement("button");
  b.type = "button";
  b.className = "dot-target";
  b.style.left = `${px}%`;
  b.style.top = `${py}%`;
  b.setAttribute("aria-label", `Calibration point ${n}`);
  $("dots").append(b);
  return new Promise((resolve) => {
    b.onclick = async () => {
      if (!face) { help("I can't see your eyes. Check the camera preview, then click the dot again."); return; }
      // Every frame from just before the click until the dot has shrunk says "the eyes were here".
      const from = Date.now() - LOOK_BEFORE_MS;
      b.disabled = true;
      b.classList.add("hold");
      await sleep(Math.max(LOOK_AFTER_MS, Math.min(3000, 3000 / (fps || 1)))); // at least ~3 frames
      const r = b.getBoundingClientRect();
      const used = await train(toScreen(r.left + r.width / 2, r.top + r.height / 2), from, Date.now());
      if (!used) {
        b.disabled = false;
        b.classList.remove("hold");
        help("Lost sight of your eyes there. Look at the dot and click it again.");
        return;
      }
      b.remove();
      resolve();
    };
  });
}

// Follow a dot sweeping across the screen in rows, like reading lines. A few hundred samples over the
// whole screen fit the personal correction. The eyes (and the tracker's smoothing) trail the dot, so
// the fit tries a range of delays and keeps the best one.
async function followTheDot() {
  $("calibHelp").textContent = "Now follow the dot with your eyes as it moves, like reading lines of text.";
  $("dots").innerHTML = "";
  const d = document.createElement("div");
  d.className = "dot-target pursuit";
  $("dots").append(d);
  const track = []; // {t, x, y} page px while the dot moves along a row
  pursuit = [];
  for (const row of PURSUIT_ROWS) {
    d.style.left = "6%";
    d.style.top = `${row}%`;
    await sleep(PURSUIT_PAUSE_MS); // let the eyes jump to the row start
    const t0 = performance.now();
    await new Promise((done) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / PURSUIT_ROW_MS);
        const px = 6 + 88 * k;
        d.style.left = `${px}%`;
        track.push({ t: performance.now(), x: (px / 100) * innerWidth, y: (row / 100) * innerHeight, row });
        k < 1 ? requestAnimationFrame(step) : done();
      };
      requestAnimationFrame(step);
    });
  }
  const samples = pursuit;
  pursuit = null;
  $("dots").innerHTML = "";
  const targetAt = (t) => { // dot position at time t, if it was moving along one row then
    let i = track.findIndex((p) => p.t >= t);
    if (i <= 0) return null;
    const a = track[i - 1], b = track[i];
    if (a.row !== b.row || b.t - a.t > 100) return null;
    const k = (t - a.t) / (b.t - a.t);
    return toScreen(a.x + (b.x - a.x) * k, a.y);
  };
  let best = null;
  for (let lag = 0; lag <= 500; lag += 50) {
    const c = new GazeCorrection();
    for (const s of samples) { const target = targetAt(s.t - lag); if (target) c.add(s.g, target); }
    const rms = c.fit();
    if (rms != null && (!best || rms < best.rms)) best = { rms, lag, c };
  }
  if (best) { correction.samples = best.c.samples; correction.model = best.c.model; }
}

async function checkAccuracy() {
  $("calibHelp").textContent = "Now just look at each dot as it appears. No clicking.";
  const errs = [];
  for (const [px, py] of CHECK_POINTS) {
    $("dots").innerHTML = "";
    const c = document.createElement("div");
    c.className = "dot-target centre";
    c.style.left = `${px}%`;
    c.style.top = `${py}%`;
    $("dots").append(c);
    await sleep(CHECK_SETTLE_MS);
    const tx = (px / 100) * innerWidth, ty = (py / 100) * innerHeight;
    const from = Date.now();
    collect = [];
    await sleep(CHECK_MS);
    errs.push(...collect.map((p) => [Math.abs(p.x - tx), Math.abs(p.y - ty), Math.hypot(p.x - tx, p.y - ty)]));
    collect = null;
    // Measured first, so the number is honest; then the same frames sharpen the correction.
    await trainCorrection(toScreen(tx, ty), from, Date.now());
  }
  $("dots").innerHTML = "";
  const mean = (k) => errs.reduce((a, e) => a + e[k], 0) / errs.length;
  if (!errs.length) {
    $("accuracy").textContent = "No gaze samples during the check: is your face in the camera preview? Try Recalibrate.";
    return;
  }
  const err = mean(2), errX = mean(0), errY = mean(1);
  tracker.setSigma(errX * 1.25, errY * 1.25); // mean |error| → standard deviation
  const verdict = errY < 80 ? "Good: paragraphs are easy to tell apart."
    : errY < 150 ? "Okay for paragraphs; short ones may get mixed up."
    : "Too rough to tell paragraphs apart. Try Recalibrate, with your face well lit and your head still.";
  $("accuracy").textContent = `Accuracy check: about ${Math.round(err)} px off on average, ${Math.round(errY)} px up or down. ${verdict} Clicking where you're looking keeps refining it.`;
  $("accuracy").classList.toggle("warn", errY >= 150);
}

function read() {
  document.body.classList.remove("calibrating");
  $("calib").hidden = true;
  $("reader").hidden = false;
  document.body.classList.add("reading"); // tucks the camera preview into a corner
  paras = [...$("text").querySelectorAll("p:not(.eyebrow)")];
  paras.forEach((p, i) => (p.dataset.i = i));
  reset();
  tracking = true;
}

function reset() {
  dwell = paras.map(() => 0);
  rereads = paras.map(() => 0);
  furthest = -1;
  current = -1;
  lastT = null;
  tracker.reset(paras.length);
  if (sentParagraph != null) { sentParagraph = null; sendGaze({ type: "reset" }); }
  renderBars();
}

// Face lost, tab hidden or a long gap: the current visit ends; reading resumes once the gaze settles again.
function offText() {
  current = -1;
  tracker.reset(paras.length); // keeps the drift estimate
  gazeOn(-1);
  paras.forEach((p) => p.classList.remove("gazed"));
}
document.addEventListener("visibilitychange", () => document.hidden && tracking && offText());

function onGaze(g) {
  if (!tracking) return;
  const gap = lastT == null ? 0 : g.t - lastT;
  lastT = g.t;
  if (gap > MAX_GAP_MS) { offText(); return; }
  if (current >= 0) dwell[current] += gap;
  const i = tracker.update(g.x, g.y, gap, paras.map((p) => p.getBoundingClientRect()));
  if (i === current) return;
  if (i >= 0 && i < furthest) rereads[i]++;
  furthest = Math.max(furthest, i);
  current = i;
  gazeOn(i);
  paras.forEach((p, j) => p.classList.toggle("gazed", j === i));
}

// Calibration holds for the head position it was done in. Remember that position (from the accuracy
// check) and, if the head stays well away from it, offer a quick 3-dot refresh instead of a full redo.
function watchHead(origin) {
  if (!origin || origin.length !== 3 || !origin.some((v) => v)) return;
  if (poseSamples) { poseSamples.push(origin); return; }
  if (!pose || !tracking) return;
  const moved = Math.hypot(origin[0] - pose[0], origin[1] - pose[1], origin[2] - pose[2]) > MOVED_CM;
  const now = performance.now();
  if (!moved) movedSince = null;
  else if (movedSince == null) movedSince = now;
  else if (now - movedSince > MOVED_MS) showMovedToast();
}

function setPose() {
  const s = poseSamples || [];
  poseSamples = null;
  pose = s.length ? [0, 1, 2].map((k) => s.reduce((a, o) => a + o[k], 0) / s.length) : null;
  movedSince = null;
}

function showMovedToast() {
  let t = $("movedToast");
  if (t) return;
  t = document.createElement("div");
  t.id = "movedToast";
  t.className = "moved-toast";
  t.setAttribute("role", "status");
  t.innerHTML = `<span>You've moved since calibrating, so tracking may be off.</span>
    <button type="button" class="primary">Quick refresh</button><button type="button" class="quiet">Not now</button>`;
  const [fix, later] = t.querySelectorAll("button");
  fix.onclick = () => { t.remove(); refresh(); };
  later.onclick = () => { t.remove(); setPose(); }; // treat where they are now as the new normal
  document.body.append(t);
}

// Three clicks on top of the existing calibration, then back to the same reading.
async function refresh() {
  tracking = false;
  offText();
  document.body.classList.remove("reading");
  document.body.classList.add("calibrating");
  $("reader").hidden = true;
  $("calib").hidden = false;
  $("dots").innerHTML = "";
  poseSamples = [];
  for (let n = 0; n < REFRESH_POINTS.length; n++) await calibrationDot(REFRESH_POINTS[n], n + 1, REFRESH_POINTS.length, trainCorrection);
  setPose();
  tracker.reset(paras.length, true);
  document.body.classList.remove("calibrating");
  $("calib").hidden = true;
  $("reader").hidden = false;
  document.body.classList.add("reading");
  lastT = null;
  tracking = true;
}

// What the tutor gets about a paragraph: index and text, plus how it was read.
function paragraphDetail(i) {
  const per100 = paras.map((p, j) => (dwell[j] / wordCount(p)) * 100);
  const read = per100.filter((v) => v > 0).sort((a, b) => a - b);
  const medianMsPer100Words = read.length ? Math.round(read[Math.floor(read.length / 2)]) : null;
  return { index: i, text: paras[i].textContent.trim(), dwellMsPer100Words: Math.round(per100[i]), medianMsPer100Words, rereads: rereads[i] };
}

function wordCount(p) {
  return p.textContent.trim().split(/\s+/).length;
}

function renderBars() {
  const perWord = paras.map((p, i) => dwell[i] / wordCount(p) * 100 / 1000); // s per 100 words
  const sorted = [...perWord].filter((v) => v > 0).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const max = Math.max(...perWord, 1e-9);
  $("bars").innerHTML = "";
  perWord.forEach((v, i) => {
    const slow = median > 0 && sorted.length >= 3 && v > SLOW_FACTOR * median;
    // Tell the tutor (tutor.js) when a paragraph first turns out to be hard.
    if (slow && !paras[i].classList.contains("slow")) {
      window.dispatchEvent(new CustomEvent("paragraph:slow", { detail: paragraphDetail(i) }));
    }
    paras[i].classList.toggle("slow", slow);
    const li = document.createElement("li");
    li.className = slow ? "slow" : "";
    li.innerHTML = `<span class="label">¶${i + 1}</span><span class="track"><span class="fill"></span></span><span class="val"></span>`;
    li.querySelector(".fill").style.width = `${(100 * v) / max}%`;
    li.querySelector(".val").textContent = `${v.toFixed(1)} s${slow ? " · slow here" : ""}`;
    li.title = "Click to have the tutor explain this paragraph";
    li.onclick = () => window.dispatchEvent(new CustomEvent("paragraph:explain", { detail: paragraphDetail(i) }));
    li.onmouseenter = () => paras[i].classList.add("hover");
    li.onmouseleave = () => paras[i].classList.remove("hover");
    $("bars").append(li);
  });
}

setInterval(() => tracking && renderBars(), 500);

$("startBtn").onclick = start;
$("resetBtn").onclick = reset;
$("recalBtn").onclick = calibrate;
$("dotBtn").onclick = () => {
  showDot = !showDot;
  $("gazeDot").hidden = !showDot;
  $("dotBtn").textContent = showDot ? "Hide gaze dot" : "Show gaze dot";
};
$("camBtn").onclick = () => {
  showCam = !showCam;
  $("cam").classList.toggle("collapsed", !showCam);
  $("camBtn").textContent = showCam ? "Hide camera" : "Show camera";
};
window.addEventListener("beforeunload", () => webcam && webcam.stopWebcam());
