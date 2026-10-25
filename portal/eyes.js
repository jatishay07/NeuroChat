// Eye tracking with WebEyeTrack (MIT, github.com/RedForestAI/WebEyeTrack): calibrate on 9 points,
// check accuracy on 5 more, then track which paragraph of a reading passage the gaze lands on and for how long.
const $ = (id) => document.getElementById(id);
const CALIB_POINTS = [[50, 50], [6, 8], [50, 8], [94, 8], [94, 50], [94, 92], [50, 92], [6, 92], [6, 50]];
const CHECK_POINTS = [[50, 50], [25, 28], [75, 28], [75, 72], [25, 72]];
const LOOK_BEFORE_MS = 300, LOOK_AFTER_MS = 900; // frames around a dot click that calibrate it
const CHECK_SETTLE_MS = 700, CHECK_MS = 1200; // check: wait for the eyes to land, then measure
const MAX_GAP_MS = 250; // a longer gap between gaze samples (tab hidden, face lost) isn't reading time
const SMOOTH_N = 5; // median of the last few gaze samples, to drop single-frame jumps
const SWITCH_MS = 150; // the gaze has to stay on a new paragraph this long before it counts
const SLOW_FACTOR = 1.5; // this many times the median time per word = "slow here"

let showDot = true, showCam = true;
let tracking = false;
let current = -1, candidate = null, lastT = null; // paragraph being read, one it may be moving to
let recent = []; // last few gaze points, for smoothing
let dwell = []; // ms per paragraph
let rereads = [], furthest = -1; // times the eyes came back to a paragraph after reading past it
let paras = [];
let webcam = null, proxy = null;
let face = false; // is a face with open eyes in view right now?
let latest = null; // latest gaze point {x, y, t} in page pixels
let collect = null; // array that gaze samples go into during the accuracy check
let margin = 60; // how far (px) above or below a paragraph a gaze point may land and still count for it
let frames = 0, fps = 0;
let onReady = null;

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
  if (!face) { $("gazeDot").hidden = true; return; }
  const { x, y } = fromScreen(r.normPog);
  latest = { x, y, t: performance.now() };
  if (collect) collect.push(latest);
  const dot = $("gazeDot");
  dot.hidden = !showDot;
  dot.style.transform = `translate(${x}px, ${y}px)`;
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
  webcam = new WebcamClient("camVideo");
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

// While reading, a click is a hint that the eyes are on the spot clicked; the tracker keeps the last few.
addEventListener("pointerdown", (e) => {
  if (tracking && proxy && e.isPrimary) proxy.click(...toScreen(e.clientX, e.clientY));
});

async function calibrate() {
  tracking = false;
  proxy.resetCalibration();
  document.body.classList.remove("reading");
  document.body.classList.add("calibrating");
  $("intro").hidden = true;
  $("reader").hidden = true;
  $("calib").hidden = false;
  $("dots").innerHTML = "";
  for (let n = 0; n < CALIB_POINTS.length; n++) await calibrationDot(CALIB_POINTS[n], n + 1);
  await checkAccuracy();
  read();
}

function calibrationDot([px, py], n) {
  const help = (t) => ($("calibHelp").textContent = t);
  help(`Look right at the dot and click it, then keep looking until it shrinks (${n} of ${CALIB_POINTS.length}).`);
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
      const used = await proxy.calibrate(...toScreen(r.left + r.width / 2, r.top + r.height / 2), from, Date.now());
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
    // Measured first, so the number is honest; then the same frames sharpen the calibration.
    await proxy.calibrate(...toScreen(tx, ty), from, Date.now());
  }
  $("dots").innerHTML = "";
  const mean = (k) => errs.reduce((a, e) => a + e[k], 0) / errs.length;
  if (!errs.length) {
    $("accuracy").textContent = "No gaze samples during the check: is your face in the camera preview? Try Recalibrate.";
    return;
  }
  const err = mean(2), errY = mean(1);
  margin = Math.min(140, Math.max(40, errY));
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
  candidate = null;
  lastT = null;
  recent = [];
  renderBars();
}

function paragraphAt(x, y) {
  // Gaze is noisy vertically, so allow a margin (from the accuracy check) and pick the nearest paragraph.
  let best = -1, bestDist = margin;
  paras.forEach((p, i) => {
    const r = p.getBoundingClientRect();
    if (x < r.left - 80 || x > r.right + 80) return;
    const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

function onGaze(g) {
  if (!tracking) return;
  recent.push(g);
  if (recent.length > SMOOTH_N) recent.shift();
  const i = paragraphAt(median(recent.map((p) => p.x)), median(recent.map((p) => p.y)));
  const gap = lastT == null ? 0 : g.t - lastT;
  lastT = g.t;
  if (gap > MAX_GAP_MS) { candidate = null; return; }
  if (current >= 0) dwell[current] += gap;
  // Only move to another paragraph once the gaze has stayed there a moment; that time then counts for it.
  if (i === current) candidate = null;
  else if (!candidate || candidate.i !== i) candidate = { i, since: g.t };
  else if (g.t - candidate.since >= SWITCH_MS) {
    if (current >= 0) dwell[current] -= g.t - candidate.since;
    if (i >= 0) dwell[i] += g.t - candidate.since;
    if (i >= 0 && i < furthest) rereads[i]++;
    furthest = Math.max(furthest, i);
    current = i;
    candidate = null;
    paras.forEach((p, j) => p.classList.toggle("gazed", j === i));
  }
}

// What the tutor gets about a paragraph: index and text, plus how it was read.
function paragraphDetail(i) {
  const dwellMsPer100Words = Math.round((dwell[i] / wordCount(paras[i])) * 100);
  return { index: i, text: paras[i].textContent.trim(), dwellMsPer100Words, rereads: rereads[i] };
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
