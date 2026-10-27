// Unit tests for portal/study-pace.js (S2, S3, S4). Run: node --test tests/study/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const P = createRequire(import.meta.url)("../../portal/study-pace.js");

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test("S2: time per paragraph is normalised to 100 words", () => {
  assert.equal(P.words("A battery is a small chemical factory, isn't it?"), 9);
  assert.equal(P.msPer100Words(20000, 50), 40000);
  assert.equal(P.msPer100Words(20000, 200), 10000);
  assert.equal(P.msPer100Words(20000, 4), null, "too short to time");
  assert.equal(P.msPer100Words(800, 50), null, "a skip, not a reading");
  assert.equal(P.msPer100Words(10 * 60000, 50), null, "walked away");
});

test("S2: the clock counts only active, visible time", () => {
  let t = 0;
  const c = new P.Clock(() => t);
  c.start(); t = 10000; assert.equal(c.elapsed(), 10000);
  c.stop(); t = 50000; assert.equal(c.elapsed(), 10000, "stopped while hidden");
  c.start(); t = 55000; c.poke(); t = 60000; c.stop(); assert.equal(c.elapsed(), 20000);
  // Idle for 5 minutes: only IDLE_MS of it counts, and timing resumes on the next activity.
  c.start(); t += 5 * 60000; assert.equal(c.elapsed(), 20000 + P.IDLE_MS);
  c.poke(); t += 3000; c.stop(); assert.equal(c.elapsed(), 20000 + P.IDLE_MS + 3000);
});

test("S3: the baseline is the median of the reader's own paragraphs and survives a new session", () => {
  const store = memoryStorage();
  const a = new P.Baseline(store);
  assert.deepEqual(a.stats(), { median: null, samples: 0 });
  a.record(0, 20000); a.record(1, 24000); a.record(2, 18000);
  assert.deepEqual(a.stats(), { median: 20000, samples: 3 });
  a.record(1, 30000); // a reread replaces the paragraph's value
  assert.deepEqual(a.stats(), { median: 20000, samples: 3 });
  assert.deepEqual(a.stats(1), { median: 19000, samples: 2 }, "never compared with itself");
  const b = new P.Baseline(store); // reload
  assert.deepEqual(b.stats(), { median: 20000, samples: 3 });
  b.record(0, 22000);
  assert.deepEqual(b.stats(), { median: 21000, samples: 4 });
  b.clear();
  assert.deepEqual(new P.Baseline(store).stats(), { median: null, samples: 0 });
});

test("S3: a blocked or broken store doesn't break reading", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} };
  const b = new P.Baseline(broken);
  b.record(0, 1000 * 20);
  assert.equal(b.stats().samples, 1);
  const junk = memoryStorage(); junk.setItem(P.KEY, "{not json");
  assert.equal(new P.Baseline(junk).stats().samples, 0);
});

test("S4: slow means at least SLOW_RATIO times the usual pace, once there is a baseline", () => {
  assert.equal(P.SLOW_RATIO, 1.5);
  assert.equal(P.isSlow(30000, 20000, 3), true);
  assert.equal(P.isSlow(29000, 20000, 3), false);
  assert.equal(P.isSlow(60000, 20000, 2), false, "no baseline yet");
  assert.equal(P.isSlow(null, 20000, 10), false);
  assert.equal(P.isSlow(25000, 20000, 3, 1.2), true, "threshold is tunable");
});

test("S1: pasted text splits into a title and paragraphs", () => {
  const t = (raw) => { const r = P.parseText(raw); return [r.title, r.paragraphs, r.headings]; };
  assert.deepEqual(t("Batteries\n\nOne two.\nthree.\n\n  Four.  "), ["Batteries", ["One two. three.", "Four."], [null, null]]);
  assert.deepEqual(t("First line.\nSecond line.\r\nThird line."), [null, ["First line.", "Second line.", "Third line."], [null, null, null]]);
  assert.deepEqual(t("Just one paragraph"), [null, ["Just one paragraph"], [null]]);
  assert.deepEqual(t("  \n "), [null, [], []]);
});

test("S1: Markdown headings, lists and quotes; headings label the paragraph under them", () => {
  const r = P.parseText("# Cells\n\n## Membranes\n\nThe membrane is a bilayer of lipids.\n\n- lipids\n- proteins\n- sugars\n\n> A quoted line here.");
  assert.equal(r.title, "Cells");
  assert.deepEqual(r.paragraphs, ["The membrane is a bilayer of lipids.", "• lipids\n• proteins\n• sugars", "A quoted line here."]);
  assert.deepEqual(r.headings, ["Membranes", null, null]);
});

test("S1: hard-wrapped text (from a PDF) is joined, and a wall of text is cut at sentence ends", () => {
  const wrapped = "The membrane of a cell is made of two layers of lipid molecules that\nface each other so that their water loving heads point out and their\nwater fearing tails point in, which makes a barrier.";
  assert.equal(P.parseText(wrapped).paragraphs.length, 1);
  const wall = "This is a sentence of exactly ten words in it ok. ".repeat(60);
  const parts = P.parseText(wall).paragraphs;
  assert.equal(parts.length, 6);
  assert.ok(parts.every((p) => p.endsWith("ok.") && P.words(p) <= 130));
});

