// Non-PDF formats → Book (title + sections of blocks). The format is sniffed from
// the bytes, with the file extension only as a tie-breaker.

import { detectLanguage } from "../layout.js";
import type { Block, Lang } from "../model.js";
import { FormatError } from "./errors.js";
import { DOCX, FB2, HTML, ODT, attr, domToBlocks, findAll, htmlToBlocks, parseXml } from "./markup.js";
import { isPalmBook, readPalmBook } from "./mobi.js";
import { rtfToBlocks } from "./rtf.js";
import { decodeText, markdownToBlocks, plainTextToBlocks } from "./text.js";
import { ZipArchive, resolvePath } from "./zip.js";

export interface Book {
  title: string;
  format: string;
  lang: Lang;
  sections: Block[][];
}

export type Format = "pdf" | "zip" | "mobi" | "rtf" | "fb2" | "html" | "markdown" | "text" | "binary";

const extension = (name: string): string => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";

export function sniffFormat(bytes: Uint8Array, name: string): Format {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  if (head.slice(0, 1024).includes("%PDF-")) return "pdf";
  if (ZipArchive.isZip(bytes)) return "zip";
  if (isPalmBook(bytes)) return "mobi";
  if (head.startsWith("{\\rtf")) return "rtf";
  if (/<FictionBook[\s>]/.test(head)) return "fb2";
  const ext = extension(name);
  if (ext === "md" || ext === "markdown") return "markdown";
  if (["html", "htm", "xhtml"].includes(ext) || /^\s*(?:<\?xml[^>]*>\s*)?(?:<!doctype html|<html[\s>])/i.test(head)) {
    return "html";
  }
  let zeros = 0;
  for (const b of bytes.subarray(0, 4096)) if (b === 0) zeros++;
  // UTF-16 text has many zero bytes too, but starts with a BOM.
  const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  return zeros > 8 && !utf16 ? "binary" : "text";
}

/** Splits a long block list into sections at headings (or every ~60 blocks). */
export function chunk(blocks: readonly Block[], max = 60): Block[][] {
  const out: Block[][] = [];
  let cur: Block[] = [];
  for (const b of blocks) {
    if (cur.length > 0 && ((b.kind === "heading" && cur.length >= 8) || cur.length >= max)) {
      out.push(cur);
      cur = [];
    }
    cur.push(b);
  }
  if (cur.length) out.push(cur);
  return out;
}

const baseName = (name: string): string => name.replace(/\.[^.]+$/, "");

