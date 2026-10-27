// Reading pace for study mode: time on a paragraph per 100 words, compared with the reader's own
// usual pace (the median over paragraphs they have read before, kept in this browser).
// No DOM here, so tests/study/pace.test.mjs can run it under Node.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StudyPace = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const KEY = "neurochat.study.pace.v1";
  const KEEP = 200;          // paragraphs remembered across sessions
  const SLOW_RATIO = 1.5;    // slow = this many times the usual pace (DECISIONS.md 2026-10-27, study-mode)
  const MIN_SAMPLES = 3;     // no baseline, so nothing is slow, until this many paragraphs are read
  const MIN_WORDS = 8;       // headings and one-liners are too short to time
  const MIN_MS = 1500;       // shorter than this is a skip, not a reading
  const MAX_MS_PER_100 = 180000; // over 3 min per 100 words: they walked away, so it isn't a reading

  const words = (text) => (String(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

  // ms on screen normalised to 100 words; null when the paragraph is too short or barely looked at.
  function msPer100Words(ms, wordCount) {
    if (!(wordCount >= MIN_WORDS) || !(ms >= MIN_MS)) return null;
    const v = (ms * 100) / wordCount;
    return v > MAX_MS_PER_100 ? null : Math.round(v);
  }

  function median(values) {
    const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
  }

  // value is slow against a baseline of `samples` paragraphs with median `med`.
  function isSlow(value, med, samples, ratio = SLOW_RATIO) {
    return !!(value && med && samples >= MIN_SAMPLES && value >= ratio * med);
  }

  // The baseline: past sessions' paragraphs plus this session's, which replace themselves when a
  // paragraph is read again (a reread adds time to it, it isn't a second paragraph).
  class Baseline {
    constructor(storage) {
      this.storage = storage || null;
      this.past = this.load();
      this.session = new Map();
    }
    load() {
      try {
        const v = JSON.parse(this.storage?.getItem(KEY) || "[]");
        return Array.isArray(v) ? v.filter((x) => Number.isFinite(x) && x > 0).slice(-KEEP) : [];
      } catch { return []; }
    }
    save() {
      try { this.storage?.setItem(KEY, JSON.stringify(this.values())); } catch { /* private window: this session only */ }
    }
    record(id, value) {
      if (value) { this.session.set(id, value); this.save(); }
    }
    values() { return this.past.concat([...this.session.values()]).slice(-KEEP); }
    // The median without paragraph `id`, so a paragraph is never compared with itself.
    stats(exceptId) {
      const v = this.past.concat([...this.session].filter(([k]) => k !== exceptId).map(([, x]) => x)).slice(-KEEP);
      return { median: median(v), samples: v.length };
    }
    clear() {
      this.past = []; this.session.clear();
      try { this.storage?.removeItem(KEY); } catch { /* nothing stored */ }
    }
  }

  // Active time on screen: counts only while the paragraph is shown, the tab is visible and the
  // reader has done something in the last IDLE_MS (scroll, key, pointer), so a coffee break isn't
  // read as a struggle.
  const IDLE_MS = 60000;
  class Clock {
    constructor(now = () => Date.now()) { this.now = now; this.total = 0; this.since = null; this.lastActive = now(); }
    start() { if (this.since === null) { this.since = this.now(); this.lastActive = this.since; } }
    stop() {
      if (this.since === null) return;
      const end = Math.min(this.now(), this.lastActive + IDLE_MS);
      this.total += Math.max(0, end - this.since);
      this.since = null;
    }
    // Activity: if they were idle, the idle stretch is dropped and timing resumes from now.
    poke() {
      const t = this.now();
      if (this.since !== null && t - this.lastActive > IDLE_MS) { this.stop(); this.since = t; }
      this.lastActive = t;
    }
    elapsed() {
      if (this.since === null) return this.total;
      return this.total + Math.max(0, Math.min(this.now(), this.lastActive + IDLE_MS) - this.since);
    }
  }

  // Split pasted text into a title (a short first line with no closing full stop) and paragraphs.
  function parseText(raw) {
    const text = String(raw).replace(/\r\n?/g, "\n").trim();
    // Paragraphs are split by blank lines; text with no blank lines at all (copied from some
    // pages) is split by line instead.
    const blocks = (/\n\s*\n/.test(text) ? text.split(/\n\s*\n/) : text.split("\n"))
      .map((b) => b.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
    let title = null;
    if (blocks.length > 1 && blocks[0].length <= 90 && !/[.:;,]$/.test(blocks[0])) title = blocks.shift();
    return { title, paragraphs: blocks };
  }

  return { KEY, SLOW_RATIO, MIN_SAMPLES, MIN_WORDS, IDLE_MS, words, msPer100Words, median, isSlow, Baseline, Clock, parseText };
});