test("S3: a new text adds to the baseline instead of replacing the last text's paragraphs", () => {
  const store = memoryStorage();
  const b = new P.Baseline(store);
  b.record(0, 20000); b.record(1, 22000);
  b.newSession();
  b.record(0, 30000); b.record(1, 32000);
  assert.equal(b.stats().samples, 4);
  assert.equal(new P.Baseline(store).stats().samples, 4);
});

test("S1 (round 2): narrow PDF columns, lists, numbers, questions and stray labels keep every word", () => {
  const column = ["The cell membrane is made of two layers of", "lipid molecules that face each other so that", "their heads point out and their tails point in,", "which makes a barrier that most charged particles", "cannot cross without help from proteins."].join("\n");
  const c = P.parseText(column);
  assert.deepEqual([c.title, c.paragraphs.length], [null, 1]);
  assert.equal(P.words(c.paragraphs[0]), P.words(column), "no words dropped");

  const r = P.parseText("Lab notes\n\nSteps:\n- mix\n- heat\n\n1. Weigh it.\n2. Log it.\n\nWhat happens next?\n\nThe solution turns blue.\n\nPart A\n\nPart B\n\nThe end is here.");
  assert.equal(r.title, "Lab notes");
  assert.deepEqual(r.paragraphs, ["Steps:\n• mix\n• heat", "1. Weigh it.\n2. Log it.", "What happens next?", "The solution turns blue.", "Part A", "The end is here."]);
  assert.deepEqual(r.headings, [null, null, null, null, null, "Part B"]);
});

test("S2 (round 2): Chinese and Japanese are timed by characters and cut at 。", () => {
  assert.equal(P.words("电池是一个小型化学工厂。"), 11);
  assert.equal(P.words("バッテリーは化学の工場です。"), 13);
  assert.equal(P.words("배터리는 작은 화학 공장입니다."), 4);
  const zh = "电池是一个小型化学工厂，在充电时反向运行。".repeat(20);
  const parts = P.parseText(zh).paragraphs;
  assert.ok(parts.length > 1 && parts.every((p) => p.endsWith("。")), parts.length);
});

test("S1 (round 3): one newline between paragraphs with short labels; lists without blank lines; CJK line joins", () => {
  const doc = P.parseText("Title of doc\nHistory\nThe company was founded in 1990 by two engineers who wanted better batteries.\nEarly years\nIt grew slowly at first, selling to labs.\nToday\nIt makes cells for phones.");
  assert.equal(doc.title, "Title of doc");
  assert.deepEqual(doc.headings, ["History", "Early years", "Today"]);
  assert.equal(doc.paragraphs.length, 3);
  assert.deepEqual(P.parseText("Do this:\n1. Weigh it.\n2. Log it.\nThen stop here.").paragraphs, ["Do this:\n1. Weigh it.\n2. Log it.", "Then stop here."]);
  assert.deepEqual(P.parseText("Intro line here.\n\n- first item that\n  wraps onto a line\n- second").paragraphs, ["Intro line here.", "• first item that wraps onto a line\n• second"]);
  assert.equal(P.parseText("电池是一个小型化学工厂，在充\n电时反向运行，然后再次放电，一直循环下去").paragraphs[0].includes("充电"), true);
});

test("S1 (round 4): wrapped numbered items, labels above their text, poems", () => {
  const book = P.parseText("Chapter 4: Photosynthesis\nPlants convert light into sugar inside their chloroplasts.\nThe main stages are:\n1. Light absorption by chlorophyll in the thylakoid\nmembranes.\n2. Splitting of water.\n3. The Calvin cycle.");
  assert.deepEqual(book.paragraphs.at(-1), "The main stages are:\n1. Light absorption by chlorophyll in the thylakoid membranes.\n2. Splitting of water.\n3. The Calvin cycle.");
  const wiki = P.parseText("Batteries\n\nHistory\nResearch on rechargeable cells began in the 1850s with lead and acid.\n\nDesign\nGenerally a cell has two electrodes and an electrolyte between them.");
  assert.deepEqual(wiki.headings, ["History", "Design"]);
  assert.match(wiki.paragraphs[0], /^Research on/);
  const poem = P.parseText("Fire and Ice\nSome say the world will end in fire,\nSome say in ice.\nFrom what I've tasted of desire\nI hold with those who favor fire.");
  assert.equal(poem.title, "Fire and Ice");
  assert.ok(poem.headings.every((h) => h === null), JSON.stringify(poem));
  assert.equal(poem.paragraphs.map(P.words).reduce((a, b) => a + b), 25, "no words lost");
});

test("S1 (round 5): an unpunctuated list ends where a capitalised paragraph starts; # headings always label", () => {
  const recipe = P.parseText("Pancakes\nIngredients\n- 2 cups flour\n- 1 tsp salt\n- 3 eggs\nMix the flour and salt in a large bowl, then whisk in the eggs one at a time.");
  assert.deepEqual(recipe.paragraphs.slice(-2), ["• 2 cups flour\n• 1 tsp salt\n• 3 eggs", "Mix the flour and salt in a large bowl, then whisk in the eggs one at a time."]);
  const md = P.parseText("# Notes\n\nIntro text that is long enough here.\n\n## Short bit\n\nTiny.");
  assert.deepEqual(md.headings, [null, "Short bit"]);
});
