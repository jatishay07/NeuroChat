// Eye tracking with WebEyeTrack (MIT, github.com/RedForestAI/WebEyeTrack): calibrate on 9 points,
// measure accuracy, then track which paragraph of a reading passage the gaze lands on and for how long.
const $ = (id) => document.getElementById(id);
const CALIB_POINTS = [[50, 50], [6, 8], [50, 8], [94, 8], [94, 50], [94, 92], [50, 92], [6, 92], [6, 50]];
const NEXT_DOT_MS = 1200; // WebEyeTrack ignores clicks less than 1 s apart, so pace the dots
const ACCURACY_SECONDS = 4;
const MAX_GAP_MS = 250; // a longer gap between gaze samples (tab hidden, face lost) isn't reading time
const SLOW_FACTOR = 1.5; // this many times the median time per word = "slow here"

let showDot = true, showCam = true;
let tracking = false;
let last = null; // {i, t}
let dwell = []; // ms per paragraph
let paras = [];
let webcam = null;
let face = false; // is a face with open eyes in view right now?
let latest = null; // latest gaze point {x, y, t}
let onReady = null;

function say(text, isError = false) {
  $("message").textContent = text || "";
  $("message").classList.toggle("error", isError);
}

function setFace(found, open) {
  face = found && open;
  const chip = $("faceChip");
  chip.textContent = !found ? "Can't see your face" : open ? "Tracking your eyes" : "Eyes closed";
  chip.className = `chip ${face ? "ok" : "bad"}`;
}

function onResult(r) {
  const found = r.facialLandmarks && r.facialLandmarks.length > 0;
  setFace(found, r.gazeState === "open");
  if (onReady) { onReady(); onReady = null; }
  if (!face) { $("gazeDot").hidden = true; return; }
  // normPog is the gaze point on the screen, from -0.5 to 0.5 on each axis, centre = (0, 0).
  const x = (r.normPog[0] + 0.5) * innerWidth, y = (r.normPog[1] + 0.5) * innerHeight;
  latest = { x, y, t: performance.now() };
  const dot = $("gazeDot");
  dot.hidden = !showDot;
  dot.style.transform = `translate(${x}px, ${y}px)`;
  onGaze(latest, latest.t);
}

async function start() {
  if (typeof WebEyeTrackProxy === "undefined") {
    say("Couldn't load the eye tracker. Reload the page.", true);
    return;
  }
  $("startBtn").disabled = true;
  say("Starting the camera… allow access when your browser asks. The first time, the eye tracker downloads about 5 MB.");
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
  const proxy = new WebEyeTrackProxy(webcam); // also learns from every click on the page from now on
  proxy.onGazeResults = onResult;
  const timeout = setTimeout(() => say("Still loading the eye tracker… check your internet connection.", true), 30000);
  onReady = () => { clearTimeout(timeout); say(""); calibrate(); };
}

function calibrate() {
  tracking = false;
  document.body.classList.remove("reading");
  document.body.classList.add("calibrating");
  $("intro").hidden = true;
  $("reader").hidden = true;
  $("calib").hidden = false;
  const dots = $("dots");
  dots.innerHTML = "";
  let n = 0;
  const next = () => {
    if (n === CALIB_POINTS.length) return measureAccuracy();
    const [x, y] = CALIB_POINTS[n++];
    $("calibHelp").textContent = `Look right at the dot, then click it (${n} of ${CALIB_POINTS.length}).`;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dot-target";
    b.style.left = `${x}%`;
    b.style.top = `${y}%`;
    b.setAttribute("aria-label", `Calibration point ${n}`);
    b.onclick = () => {
      // The click itself is what WebEyeTrack learns from: "the eyes looked here, right now".
      if (!face) { $("calibHelp").textContent = "I can't see your eyes. Check the camera preview, then click the dot again."; return; }
      b.disabled = true;
      b.classList.add("done");
      b.style.setProperty("--fill", 1);
      setTimeout(() => { b.remove(); next(); }, NEXT_DOT_MS);
    };
    dots.append(b);
  };
  next();
}

function measureAccuracy() {
  $("dots").innerHTML = "";
  $("calibHelp").textContent = `Now look at the centre dot without clicking for ${ACCURACY_SECONDS} seconds.`;
  const c = document.createElement("div");
  c.className = "dot-target centre";
  c.style.left = "50%";
  c.style.top = "50%";
  $("dots").append(c);
  const samples = [];
  const timer = setInterval(() => {
    if (face && latest && performance.now() - latest.t < 200) samples.push(latest);
  }, 100);
  setTimeout(() => {
    clearInterval(timer);
    const cx = innerWidth / 2, cy = innerHeight / 2;
    const half = Math.hypot(innerWidth, innerHeight) / 2;
    const errs = samples.map((p) => Math.hypot(p.x - cx, p.y - cy));
    const mean = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null;
    $("accuracy").textContent = mean == null
      ? "No gaze samples during the check: is your face in the camera preview?"
      : `Calibration: about ${Math.round(mean)} px off on average (${Math.max(0, Math.round(100 * (1 - mean / half)))}% accuracy). Under ~150 px is good enough to tell paragraphs apart. Clicking anywhere while looking at the spot you click keeps improving it.`;
    read();
  }, ACCURACY_SECONDS * 1000);
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
  last = null;
  renderBars();
}

function paragraphAt(x, y) {
  // Gaze is noisy vertically, so allow a margin and pick the nearest paragraph to the point.
  let best = -1, bestDist = 60;
  paras.forEach((p, i) => {
    const r = p.getBoundingClientRect();
    if (x < r.left - 80 || x > r.right + 80) return;
    const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

function onGaze(data, t) {
  if (!tracking || !data) return;
  const i = paragraphAt(data.x, data.y);
  if (last && last.i >= 0 && last.i === i) {
    const gap = t - last.t;
    if (gap > 0 && gap < MAX_GAP_MS) dwell[i] += gap;
  }
  last = { i, t };
  paras.forEach((p, j) => p.classList.toggle("gazed", j === i));
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
      window.dispatchEvent(new CustomEvent("paragraph:slow", { detail: { index: i, text: paras[i].textContent.trim() } }));
    }
    paras[i].classList.toggle("slow", slow);
    const li = document.createElement("li");
    li.className = slow ? "slow" : "";
    li.innerHTML = `<span class="label">¶${i + 1}</span><span class="track"><span class="fill"></span></span><span class="val"></span>`;
    li.querySelector(".fill").style.width = `${(100 * v) / max}%`;
    li.querySelector(".val").textContent = `${v.toFixed(1)} s${slow ? " · slow here" : ""}`;
    li.title = "Click to have the tutor explain this paragraph";
    li.onclick = () => window.dispatchEvent(new CustomEvent("paragraph:explain", { detail: { index: i, text: paras[i].textContent.trim() } }));
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
