// MOBI / AZW3 / PalmDOC (PRC, PDB) reader: PalmDB records + PalmDOC decompression.
// HUFF/CDIC-compressed and DRM-protected books are reported, not worked around.

import { FormatError } from "./errors.js";

export interface MobiText {
  title: string;
  /** "html" for MOBI/KF8 markup, "text" for plain PalmDOC. */
  kind: "html" | "text";
  content: string;
}

export function isPalmBook(bytes: Uint8Array): boolean {
  const type = String.fromCharCode(...bytes.subarray(60, 68));
  return type === "BOOKMOBI" || type === "TEXtREAd";
}

/** PalmDOC LZ77 variant (compression type 2). */
export function palmDocDecompress(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.max(src.length * 8, 8192));
  let o = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i++] ?? 0;
    if (c >= 1 && c <= 8) {
      for (let k = 0; k < c && i < src.length; k++) out[o++] = src[i++] ?? 0;
    } else if (c <= 0x7f) {
      out[o++] = c;
    } else if (c >= 0xc0) {
      out[o++] = 0x20;
      out[o++] = c ^ 0x80;
    } else {
      const pair = ((c << 8) | (src[i++] ?? 0)) & 0x3fff;
      const distance = pair >> 3;
      const length = (pair & 7) + 3;
      if (distance === 0 || distance > o) throw new FormatError("MOBI verisi bozuk.");
      for (let k = 0; k < length; k++, o++) out[o] = out[o - distance] ?? 0;
    }
  }
  return out.subarray(0, o);
}

/** Size of the trailing entries MOBI appends to each text record (see extra data flags). */
function trailingSize(rec: Uint8Array, flags: number): number {
  const entrySize = (end: number): number => {
    let num = 0;
    for (let i = Math.max(0, end - 4); i < end; i++) {
      const v = rec[i] ?? 0;
      if (v & 0x80) num = 0;
      num = (num << 7) | (v & 0x7f);
    }
    return num;
  };
  let num = 0;
  for (let t = flags >> 1; t; t >>= 1) if (t & 1) num += entrySize(rec.length - num);
  if (flags & 1) num += ((rec[rec.length - num - 1] ?? 0) & 0x3) + 1;
  return num;
}

export function readPalmBook(bytes: Uint8Array): MobiText {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const recordCount = dv.getUint16(76, false);
  const offsets: number[] = [];
  for (let k = 0; k < recordCount; k++) offsets.push(dv.getUint32(78 + k * 8, false));
  const record = (k: number): Uint8Array => bytes.subarray(offsets[k] ?? 0, offsets[k + 1] ?? bytes.length);

  const r0 = record(0);
  const h = new DataView(r0.buffer, r0.byteOffset, r0.byteLength);
  const compression = h.getUint16(0, false);
  const textRecords = h.getUint16(8, false);
  const encryption = h.getUint16(12, false);
  if (encryption !== 0) throw new FormatError("Bu e-kitap DRM korumalı; açılamaz.");
  if (compression === 17480) throw new FormatError("Bu MOBI dosyası HUFF/CDIC sıkıştırması kullanıyor; henüz desteklenmiyor. EPUB'a dönüştürüp açın.");
  if (compression !== 1 && compression !== 2) throw new FormatError("Bu MOBI dosyasının sıkıştırması tanınmadı.");

  const isMobi = String.fromCharCode(...r0.subarray(16, 20)) === "MOBI";
  let encoding = "windows-1252";
  let extraFlags = 0;
  let title = new TextDecoder("latin1").decode(bytes.subarray(0, 32)).replace(/\0.*$/s, "").replace(/_/g, " ");
  if (isMobi) {
    const headerLength = h.getUint32(20, false);
    if (h.getUint32(28, false) === 65001) encoding = "utf-8";
    if (headerLength >= 0xe4 && r0.length >= 0xf4) extraFlags = h.getUint16(0xf2, false);
    const nameOffset = h.getUint32(0x54, false);
    const nameLength = h.getUint32(0x58, false);
    if (nameOffset > 0 && nameOffset + nameLength <= r0.length) {
      title = new TextDecoder(encoding).decode(r0.subarray(nameOffset, nameOffset + nameLength));
    }
  }

  const parts: Uint8Array[] = [];
  let total = 0;
  for (let k = 1; k <= textRecords && k < recordCount; k++) {
    let rec = record(k);
    if (extraFlags) rec = rec.subarray(0, rec.length - trailingSize(rec, extraFlags));
    const data = compression === 2 ? palmDocDecompress(rec) : rec;
    parts.push(data);
    total += data.length;
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return { title: title.trim(), kind: isMobi ? "html" : "text", content: new TextDecoder(encoding).decode(all) };
}
