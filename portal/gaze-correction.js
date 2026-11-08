// A personal correction layer on top of WebEyeTrack. WebEyeTrack's own calibration is an affine fit, a
// straight-line stretch, which can't fix errors that bend towards the screen edges or that change as
// the head moves. This fits a small ridge regression from the tracker's output plus head position to
// where the eyes really were: a second-order polynomial in the gaze point and linear terms in head
// position and direction. It's trained on a few hundred samples from following a moving dot, and on
// every click while reading.
(function (root) {
  const LAMBDA = 1e-2; // ridge strength, on standardised features
  const MAX_SAMPLES = 1500; // pursuit samples plus the most recent clicks
  const CLICK_WEIGHT = 8; // a click is one exact sample against many noisy pursuit ones
  // Smallest scale per feature when standardising. During calibration the head barely moves, so its
  // features' spread is tiny; dividing by that would turn a 5 cm shift later into a wild correction.
  const MIN_STD = [0.02, 0.02, 0.01, 0.01, 0.01, 3, 3, 3, 0.1, 0.1, 0.1]; // pog terms; origin cm; head vector

  function features(g) {
    const [x, y] = g.pog,
      o = g.origin || [0, 0, 0],
      h = g.head || [0, 0, 0];
    return [x, y, x * x, y * y, x * y, o[0], o[1], o[2], h[0], h[1], h[2]];
  }

  // Solve (A + lambda I) b = c for symmetric A by Gaussian elimination with partial pivoting.
  function solve(A, c) {
    const n = c.length,
      M = A.map((row, i) => [...row, c[i]]);
    for (let k = 0; k < n; k++) {
      let p = k;
      for (let i = k + 1; i < n; i++)
        if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
      [M[k], M[p]] = [M[p], M[k]];
      if (Math.abs(M[k][k]) < 1e-12) return null;
      for (let i = k + 1; i < n; i++) {
        const f = M[i][k] / M[k][k];
        for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j];
      }
    }
    const b = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = M[i][n];
      for (let j = i + 1; j < n; j++) s -= M[i][j] * b[j];
      b[i] = s / M[i][i];
    }
    return b;
  }

  class GazeCorrection {
    constructor() {
      this.clear();
    }

    clear() {
      this.samples = []; // {f: features, t: [x, y] target, w: weight}
      this.model = null; // {mean, std, bx, by}
    }

    // g: {pog: [x, y] from the tracker, origin: faceOrigin3D, head: headVector}; target: [x, y], both
    // in normalized screen coordinates.
    add(g, target, weight = 1) {
      this.samples.push({f: features(g), t: target, w: weight});
      if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    }

    addClick(g, target) {
      this.add(g, target, CLICK_WEIGHT);
      if (this.model) this.fit();
    }

    // Fit, drop samples more than 2.5 robust standard deviations off, fit again. Returns the RMS
    // residual (normalized units) or null if there's too little to fit.
    fit() {
      if (this.samples.length < 40) return null;
      let used = this.samples;
      for (let round = 0; round < 2; round++) {
        const model = this._fit(used);
        if (!model) return null;
        this.model = model;
        const res = used.map(s => Math.hypot(...this._residual(s)));
        const mad =
          [...res].sort((a, b) => a - b)[Math.floor(res.length / 2)] * 1.4826;
        if (round === 0)
          used = used.filter((_, i) => res[i] <= 2.5 * mad + 1e-6);
        else return Math.sqrt(res.reduce((a, r) => a + r * r, 0) / res.length);
      }
    }

    _fit(samples) {
      const d = samples[0].f.length;
      const mean = new Array(d).fill(0),
        std = new Array(d).fill(0);
      let W = 0;
      for (const s of samples) {
        W += s.w;
        s.f.forEach((v, j) => (mean[j] += s.w * v));
      }
      mean.forEach((_, j) => (mean[j] /= W));
      for (const s of samples)
        s.f.forEach((v, j) => (std[j] += s.w * (v - mean[j]) ** 2));
      std.forEach(
        (_, j) => (std[j] = Math.max(Math.sqrt(std[j] / W), MIN_STD[j]))
      );
      const n = d + 1; // + intercept
      const A = Array.from({length: n}, () => new Array(n).fill(0));
      const cx = new Array(n).fill(0),
        cy = new Array(n).fill(0);
      for (const s of samples) {
        const z = [1, ...s.f.map((v, j) => (v - mean[j]) / std[j])];
        for (let i = 0; i < n; i++) {
          cx[i] += s.w * z[i] * s.t[0];
          cy[i] += s.w * z[i] * s.t[1];
          for (let j = 0; j < n; j++) A[i][j] += s.w * z[i] * z[j];
        }
      }
      for (let i = 1; i < n; i++) A[i][i] += LAMBDA * W; // don't shrink the intercept
      const bx = solve(A, cx),
        by = solve(A, cy);
      return bx && by ? {mean, std, bx, by} : null;
    }

    _predict(f) {
      const {mean, std, bx, by} = this.model;
      const z = [1, ...f.map((v, j) => (v - mean[j]) / std[j])];
      return [
        z.reduce((a, v, i) => a + v * bx[i], 0),
        z.reduce((a, v, i) => a + v * by[i], 0),
      ];
    }

    _residual(s) {
      const p = this._predict(s.f);
      return [p[0] - s.t[0], p[1] - s.t[1]];
    }

    // Corrected gaze point, or the tracker's own when there's no fit yet.
    apply(g) {
      if (!this.model) return g.pog;
      const p = this._predict(features(g));
      return [
        Math.max(-0.6, Math.min(0.6, p[0])),
        Math.max(-0.6, Math.min(0.6, p[1])),
      ];
    }
  }

  root.GazeCorrection = GazeCorrection;
  if (typeof module !== 'undefined') module.exports = {GazeCorrection};
})(typeof window !== 'undefined' ? window : globalThis);
