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
    // A new text: this session's paragraphs join the past ones, so paragraph 1 of the next text
    // doesn't replace paragraph 1 of this one.
    newSession() { this.past = this.values(); this.session.clear(); }
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

  // Split pasted text into a title, paragraphs, and the heading each paragraph sits under.
  // Handles blank-line paragraphs, one-paragraph-per-line text, hard-wrapped text (PDFs: lines
  // broken mid-sentence), Markdown headings, quotes and lists. Very long paragraphs are cut at
  // sentence ends, so every screenful is timed and one wall of text still builds a baseline.
  const LONG = 180, CHUNK = 120;
  const HEADING = /^#{1,6}\s+/, ITEM = /^\s*(?:[-*•+]|\d+[.)])\s+/;
  const ends = (l) => /[.!?:;"”’')\]]$/.test(l);
  // A short line not ending like a sentence ("How do batteries store energy?" is a title, "Four." is not).
  const isHeading = (b) => HEADING.test(b) || (!b.includes("\n") && words(b) <= 10 && !/[.:;,]$/.test(b) && !ITEM.test(b));

  function chunk(text) {
    if (words(text) <= LONG) return [text];
    const sentences = text.match(/[^.!?]+(?:[.!?]+["”’')\]]*\s*|$)/g) || [text];
    const out = [];
    let cur = "";
    for (const sn of sentences) {
      if (cur && words(cur) + words(sn) > CHUNK && words(cur) >= CHUNK / 2) { out.push(cur.trim()); cur = ""; }
      cur += sn;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function parseText(raw) {
    const text = String(raw).replace(/\r\n?/g, "\n").trim();
    let blocks;
    if (/\n\s*\n/.test(text)) blocks = text.split(/\n\s*\n/);
    else {
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      // One paragraph per line, unless the lines are a hard-wrapped text broken mid-sentence.
      const whole = lines.filter((l) => ends(l) || l.length <= 60 || ITEM.test(l) || HEADING.test(l)).length;
      blocks = lines.length > 1 && whole / lines.length < 0.6 ? [lines.join("\n")] : lines;
    }
    blocks = blocks.map((b) => b.split("\n").map((l) => l.trim().replace(/^>\s?/, "")).filter(Boolean).join("\n")).filter(Boolean);

    const items = []; // { heading } or { text }
    for (const b of blocks) {
      const lines = b.split("\n");
      if (HEADING.test(lines[0]) || (lines.length === 1 && isHeading(b))) {
        items.push({ heading: lines[0].replace(HEADING, "").trim() });
        lines.shift();
        if (!lines.length) continue;
      }
      if (lines.every((l) => ITEM.test(l))) items.push({ text: lines.map((l) => `• ${l.replace(ITEM, "")}`).join("\n") });
      else for (const c of chunk(lines.join(" "))) items.push({ text: c });
    }
    // Nothing but short lines: they're the text, not headings.
    if (!items.some((it) => it.text !== undefined)) return { title: null, paragraphs: items.map((it) => it.heading), headings: items.map(() => null) };
    let title = null;
    if (items.length > 1 && items[0].heading !== undefined) title = items.shift().heading;
    const paragraphs = [], headings = [];
    let pending = null;
    for (const it of items) {
      if (it.heading !== undefined) { pending = it.heading; continue; }
      paragraphs.push(it.text);
      headings.push(pending);
      pending = null;
    }
    return { title, paragraphs, headings };
  }

  return { KEY, SLOW_RATIO, MIN_SAMPLES, MIN_WORDS, IDLE_MS, words, msPer100Words, median, isSlow, Baseline, Clock, parseText };
});
