// Minimal ZIP reader (central directory + stored/deflate entries) on top of the
// platform DecompressionStream, so EPUB/DOCX/ODT need no extra library.

import { FormatError } from "./errors.js";

interface Entry {
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
  encrypted: boolean;
}

/** Upper bound for a single inflated entry (zip-bomb guard). */
const MAX_ENTRY = 256 * 1024 * 1024;

export class ZipArchive {
  private constructor(
    private readonly bytes: Uint8Array,
    private readonly entries: Map<string, Entry>,
  ) {}

  static isZip(bytes: Uint8Array): boolean {
    return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  }

  static open(bytes: Uint8Array): ZipArchive {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new FormatError("Arşiv bozuk: ZIP dizini bulunamadı.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const names = new TextDecoder("utf-8");
    const entries = new Map<string, Entry>();
    for (let k = 0; k < count; k++) {
      if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) throw new FormatError("Arşiv bozuk: ZIP girdisi okunamadı.");
      const nameLength = dv.getUint16(p + 28, true);
      const extraLength = dv.getUint16(p + 30, true);
      const commentLength = dv.getUint16(p + 32, true);
      const name = names.decode(bytes.subarray(p + 46, p + 46 + nameLength));
      entries.set(name, {
        method: dv.getUint16(p + 10, true),
        compressedSize: dv.getUint32(p + 20, true),
        size: dv.getUint32(p + 24, true),
        offset: dv.getUint32(p + 42, true),
        encrypted: (dv.getUint16(p + 8, true) & 1) === 1,
      });
      p += 46 + nameLength + extraLength + commentLength;
    }
    return new ZipArchive(bytes, entries);
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  async read(name: string): Promise<Uint8Array> {
    const entry = this.entries.get(name);
    if (!entry) throw new FormatError(`Arşivde ${name} yok.`);
    if (entry.encrypted) throw new FormatError("Bu dosya şifreli; açılamaz.");
    const dv = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    const local = entry.offset;
    if (dv.getUint32(local, true) !== 0x04034b50) throw new FormatError("Arşiv bozuk: yerel başlık bulunamadı.");
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = this.bytes.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return data;
    if (entry.method === 8) return inflateRaw(data);
    throw new FormatError("Arşiv desteklenmeyen bir sıkıştırma yöntemi kullanıyor.");
  }

  async text(name: string): Promise<string> {
    return new TextDecoder("utf-8").decode(await this.read(name));
  }
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_ENTRY) {
      await reader.cancel();
      throw new FormatError("Arşivdeki bir dosya açılamayacak kadar büyük.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Resolves an href relative to a file inside the archive ("OEBPS/text/ch1.xhtml"). */
export function resolvePath(base: string, href: string): string {
  const clean = decodeURIComponent(href.split("#")[0] ?? "");
  const parts = clean.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const seg of clean.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}
