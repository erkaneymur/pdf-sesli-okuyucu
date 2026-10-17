// Format readers, fed with real container structures built here (ZIP, PalmDB).
import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMParser } from "linkedom";
import { mobi, zip } from "../helpers/builders.mjs";

globalThis.DOMParser = DOMParser;
const { loadBook, sniffFormat } = await import("../../web/js/formats/book.js");
const { palmDocDecompress } = await import("../../web/js/formats/mobi.js");
const { decodeText, markdownToBlocks, plainTextToBlocks } = await import("../../web/js/formats/text.js");
const { rtfToText } = await import("../../web/js/formats/rtf.js");
const { resolvePath } = await import("../../web/js/formats/zip.js");

const enc = new TextEncoder();
const texts = (book) => book.sections.flat().map((b) => `${b.kind === "heading" ? "#" : ""}${b.text}`);

test("sniffFormat recognises containers by content, not just extension", () => {
  assert.equal(sniffFormat(enc.encode("%PDF-1.7\n"), "x.bin"), "pdf");
  assert.equal(sniffFormat(enc.encode("{\\rtf1\\ansi hi}"), "x.txt"), "rtf");
  assert.equal(sniffFormat(zip({ a: "b" }), "x"), "zip");
  assert.equal(sniffFormat(enc.encode("<!DOCTYPE html><p>x"), "x"), "html");
  assert.equal(sniffFormat(enc.encode("# Başlık"), "notlar.md"), "markdown");
  assert.equal(sniffFormat(new Uint8Array(64).fill(0), "eski.doc"), "binary");
  assert.equal(sniffFormat(enc.encode("düz metin"), "a.txt"), "text");
});

test("EPUB: spine order, headings, title, scripts ignored, relative paths resolved", async () => {
  const chapter = (h, p) =>
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><script>alert(1)</script></head><body><h1>${h}</h1><p>${p}</p></body></html>`;
  const book = await loadBook(
    zip({
      mimetype: "application/epub+zip",
      "META-INF/container.xml":
        '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      "OEBPS/content.opf": `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Kürk Mantolu Madonna</dc:title></metadata><manifest><item id="c1" href="text/bir.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/iki%20b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c2"/><itemref idref="c1"/></spine></package>`,
      "OEBPS/text/bir.xhtml": chapter("Birinci Bölüm", "Raif Efendi her sabah bürosuna giderdi."),
      "OEBPS/text/iki b.xhtml": chapter("Önsöz", "Bu kitap bir aşk hikâyesidir ve çok sevilir."),
    }),
    "kitap.epub",
  );
  assert.equal(book.title, "Kürk Mantolu Madonna");
  assert.equal(book.format, "EPUB");
  assert.equal(book.lang, "tr");
  assert.deepEqual(texts(book), [
    "#Önsöz",
    "Bu kitap bir aşk hikâyesidir ve çok sevilir.",
    "#Birinci Bölüm",
    "Raif Efendi her sabah bürosuna giderdi.",
  ]);
});

test("DOCX: paragraphs, heading styles, tabs; field codes and deleted text dropped", async () => {
  const body = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Giriş</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Merhaba </w:t></w:r><w:r><w:t>dünya</w:t></w:r><w:r><w:tab/><w:t>şimdi</w:t></w:r><w:del><w:r><w:delText>silindi</w:delText></w:r></w:del><w:r><w:instrText>PAGE</w:instrText></w:r></w:p>
</w:body></w:document>`;
  const book = await loadBook(
    zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": body, "docProps/core.xml": '<cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Rapor</dc:title></cp:coreProperties>' }),
    "rapor.docx",
  );
  assert.equal(book.title, "Rapor");
  assert.deepEqual(texts(book), ["#Giriş", "Merhaba dünya şimdi"]);
});

test("ODT: headings, paragraphs, text:s spaces, footnotes skipped", async () => {
  const content = `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>
<text:h text:outline-level="1">Başlık</text:h><text:p>Bir<text:s/>iki<text:note><text:note-body><text:p>dipnot</text:p></text:note-body></text:note> üç.</text:p></office:text></office:body></office:document-content>`;
  const book = await loadBook(zip({ mimetype: "application/vnd.oasis.opendocument.text", "content.xml": content }), "belge.odt");
  assert.deepEqual(texts(book), ["#Başlık", "Bir iki üç."]);
});

test("FB2 in windows-1251 with sections, titles and verse; binaries skipped", async () => {
  const xml = `<?xml version="1.0" encoding="windows-1251"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>Стихи</book-title></title-info></description><body><section><title><p>Глава 1</p></title><p>Первый абзац.</p><poem><stanza><v>Строка один</v><v>Строка два</v></stanza></poem></section></body><binary id="img">AAAA</binary></FictionBook>`;
  // Encode as windows-1251 by hand for the Cyrillic letters used here.
  const cp1251 = (s) => Uint8Array.from([...s].map((ch) => { const c = ch.codePointAt(0); return c >= 0x410 && c <= 0x44f ? c - 0x350 : c; }));
  const book = await loadBook(cp1251(xml), "kitap.fb2");
  assert.equal(book.title, "Стихи");
  assert.deepEqual(texts(book), ["#Глава 1", "Первый абзац.", "Строка один", "Строка два"]);
});

