// Eye tracking: calibrate WebGazer with 9 click targets, measure accuracy, then track which
// paragraph of a reading passage the gaze lands on and for how long.
const $ = (id) => document.getElementById(id);
const WEBGAZER_ASSETS = "https://cdn.jsdelivr.net/npm/webgazer@3.5.3/dist/mediapipe/face_mesh";
const CLICKS_PER_DOT = 5;
const ACCURACY_SECONDS = 4;
const MAX_GAP_MS = 250; // a longer gap between gaze samples (tab hidden, face lost) isn't reading time
const SLOW_FACTOR = 1.5; // this many times the median time per word = "slow here"

let showDot = true, showCam = true;
let tracking = false;
let last = null; // {x, y, t}
let dwell = []; // ms per paragraph
let paras = [];

function say(text, isError = false) {
  $("message").textContent = text || "";
  $("message").classList.toggle("error", isError);
}

async function start() {
  if (typeof webgazer === "undefined") {
    say("Couldn't load the eye tracker. Check your internet connection and reload.", true);
    return;
  }
  $("startBtn").disabled = true;
  say("Starting the camera… allow access when your browser asks.");
  try {
    webgazer.params.faceMeshSolutionPath = WEBGAZER_ASSETS;
    webgazer.params.saveDataAcrossSessions = false;
    await webgazer.setRegression("ridge").setGazeListener(onGaze).begin();
    webgazer.showVideoPreview(true).showFaceOverlay(true).showFaceFeedbackBox(true).showPredictionPoints(true);
    webgazer.applyKalmanFilter(true);
  } catch (e) {
    $("startBtn").disabled = false;
    say(`The camera didn't start: ${e.message || e}. Allow camera access for this page and try again.`, true);
    return;
  }
  calibrate();
}

function calibrate() {
  tracking = false;
  document.body.classList.remove("reading");
  webgazer.clearData();
  $("intro").hidden = true;
  $("reader").hidden = true;
  $("calib").hidden = false;
  $("calibHelp").textContent = `Look at each dot and click it ${CLICKS_PER_DOT} times. It turns green when it's done.`;
  const dots = $("dots");
  dots.innerHTML = "";
  let done = 0;
  for (const y of [8, 50, 92]) {
    for (const x of [6, 50, 94]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dot-target";
      b.style.left = `${x}%`;
      b.style.top = `${y}%`;
      b.setAttribute("aria-label", "Calibration point");
      let clicks = 0;
      b.onclick = () => {
        // WebGazer learns from every click on the page: looking here, cursor here.
        clicks++;
        b.style.setProperty("--fill", clicks / CLICKS_PER_DOT);
        if (clicks === CLICKS_PER_DOT) {
          b.classList.add("done");
          b.disabled = true;
          if (++done === 9) measureAccuracy();
        }
      };
      dots.append(b);
    }
  }
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
  const timer = setInterval(async () => {
    const p = await webgazer.getCurrentPrediction();
    if (p) samples.push(p);
  }, 100);
  setTimeout(() => {
    clearInterval(timer);
    const cx = innerWidth / 2, cy = innerHeight / 2;
    const half = Math.hypot(innerWidth, innerHeight) / 2;
    const errs = samples.map((p) => Math.hypot(p.x - cx, p.y - cy));
    const mean = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null;
    $("accuracy").textContent = mean == null
      ? "No gaze samples during the check: is your face in the camera box?"
      : `Calibration: about ${Math.round(mean)} px off on average (${Math.max(0, Math.round(100 * (1 - mean / half)))}% accuracy). Under ~150 px is good enough to tell paragraphs apart.`;
    read();
  }, ACCURACY_SECONDS * 1000);
}

function read() {
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
    paras[i].classList.toggle("slow", slow);
    const li = document.createElement("li");
    li.className = slow ? "slow" : "";
    li.innerHTML = `<span class="label">¶${i + 1}</span><span class="track"><span class="fill"></span></span><span class="val"></span>`;
    li.querySelector(".fill").style.width = `${(100 * v) / max}%`;
    li.querySelector(".val").textContent = `${v.toFixed(1)} s${slow ? " · slow here" : ""}`;
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
  webgazer.showPredictionPoints(showDot);
  $("dotBtn").textContent = showDot ? "Hide gaze dot" : "Show gaze dot";
};
$("camBtn").onclick = () => {
  showCam = !showCam;
  webgazer.showVideoPreview(showCam).showFaceOverlay(showCam).showFaceFeedbackBox(showCam);
  $("camBtn").textContent = showCam ? "Hide camera" : "Show camera";
};
window.addEventListener("beforeunload", () => typeof webgazer !== "undefined" && webgazer.end());
