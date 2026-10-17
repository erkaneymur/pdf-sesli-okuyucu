// Pure text-layout logic: turns positioned PDF text items into reading-order blocks.
// No DOM or PDF.js imports here, so it runs under `node --test`.

import type { Block, Lang, Line, Sentence, TextItem } from "./model.js";

/** Groups items into lines (top to bottom), keeping the raw items of each line. */
function groupItemLines(items: readonly TextItem[]): TextItem[][] {
  const sorted = items.filter((i) => i.str.trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextItem[][] = [];
  for (const item of sorted) {
    const current = lines.at(-1);
    const ref = current?.[0];
    if (current && ref && Math.abs(ref.y - item.y) <= Math.max(ref.fontSize, item.fontSize) * 0.5) {
      current.push(item);
    } else {
      lines.push([item]);
    }
  }
  return lines;
}

function toLine(items: readonly TextItem[]): Line {
  const parts = [...items].sort((a, b) => a.x - b.x);
  let text = "";
  let end = -Infinity;
  let fontSize = 0;
  for (const p of parts) {
    if (text !== "" && p.x - end > p.fontSize * 0.15 && !/\s$/.test(text) && !/^\s/.test(p.str)) text += " ";
    text += p.str;
    end = Math.max(end, p.x + p.width);
    fontSize = Math.max(fontSize, p.fontSize);
  }
  const first = parts[0];
  return {
    text: text.replace(/­(?!$)/g, "").replace(/\s+/g, " ").trim(),
    x: first?.x ?? 0,
    y: first?.y ?? 0,
    right: end,
    fontSize,
  };
}

export function groupLines(items: readonly TextItem[]): Line[] {
  return groupItemLines(items).map(toLine);
}

/**
 * Splits a page into reading-order regions: full-width text above the columns,
 * left column, right column, full-width text below. Single-column pages return one region.
 */
export function splitColumns(items: readonly TextItem[], pageWidth: number): TextItem[][] {
  const mid = pageWidth / 2;
  const crosses = (i: TextItem): boolean => i.x < mid && i.x + i.width > mid;
  const lines = groupItemLines(items);
  if (lines.length < 4) return [items.slice()];
  const crossing = lines.filter((line) => line.some(crosses)).length;
  if (crossing / lines.length > 0.3) return [items.slice()];

  const left: TextItem[] = [];
  const right: TextItem[] = [];
  const span: TextItem[] = [];
  for (const i of items) {
    if (i.str.trim() === "") continue;
    if (crosses(i)) span.push(i);
    else if (i.x + i.width <= mid) left.push(i);
    else right.push(i);
  }
  const chars = (list: TextItem[]): number => list.reduce((n, i) => n + i.str.length, 0);
  const total = chars(left) + chars(right) + chars(span);
  if (chars(left) < total * 0.2 || chars(right) < total * 0.2) return [items.slice()];

  // Full-width lines cut the page into horizontal bands; within a band the left
  // column is read before the right one.
  const spanLines = groupItemLines(span);
  const bandOf = (i: TextItem): number => spanLines.filter((l) => (l[0]?.y ?? 0) > i.y).length;
  const regions: TextItem[][] = [];
  for (let b = 0; b <= spanLines.length; b++) {
    const l = left.filter((i) => bandOf(i) === b);
    const r = right.filter((i) => bandOf(i) === b);
    const s = spanLines[b];
    if (l.length) regions.push(l);
    if (r.length) regions.push(r);
    if (s) regions.push(s);
  }
  return regions;
}

const PAGE_NUMBER = /^(?:sayfa|page|s\.)?\s*[-–]?\s*\d{1,4}\s*(?:(?:\/|of|-|–)\s*\d{1,4})?\s*[-–]?$/iu;

/**
 * Drops running headers/footers and page numbers. Works page by page so it can
 * stream: an edge line (top two / bottom two lines, inside the outer 10% of the
 * page) is dropped once the same text (digits ignored) appeared at a page edge
 * on two earlier pages.
 */
export class RunningHeaderFilter {
  private readonly seen = new Map<string, number>();

  apply(lines: readonly Line[], pageHeight: number): Line[] {
    const byHeight = [...lines].sort((a, b) => b.y - a.y);
    const edges = new Set([
      ...byHeight.slice(0, 2).filter((l) => l.y > pageHeight * 0.9),
      ...byHeight.slice(-2).filter((l) => l.y < pageHeight * 0.1),
    ]);
    const drop = new Set<Line>();
    const pageKeys = new Set<string>();
    for (const line of edges) {
      if (line.text.length > 120) continue;
      if (PAGE_NUMBER.test(line.text)) {
        drop.add(line);
        continue;
      }
      const key = line.text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
      if ((this.seen.get(key) ?? 0) >= 2) drop.add(line);
      pageKeys.add(key);
    }
    for (const key of pageKeys) this.seen.set(key, (this.seen.get(key) ?? 0) + 1);
    return lines.filter((l) => !drop.has(l));
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

/** Joins two wrapped lines, undoing end-of-line hyphenation. */
export function joinLines(a: string, b: string): string {
  if (/\p{L}[-­]$/u.test(a)) {
    if (/^\p{Ll}/u.test(b)) return a.slice(0, -1) + b;
    return a.endsWith("­") ? a.slice(0, -1) + b : a + b;
  }
  return `${a} ${b}`;
}

const TERMINAL = /[.!?…:;"”’)]$/u;

/** Groups reading-order lines into heading and paragraph blocks. */
export function buildBlocks(lines: readonly Line[]): Block[] {
  if (lines.length === 0) return [];
  const body = median(lines.map((l) => l.fontSize));
  const isHeading = (l: Line): boolean => l.fontSize >= body * 1.2 && l.text.length < 200;
  const gaps: number[] = [];
  for (let k = 1; k < lines.length; k++) {
    const prev = lines[k - 1];
    const cur = lines[k];
    if (prev && cur && !isHeading(prev) && !isHeading(cur)) {
      const gap = prev.y - cur.y;
      if (gap > 0) gaps.push(gap);
    }
  }
  const spacing = median(gaps) || body * 1.2;
  const width = median(lines.map((l) => l.right - l.x));

  const raw: { kind: Block["kind"]; text: string }[] = [];
  let prev: Line | undefined;
  for (const line of lines) {
    const kind = isHeading(line) ? "heading" : "paragraph";
    const last = raw.at(-1);
    let breakHere = !last || !prev || last.kind !== kind;
    if (!breakHere && prev) {
      const gap = prev.y - line.y;
      const ended = TERMINAL.test(prev.text);
      if (gap > spacing * 1.5) breakHere = true;
      else if (ended && prev.right - prev.x < width * 0.8) breakHere = true;
      else if (ended && gap > 0 && line.x > prev.x + body) breakHere = true;
    }
    if (breakHere || !last) raw.push({ kind, text: line.text });
    else last.text = joinLines(last.text, line.text);
    prev = line;
  }
  return raw.map((b) => ({ ...b, lang: detectLanguage(b.text), sentences: splitSentences(b.text) }));
}

const ABBREVIATION =
  /(?:^|[\s(])(?:dr|prof|doç|yrd|av|sn|vb|vs|vd|örn|bkz|no|mr|mrs|ms|st|al|fig|şek|tab|ss?|yy|ltd|inc|co|e\.g|i\.e)\.$/iu;

export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  for (const m of text.matchAll(/[.!?…]+["'”’)\]]*\s+(?=[\p{Lu}\d"“'‘(\[])/gu)) {
    const end = (m.index ?? 0) + m[0].trimEnd().length;
    const chunk = text.slice(start, end).trim();
    if (ABBREVIATION.test(chunk) || /(?:^|\s)\p{Lu}\.$/u.test(chunk)) continue;
    if (chunk) out.push({ text: chunk });
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push({ text: rest });
  return out;
}

const TR_WORDS = new Set([
  "ve", "bir", "bu", "için", "ile", "da", "de", "olarak", "daha", "çok", "gibi", "olan", "ise", "veya", "kadar",
  "sonra", "göre", "değil", "her", "şu", "ancak",
]);
const EN_WORDS = new Set([
  "the", "and", "of", "to", "is", "in", "that", "for", "with", "as", "are", "on", "this", "by", "be", "or", "from",
  "was", "it", "an",
]);

export function detectLanguage(text: string): Lang {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 5) return "und";
  let tr = (text.match(/[çğışöüÇĞİŞÖÜ]/g)?.length ?? 0) / 4;
  let en = 0;
  for (const w of words) {
    if (TR_WORDS.has(w)) tr++;
    if (EN_WORDS.has(w)) en++;
  }
  if (tr === 0 && en === 0) return "und";
  if (tr > en * 1.2) return "tr";
  if (en > tr * 1.2) return "en";
  return "und";
}

/** Full pipeline for one page. The filter carries state across pages. */
export function buildPage(
  items: readonly TextItem[],
  pageWidth: number,
  pageHeight: number,
  filter: RunningHeaderFilter,
): Block[] {
  const lines = splitColumns(items, pageWidth).flatMap((region) => groupLines(region));
  return buildBlocks(filter.apply(lines, pageHeight));
}
