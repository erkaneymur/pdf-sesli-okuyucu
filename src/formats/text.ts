// Plain text and Markdown → blocks, plus encoding detection for text files.

import { joinLines, makeBlock } from "../layout.js";
import type { Block } from "../model.js";

/** BOM-aware decode; UTF-8 when valid, otherwise Turkish Windows-1254 (the common legacy encoding). */
export function decodeText(bytes: Uint8Array, fallback = "windows-1254"): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder(fallback).decode(bytes);
  }
}

const CHAPTER = /^(?:bölüm|kısım|kitap|chapter|part|book|prologue|epilogue|önsöz|sonsöz)\b[\s\d.:IVXLC-]*\S*/iu;

function looksLikeHeading(text: string): boolean {
  if (text.length > 80 || /[.,;:!?…]$/.test(text)) return false;
  if (CHAPTER.test(text)) return true;
  const letters = text.replace(/[^\p{L}]/gu, "");
  return letters.length >= 3 && letters === letters.toLocaleUpperCase("tr");
}

export function plainTextToBlocks(text: string): Block[] {
  const norm = text.replace(/\r\n?/g, "\n").replace(/\u000c/g, "\n\n");
  const paragraphs = /\n[ \t]*\n/.test(norm) ? norm.split(/\n[ \t]*\n+/) : norm.split("\n");
  const out: Block[] = [];
  for (const para of paragraphs) {
    const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const joined = lines.reduce((acc, l) => joinLines(acc, l));
    out.push(makeBlock(lines.length === 1 && looksLikeHeading(joined) ? "heading" : "paragraph", joined));
  }
  return out;
}

function stripInlineMarkdown(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/~~(.+?)~~/g, "$1");
}

export function markdownToBlocks(text: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = (): void => {
    if (para.length) out.push(makeBlock("paragraph", stripInlineMarkdown(para.reduce((a, l) => joinLines(a, l)))));
    para = [];
  };
  let fenced = false;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```") || line.startsWith("~~~")) {
      flush();
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      if (line) out.push(makeBlock("paragraph", line));
      continue;
    }
    const heading = /^#{1,6}\s+(.*?)\s*#*$/.exec(line);
    if (heading) {
      flush();
      out.push(makeBlock("heading", stripInlineMarkdown(heading[1] ?? "")));
    } else if (line === "" || /^([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flush();
    } else if (/^([-*+]|\d+[.)])\s+/.test(line) || line.startsWith(">")) {
      flush();
      para.push(line.replace(/^([-*+]|\d+[.)])\s+/, "").replace(/^>\s?/, ""));
      flush();
    } else if (line.startsWith("|")) {
      flush();
      if (!/^\|?[\s:|-]+\|?$/.test(line)) out.push(makeBlock("paragraph", stripInlineMarkdown(line.replace(/\|/g, " ").trim())));
    } else {
      para.push(line);
    }
  }
  flush();
  return out.filter((b) => b.text !== "");
}
