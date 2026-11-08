// Which paragraph is being read, from noisy webcam gaze.
//
// A hidden Markov model over the paragraphs plus "off the text": reading mostly stays on a paragraph or
// moves on to the next one, so a few stray samples can't throw it somewhere else, and a paragraph only
// counts once the model is confident about it. The same idea that line-assignment work for reading
// uses (CONF-LA, arxiv.org/abs/2605.00033), applied to paragraphs.
//
// While a paragraph is read with confidence, the gap between where the gaze lands and the paragraph's
// centre estimates calibration drift. It is tracked slowly and subtracted from new gaze, the
// "implicit recalibration" that reading studies use (easychair.org/publications/preprint/gLt7).
(function (root) {
  const CONFIDENT = 0.6; // posterior needed before the reading position moves
  const STAY_MS = 3000; // typical time on a paragraph before moving on
  const OFF_STAY_MS = 1000; // typical time looking away from the text
  const TO_NEXT = 0.6,
    TO_OFF = 0.05; // where the eyes go when they leave a paragraph; the rest: elsewhere
  const OFF_LIKELIHOOD = Math.exp(-0.5 * 2.5 * 2.5); // "off the text" explains a point 2.5 sigma from every paragraph
  const DRIFT_MIN_POSTERIOR = 0.9;
  const DRIFT_MIN_VISIT_MS = 2000;
  const DRIFT_GAIN = 0.5;
  const DRIFT_MAX = {x: 150, y: 120};

  class ParagraphTracker {
    constructor({sigmaX = 80, sigmaY = 60, ...tune} = {}) {
      this.sigma = {x: sigmaX, y: sigmaY};
      this.k = {
        CONFIDENT,
        STAY_MS,
        OFF_STAY_MS,
        TO_NEXT,
        TO_OFF,
        OFF_LIKELIHOOD,
        DRIFT_MIN_VISIT_MS,
        DRIFT_GAIN,
        ...tune,
      };
      this.reset(0);
    }

    // n paragraphs; forgets the reading position (keeps the drift estimate unless resetDrift)
    reset(n, resetDrift = false) {
      this.n = n;
      this.p = new Array(n + 1).fill(1 / (n + 1)); // last entry = off the text
      this.current = -1;
      this.visit = {i: -1, ms: 0, xs: [], ys: []};
      if (resetDrift || !this.drift) this.drift = {x: 0, y: 0};
    }

    setSigma(sigmaX, sigmaY) {
      this.sigma = {x: Math.max(30, sigmaX), y: Math.max(30, sigmaY)};
    }

    likelihood(x, y, r) {
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      return Math.exp(
        -0.5 * ((dx / this.sigma.x) ** 2 + (dy / this.sigma.y) ** 2)
      );
    }

    // One gaze sample (page px, before drift correction), dt ms since the last one, and the paragraphs'
    // current rectangles. Returns the paragraph being read (-1: off the text or not yet known).
    update(rawX, rawY, dt, rects) {
      const n = this.n,
        off = n;
      const x = rawX - this.drift.x,
        y = rawY - this.drift.y;
      const leave = 1 - Math.exp(-dt / this.k.STAY_MS),
        leaveOff = 1 - Math.exp(-dt / this.k.OFF_STAY_MS);
      const prior = new Array(n + 1).fill(0);
      for (let i = 0; i < n; i++) {
        const pi = this.p[i];
        prior[i] += pi * (1 - leave);
        const next = i + 1 < n ? this.k.TO_NEXT : 0;
        prior[off] +=
          pi * leave * (this.k.TO_OFF + (i + 1 < n ? 0 : this.k.TO_NEXT));
        if (next) prior[i + 1] += pi * leave * next;
        const elsewhere = pi * leave * (1 - this.k.TO_NEXT - this.k.TO_OFF);
        if (n > 1)
          for (let j = 0; j < n; j++)
            if (j !== i) prior[j] += elsewhere / (n - 1);
            else prior[off] += elsewhere;
      }
      prior[off] += this.p[off] * (1 - leaveOff);
      for (let j = 0; j < n; j++) prior[j] += (this.p[off] * leaveOff) / n;

      let total = 0;
      for (let j = 0; j <= n; j++) {
        this.p[j] =
          prior[j] *
          (j === off ? this.k.OFF_LIKELIHOOD : this.likelihood(x, y, rects[j]));
        total += this.p[j];
      }
      if (!(total > 0)) {
        this.reset(n);
        return this.current;
      }
      let best = 0;
      for (let j = 0; j <= n; j++) {
        this.p[j] = Math.max(this.p[j] / total, 1e-9);
        if (this.p[j] > this.p[best]) best = j;
      }
      if (this.p[best] >= this.k.CONFIDENT)
        this.current = best === off ? -1 : best;

      // Drift: a paragraph read start to finish puts the median gaze near its centre, so when a confident
      // visit of at least DRIFT_MIN_VISIT_MS ends, its median offset from the centre moves the correction
      // part of the way (DRIFT_GAIN). Partial reads and stray samples average out over visits.
      if (this.current !== this.visit.i) {
        this.endVisit(rects);
        this.visit = {i: this.current, ms: 0, xs: [], ys: []};
      }
      if (this.current >= 0 && this.p[this.current] >= DRIFT_MIN_POSTERIOR) {
        this.visit.ms += dt;
        this.visit.xs.push(rawX);
        this.visit.ys.push(rawY);
      }
      return this.current;
    }

    endVisit(rects) {
      const v = this.visit;
      if (!v || v.i < 0 || v.ms < this.k.DRIFT_MIN_VISIT_MS || !rects[v.i])
        return;
      const r = rects[v.i];
      const resX = median(v.xs) - (r.left + r.right) / 2,
        resY = median(v.ys) - (r.top + r.bottom) / 2;
      const g = this.k.DRIFT_GAIN;
      this.drift.x = clamp(
        this.drift.x + (resX - this.drift.x) * g,
        -DRIFT_MAX.x,
        DRIFT_MAX.x
      );
      this.drift.y = clamp(
        this.drift.y + (resY - this.drift.y) * g,
        -DRIFT_MAX.y,
        DRIFT_MAX.y
      );
    }

    confidence() {
      return this.current >= 0 ? this.p[this.current] : this.p[this.n];
    }
  }

  const median = v => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  root.ParagraphTracker = ParagraphTracker;
  if (typeof module !== 'undefined') module.exports = {ParagraphTracker};
})(typeof window !== 'undefined' ? window : globalThis);
