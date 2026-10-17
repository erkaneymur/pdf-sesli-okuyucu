// Generates PDF fixtures with real embedded fonts (Turkish glyphs need a TTF).
// Usage: node scripts/make-fixtures.mjs  → writes tests/fixtures/*.pdf
import fontkit from "@pdf-lib/fontkit";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb } from "pdf-lib";

const FONT_CANDIDATES = [
  process.env.FIXTURE_FONT,
  "C:/Windows/Fonts/arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/Library/Fonts/Arial Unicode.ttf",
].filter(Boolean);

export function findFont() {
  return FONT_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

const TR_TEXT =
  "Okuma becerisi, öğrencilerin akademik başarısını doğrudan etkileyen temel bir yetidir. Bu çalışmada, " +
  "çok sütunlu bilimsel makalelerin sesli okunması sırasında karşılaşılan sorunlar incelenmiştir. Özellikle " +
  "şekil altyazıları, dipnotlar ve sayfa üstbilgileri okuma sırasını bozabilmektedir. Önerilen yöntem, metin " +
  "parçalarının konumlarını kullanarak doğal okuma sırasını yeniden kurar ve heceleme tirelerini birleştirir.";

const EN_TEXT =
  "Reading aloud is an accessibility feature that converts written text into speech. This document is used to " +
  "check that English paragraphs are extracted in order and that the language is detected as English by the reader.";

function wrap(text, font, size, width) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Hyphenates one line break mid-word so dehyphenation is exercised. */
function hyphenate(lines) {
  const out = [...lines];
  const k = out.findIndex((l, i) => i < out.length - 1 && l.endsWith("doğrudan"));
  if (k >= 0) {
    out[k] = out[k].replace(/doğrudan$/, "doğ-");
    out[k + 1] = `rudan ${out[k + 1]}`;
  }
  return out;
}

async function newDoc(fontPath) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await readFile(fontPath), { subset: true });
  return { doc, font };
}

export async function twoColumnTurkish(fontPath, pages = 3) {
  const { doc, font } = await newDoc(fontPath);
  doc.setTitle("Çok Sütunlu Türkçe Makale");
  const W = 595;
  const H = 842;
  const colW = 240;
  for (let p = 1; p <= pages; p++) {
    const page = doc.addPage([W, H]);
    page.drawText("Bilim Dergisi · Cilt 12 · Sayı 3", { x: 50, y: 805, size: 9, font });
    let top = 760;
    if (p === 1) {
      page.drawText("Sesli Okumada Sütun Sırası Üzerine Bir İnceleme", { x: 50, y: 770, size: 18, font });
      top = 730;
    }
    for (const [ci, x] of [50, 305].entries()) {
      const lines = hyphenate(wrap(`${ci === 0 ? "Sol" : "Sağ"} sütun ${p}. ${TR_TEXT}`, font, 10, colW));
      lines.forEach((l, i) => page.drawText(l, { x, y: top - i * 13, size: 10, font }));
    }
    page.drawText(String(p), { x: W / 2 - 3, y: 30, size: 9, font });
  }
  return doc.save();
}

export async function singleEnglish(fontPath) {
  const { doc, font } = await newDoc(fontPath);
  const page = doc.addPage([595, 842]);
  page.drawText("Introduction", { x: 50, y: 780, size: 18, font });
  wrap(EN_TEXT, font, 11, 495).forEach((l, i) => page.drawText(l, { x: 50, y: 750 - i * 14, size: 11, font }));
  return doc.save();
}

export async function scanned() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawRectangle({ x: 50, y: 400, width: 495, height: 380, color: rgb(0.85, 0.85, 0.85) });
  return doc.save();
}

export async function longTurkish(fontPath, pages) {
  const { doc, font } = await newDoc(fontPath);
  const lines = wrap(`${TR_TEXT} ${TR_TEXT} ${TR_TEXT}`, font, 11, 495);
  for (let p = 1; p <= pages; p++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Bölüm ${Math.ceil(p / 10)}`, { x: 50, y: 780, size: 16, font });
    lines.forEach((l, i) => page.drawText(l, { x: 50, y: 750 - i * 14, size: 11, font }));
    page.drawText(`Sayfa ${p} / ${pages}`, { x: 260, y: 30, size: 9, font });
  }
  return doc.save();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fontPath = findFont();
  if (!fontPath) throw new Error("No TTF font found; set FIXTURE_FONT to a .ttf with Turkish glyphs.");
  const dir = fileURLToPath(new URL("../tests/fixtures/", import.meta.url));
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}tr-two-column.pdf`, await twoColumnTurkish(fontPath));
  await writeFile(`${dir}en-single.pdf`, await singleEnglish(fontPath));
  await writeFile(`${dir}scanned.pdf`, await scanned());
  await writeFile(`${dir}tr-100.pdf`, await longTurkish(fontPath, 100));
  console.log(`Fixtures written to ${dir}`);
}