test("RTF: Turkish codepage escapes, \\u unicode with fallback skip, destinations dropped", () => {
  const rtf = String.raw`{\rtf1\ansi\ansicpg1254\deff0{\fonttbl{\f0 Arial;}}{\colortbl;\red0\green0\blue0;}{\*\generator Riched20;}
\pard Merhaba d\'fcnya, \'e7al\'fd\'fe\'fdyor mu?\par
{\b Kal\'fdn} metin \u351?ehir \endash  son.\par
{\field{\*\fldinst HYPERLINK "x"}{\fldrslt ba\'f0lant\'fd}}\par}`;
  const text = rtfToText(enc.encode(rtf));
  assert.deepEqual(text.split("\n").map((s) => s.trim()).filter(Boolean), [
    "Merhaba dünya, çalışıyor mu?",
    "Kalın metin şehir – son.",
    "bağlantı",
  ]);
});

test("MOBI: uncompressed and PalmDOC records, trailing entries stripped, UTF-8 title", async () => {
  const html = "<html><body><h2>Bölüm 1</h2><p>İlk paragraf burada.</p><mbp:pagebreak/><p>İkinci paragraf.</p></body></html>";
  const raw = Buffer.from(html, "utf8");
  // Record split in two, each followed by one multibyte trailing entry (flag bit 0).
  const recs = [raw.subarray(0, 40), raw.subarray(40)].map((r) => Buffer.concat([r, Buffer.from([0x00])]));
  const plain = await loadBook(mobi({ title: "Türkçe Kitap", compression: 1, records: recs, extraFlags: 1 }), "k.mobi");
  assert.equal(plain.title, "Türkçe Kitap");
  assert.equal(plain.format, "MOBI");
  assert.deepEqual(texts(plain), ["#Bölüm 1", "İlk paragraf burada.", "İkinci paragraf."]);

  // PalmDOC: literal bytes, a back-reference, and a space+char pair.
  const ascii = "<p>abcabcabc xyz</p>";
  const packed = Buffer.concat([
    Buffer.from("<p>abc"),
    Buffer.from([0x80 | ((3 << 3) >> 8), ((3 << 3) | 3) & 0xff]), // copy 6 chars from distance 3
    Buffer.from([0x78 ^ 0x80]), // " x"
    Buffer.from("yz</p>"),
  ]);
  assert.equal(Buffer.from(palmDocDecompress(packed)).toString("latin1"), ascii);
  const compressed = await loadBook(mobi({ title: "A", compression: 2, records: [packed], encoding: 1252 }), "a.azw3");
  assert.deepEqual(texts(compressed), ["abcabcabc xyz"]);
});

test("MOBI with DRM or HUFF/CDIC gives a clear error", async () => {
  const drm = mobi({ title: "x", compression: 2, records: [Buffer.from("a")] });
  const record0 = new DataView(drm.buffer).getUint32(78, false);
  drm[record0 + 13] = 2; // encryption type (u16 at +12) = Mobipocket DRM
  await assert.rejects(loadBook(drm, "x.azw"), /DRM/);
  const huff = mobi({ title: "x", compression: 17480, records: [Buffer.from("a")] });
  await assert.rejects(loadBook(huff, "x.mobi"), /HUFF/);
});

test("plain text: Windows-1254 decoding, blank-line paragraphs, hyphen joining, chapter headings", () => {
  const cp1254 = Uint8Array.from([0x47, 0xfc, 0x7a, 0x65, 0x6c, 0x20, 0xfe, 0x65, 0x68, 0x69, 0x72]); // "Güzel şehir"
  assert.equal(decodeText(cp1254), "Güzel şehir");
  const blocks = plainTextToBlocks("BÖLÜM 1\n\nBu satır bilgisa-\nyarla yazıldı ve\nbitti.\n\nİkinci paragraf.");
  assert.deepEqual(blocks.map((b) => [b.kind, b.text]), [
    ["heading", "BÖLÜM 1"],
    ["paragraph", "Bu satır bilgisayarla yazıldı ve bitti."],
    ["paragraph", "İkinci paragraf."],
  ]);
});

test("markdown: headings, emphasis and links stripped, lists, code fences", () => {
  const md = "# Başlık\n\nBir **kalın** ve [bağlantı](http://x) metni\nsürer.\n\n- madde bir\n- madde iki\n\n```\nkod satırı\n```";
  assert.deepEqual(markdownToBlocks(md).map((b) => [b.kind, b.text]), [
    ["heading", "Başlık"],
    ["paragraph", "Bir kalın ve bağlantı metni sürer."],
    ["paragraph", "madde bir"],
    ["paragraph", "madde iki"],
    ["paragraph", "kod satırı"],
  ]);
});

test("HTML page: title, body blocks, nav/script removed", async () => {
  const book = await loadBook(
    enc.encode("<!doctype html><html><head><title>Haber</title></head><body><nav>Menü</nav><h1>Manşet</h1><div>Gövde <b>metni</b> burada.<br>Devam.</div><script>x()</script></body></html>"),
    "haber.html",
  );
  assert.equal(book.title, "Haber");
  assert.deepEqual(texts(book), ["#Manşet", "Gövde metni burada. Devam."]);
});

test("unknown binary and old .doc are rejected with a helpful message", async () => {
  await assert.rejects(loadBook(new Uint8Array(100), "eski.doc"), /DOCX olarak kaydedip/);
  await assert.rejects(loadBook(new Uint8Array(100), "x.bin"), /Desteklenenler/);
});

test("resolvePath handles ../, percent-encoding and fragments", () => {
  assert.equal(resolvePath("OEBPS/text/a.xhtml", "../img/b%20c.png#x"), "OEBPS/img/b c.png");
  assert.equal(resolvePath("content.opf", "ch1.xhtml"), "ch1.xhtml");
});
