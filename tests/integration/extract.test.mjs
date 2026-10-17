// End-to-end text extraction: real PDFs → PDF.js (Node legacy build) → layout pipeline.
import assert from "node:assert/strict";
import { test } from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { findFont, longTurkish, scanned, singleEnglish, twoColumnTurkish } from "../../scripts/make-fixtures.mjs";
import { toTextItems } from "../../web/js/items.js";
import { RunningHeaderFilter, buildPage, detectLanguage } from "../../web/js/layout.js";

const font = findFont();
const skip = font ? false : "no TTF with Turkish glyphs found (set FIXTURE_FONT)";

async function extract(bytes) {
  const doc = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  const filter = new RunningHeaderFilter();
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const [x0, y0, x1, y1] = page.view;
    const content = await page.getTextContent();
    pages.push(buildPage(toTextItems(content.items, x0, y0), x1 - x0, y1 - y0, filter));
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

test("two-column Turkish article: title first, left before right, hyphens joined, page furniture removed", { skip }, async () => {
  const pages = await extract(await twoColumnTurkish(font));
  const first = pages[0].map((b) => b.text);
  const title = pages[0].findIndex((b) => b.kind === "heading" && /Sesli Okumada Sütun Sırası/.test(b.text));
  assert.ok(title >= 0, "title is a heading");
  const text = first.join("\n");
  assert.ok(text.indexOf("Sesli Okumada") < text.indexOf("Sol sütun 1."), "title precedes columns");
  assert.ok(text.indexOf("Sol sütun 1.") < text.indexOf("Sağ sütun 1."), "left column precedes right");
  assert.match(text, /doğrudan/);
  assert.doesNotMatch(text, /doğ- ?rudan/);
  assert.match(text, /ğüşıöçİ|[ğüşıöç]/u);
  const third = pages[2].map((b) => b.text).join("\n");
  assert.doesNotMatch(third, /Bilim Dergisi/, "running header dropped from page 3");
  for (const page of pages) {
    assert.ok(page.every((b) => !/^\d+$/.test(b.text)), "page numbers dropped");
  }
  assert.equal(detectLanguage(text), "tr");
});

test("English single-column PDF is detected as English", { skip }, async () => {
  const [page] = await extract(await singleEnglish(font));
  assert.equal(page[0].text, "Introduction");
  assert.equal(page[0].kind, "heading");
  assert.equal(detectLanguage(page.map((b) => b.text).join(" ")), "en");
});

test("scanned page yields no blocks", async () => {
  const [page] = await extract(await scanned());
  assert.deepEqual(page, []);
});

test("500-page Turkish PDF extracts every page within budget", { skip, timeout: 180_000 }, async () => {
  const bytes = await longTurkish(font, 500);
  const started = performance.now();
  const pages = await extract(bytes);
  const ms = performance.now() - started;
  assert.equal(pages.length, 500);
  assert.ok(pages.every((p) => p.some((b) => b.kind === "paragraph" && b.text.includes("okuma sırasını"))));
  assert.ok(pages.slice(2).every((p) => p.every((b) => !/^Sayfa \d+ \/ 500$/.test(b.text))));
  console.log(`500 pages extracted in ${Math.round(ms)} ms`);
  assert.ok(ms < 120_000);
});
