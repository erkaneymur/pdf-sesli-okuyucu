import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RunningHeaderFilter,
  buildBlocks,
  buildPage,
  detectLanguage,
  groupLines,
  joinLines,
  splitColumns,
  splitSentences,
} from "../../web/js/layout.js";

const item = (str, x, y, width = str.length * 5, fontSize = 10) => ({ str, x, y, width, fontSize });
const line = (text, y, { x = 50, right = 500, fontSize = 10 } = {}) => ({ text, x, y, right, fontSize });

test("groupLines joins items on the same baseline and inserts spaces at gaps", () => {
  const lines = groupLines([item("dünya", 90, 700), item("Merhaba", 50, 700.4), item("Alt", 50, 686)]);
  assert.deepEqual(lines.map((l) => l.text), ["Merhaba dünya", "Alt"]);
});

test("groupLines does not add a space between touching glyph runs", () => {
  const lines = groupLines([item("Ka", 50, 700, 10), item("lem", 60, 700, 15)]);
  assert.equal(lines[0].text, "Kalem");
});

test("joinLines undoes hyphenation only before a lowercase continuation", () => {
  assert.equal(joinLines("bilgisa-", "yar"), "bilgisayar");
  assert.equal(joinLines("İstanbul-", "Ankara"), "İstanbul-Ankara");
  assert.equal(joinLines("bir", "iki"), "bir iki");
  assert.equal(joinLines("oku­", "ma"), "okuma");
});

test("splitColumns orders a two-column page left column first", () => {
  const items = [item("Başlık tam genişlik boyunca uzanır", 100, 760, 400)];
  for (let k = 0; k < 6; k++) {
    items.push(item(`sol ${k} satır metni`, 50, 700 - k * 12, 200));
    items.push(item(`sağ ${k} satır metni`, 320, 700 - k * 12, 200));
  }
  const regions = splitColumns(items, 600);
  assert.equal(regions.length, 3);
  assert.match(regions[0][0].str, /Başlık/);
  assert.ok(regions[1].every((i) => i.str.startsWith("sol")));
  assert.ok(regions[2].every((i) => i.str.startsWith("sağ")));
});

test("splitColumns keeps single-column text with word-level items as one region", () => {
  const items = [];
  for (let k = 0; k < 8; k++) {
    let x = 50;
    for (const w of ["Bu", "tek", "sütunlu", "bir", "paragraf", "satırıdır", "ve", "sürer"]) {
      items.push(item(w, x, 700 - k * 12, w.length * 7));
      x += w.length * 7 + 4;
    }
  }
  assert.equal(splitColumns(items, 600).length, 1);
});

test("RunningHeaderFilter drops page numbers and repeated headers from the third page on", () => {
  const filter = new RunningHeaderFilter();
  const page = (n) => [line(`Dergi Adı · Cilt 3`, 780), line("Gövde metni", 600), line("Gövde iki", 588), line(String(n), 40)];
  const kept = [1, 2, 3].map((n) => filter.apply(page(n), 842).map((l) => l.text));
  assert.deepEqual(kept[0], ["Dergi Adı · Cilt 3", "Gövde metni", "Gövde iki"]);
  assert.deepEqual(kept[1], ["Dergi Adı · Cilt 3", "Gövde metni", "Gövde iki"]);
  assert.deepEqual(kept[2], ["Gövde metni", "Gövde iki"]);
});

test("buildBlocks separates headings and paragraphs and splits on large gaps", () => {
  const blocks = buildBlocks([
    line("Giriş", 760, { fontSize: 16, right: 120 }),
    line("Birinci paragrafın ilk satırı burada uza-", 730),
    line("nır ve devam eder.", 718, { right: 200 }),
    line("İkinci paragraf yeni bir düşünceyle başlar", 690),
    line("ve burada biter.", 678, { right: 200 }),
  ]);
  assert.deepEqual(
    blocks.map((b) => [b.kind, b.text]),
    [
      ["heading", "Giriş"],
      ["paragraph", "Birinci paragrafın ilk satırı burada uzanır ve devam eder."],
      ["paragraph", "İkinci paragraf yeni bir düşünceyle başlar ve burada biter."],
    ],
  );
});

test("splitSentences respects common Turkish and English abbreviations", () => {
  const s = splitSentences("Prof. Dr. Ayşe Yılmaz geldi. Toplantı başladı! Örn. bu bir. Then e.g. this ends. Son");
  assert.deepEqual(s.map((x) => x.text), [
    "Prof. Dr. Ayşe Yılmaz geldi.",
    "Toplantı başladı!",
    "Örn. bu bir.",
    "Then e.g. this ends.",
    "Son",
  ]);
});

test("detectLanguage tells Turkish from English", () => {
  assert.equal(detectLanguage("Bu çalışmada öğrencilerin okuma becerileri ve dil gelişimi için bir yöntem önerilmektedir."), "tr");
  assert.equal(detectLanguage("This study proposes a method for the reading skills of students and their language."), "en");
  assert.equal(detectLanguage("kısa"), "und");
});

test("RunningHeaderFilter keeps repeated body lines on short pages", () => {
  const filter = new RunningHeaderFilter();
  const page = () => [line("Aynı gövde", 600), line("Aynı gövde iki", 588)];
  for (let k = 0; k < 4; k++) assert.equal(filter.apply(page(), 842).length, 2);
});

test("splitColumns reads a left-aligned header above a full-width title first", () => {
  const items = [item("Dergi · Cilt 3", 50, 805, 80), item("Tam genişlikte uzun makale başlığı", 50, 770, 450)];
  for (let k = 0; k < 6; k++) {
    items.push(item(`sol ${k} satır metni`, 50, 700 - k * 12, 200));
    items.push(item(`sağ ${k} satır metni`, 320, 700 - k * 12, 200));
  }
  const order = splitColumns(items, 600).map((r) => r[0].str);
  assert.deepEqual(order, ["Dergi · Cilt 3", "Tam genişlikte uzun makale başlığı", "sol 0 satır metni", "sağ 0 satır metni"]);
});

test("buildPage returns no blocks for an empty (scanned) page", () => {
  assert.deepEqual(buildPage([], 600, 842, new RunningHeaderFilter()), []);
});