function xmlEncoding(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  return /encoding=["']([\w-]+)["']/i.exec(head)?.[1] ?? "utf-8";
}

function decodeXml(bytes: Uint8Array): string {
  try {
    return new TextDecoder(xmlEncoding(bytes)).decode(bytes);
  } catch {
    return decodeText(bytes);
  }
}

async function readEpub(zip: ZipArchive, name: string): Promise<Omit<Book, "lang">> {
  if (zip.has("META-INF/encryption.xml")) {
    const enc = await zip.text("META-INF/encryption.xml");
    // Font obfuscation is harmless; anything else means DRM.
    const fontOnly = !/EncryptedData/i.test(enc.replace(/<EncryptedData[\s\S]*?(?:obfuscation|font)[\s\S]*?<\/EncryptedData>/gi, ""));
    if (!fontOnly) throw new FormatError("Bu EPUB DRM korumalı; açılamaz.");
  }
  const container = parseXml(await zip.text("META-INF/container.xml"));
  const opfPath = attr(findAll(container, "rootfile")[0] ?? container.documentElement, "full-path");
  if (!opfPath || !zip.has(opfPath)) throw new FormatError("EPUB bozuk: içerik listesi (OPF) bulunamadı.");
  const opf = parseXml(await zip.text(opfPath));
  const title = findAll(opf, "title")[0]?.textContent?.trim() || baseName(name);
  const manifest = new Map<string, { href: string; type: string }>();
  for (const item of findAll(opf, "item")) {
    manifest.set(attr(item, "id"), { href: resolvePath(opfPath, attr(item, "href")), type: attr(item, "media-type") });
  }
  const sections: Block[][] = [];
  for (const ref of findAll(opf, "itemref")) {
    const item = manifest.get(attr(ref, "idref"));
    if (!item || !/html|xml/i.test(item.type) || !zip.has(item.href)) continue;
    const doc = parseXml(decodeXml(await zip.read(item.href)), "application/xhtml+xml");
    const body = findAll(doc, "body")[0];
    if (!body) continue;
    const blocks = domToBlocks(body, HTML);
    if (blocks.length) sections.push(...chunk(blocks, 120));
  }
  return { title, format: "EPUB", sections };
}

async function readDocx(zip: ZipArchive, name: string): Promise<Omit<Book, "lang">> {
  const doc = parseXml(await zip.text("word/document.xml"));
  const body = findAll(doc, "body")[0];
  if (!body) throw new FormatError("DOCX bozuk: belge gövdesi bulunamadı.");
  let title = baseName(name);
  if (zip.has("docProps/core.xml")) {
    title = findAll(parseXml(await zip.text("docProps/core.xml")), "title")[0]?.textContent?.trim() || title;
  }
  return { title, format: "DOCX", sections: chunk(domToBlocks(body, DOCX)) };
}

async function readOdt(zip: ZipArchive, name: string): Promise<Omit<Book, "lang">> {
  const doc = parseXml(await zip.text("content.xml"));
  const body = findAll(doc, "body")[0];
  if (!body) throw new FormatError("ODT bozuk: belge gövdesi bulunamadı.");
  let title = baseName(name);
  if (zip.has("meta.xml")) title = findAll(parseXml(await zip.text("meta.xml")), "title")[0]?.textContent?.trim() || title;
  return { title, format: "ODT", sections: chunk(domToBlocks(body, ODT)) };
}

function readFb2(bytes: Uint8Array, name: string): Omit<Book, "lang"> {
  const doc = parseXml(decodeXml(bytes));
  const titleInfo = findAll(doc, "title-info")[0];
  const title = (titleInfo && findAll(titleInfo, "book-title")[0]?.textContent?.trim()) || baseName(name);
  const sections: Block[][] = [];
  for (const body of findAll(doc, "body")) {
    if (attr(body, "name") === "notes") continue;
    sections.push(...chunk(domToBlocks(body, FB2)));
  }
  return { title, format: "FB2", sections };
}

async function readZip(bytes: Uint8Array, name: string): Promise<Omit<Book, "lang">> {
  const zip = ZipArchive.open(bytes);
  if (zip.has("mimetype")) {
    const mime = (await zip.text("mimetype")).trim();
    if (mime === "application/epub+zip") return readEpub(zip, name);
    if (mime === "application/vnd.oasis.opendocument.text") return readOdt(zip, name);
  }
  if (zip.has("META-INF/container.xml")) return readEpub(zip, name);
  if (zip.has("word/document.xml")) return readDocx(zip, name);
  if (zip.has("content.xml")) return readOdt(zip, name);
  const inner = zip.names().find((n) => /\.(fb2|txt|md|html?|rtf)$/i.test(n));
  if (inner) return readSingle(await zip.read(inner), inner);
  throw new FormatError("Bu ZIP arşivinde okunabilir bir belge bulunamadı.");
}

function readSingle(bytes: Uint8Array, name: string): Omit<Book, "lang"> {
  switch (sniffFormat(bytes, name)) {
    case "mobi": {
      const mobi = readPalmBook(bytes);
      const blocks = mobi.kind === "html" ? htmlToBlocks(mobi.content).blocks : plainTextToBlocks(mobi.content);
      return { title: mobi.title || baseName(name), format: mobi.kind === "html" ? "MOBI" : "PalmDOC", sections: chunk(blocks) };
    }
    case "rtf":
      return { title: baseName(name), format: "RTF", sections: chunk(rtfToBlocks(bytes)) };
    case "fb2":
      return readFb2(bytes, name);
    case "html": {
      const { title, blocks } = htmlToBlocks(decodeText(bytes));
      return { title: title || baseName(name), format: "HTML", sections: chunk(blocks) };
    }
    case "markdown":
      return { title: baseName(name), format: "Markdown", sections: chunk(markdownToBlocks(decodeText(bytes))) };
    case "text":
      return { title: baseName(name), format: "Metin", sections: chunk(plainTextToBlocks(decodeText(bytes))) };
    case "binary":
      throw new FormatError(
        /\.doc$/i.test(name)
          ? "Eski Word (.doc) biçimi desteklenmiyor. Word'de DOCX olarak kaydedip açın."
          : "Bu dosya biçimi tanınmadı. Desteklenenler: PDF, EPUB, MOBI/AZW3, DOCX, ODT, RTF, TXT, Markdown, HTML, FB2.",
      );
    default:
      throw new FormatError("Bu dosya burada açılamaz.");
  }
}

/** Opens any supported non-PDF document. */
export async function loadBook(bytes: Uint8Array, name: string): Promise<Book> {
  const book = sniffFormat(bytes, name) === "zip" ? await readZip(bytes, name) : readSingle(bytes, name);
  const sample = book.sections.slice(0, 3).flat().map((b) => b.text).join(" ").slice(0, 20_000);
  const lang = detectLanguage(sample);
  return { ...book, lang: lang === "und" ? "tr" : lang };
}
