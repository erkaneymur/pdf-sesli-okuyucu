// Builders for real container structures (ZIP, PalmDB/MOBI) used by tests.
import { deflateRawSync } from "node:zlib";

const enc = new TextEncoder();

/** Builds a ZIP with deflated entries (stored for "mimetype", as EPUB requires). */
export function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === "string" ? enc.encode(content) : content;
    const stored = name === "mimetype";
    const data = stored ? raw : deflateRawSync(raw);
    const n = enc.encode(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

/** PalmDB with a MOBI header; text records are given already compressed. */
export function mobi({ title, compression, records, encoding = 65001, extraFlags = 0 }) {
  const r0 = Buffer.alloc(0x100 + 64);
  r0.writeUInt16BE(compression, 0);
  r0.writeUInt16BE(records.length, 8);
  r0.write("MOBI", 16, "latin1");
  r0.writeUInt32BE(0xe8, 20);
  r0.writeUInt32BE(encoding, 28);
  const name = Buffer.from(title, "utf8");
  r0.writeUInt32BE(0x100, 0x54);
  r0.writeUInt32BE(name.length, 0x58);
  r0.writeUInt16BE(extraFlags, 0xf2);
  name.copy(r0, 0x100);
  const all = [r0, ...records.map((r) => Buffer.from(r))];
  const header = Buffer.alloc(78 + all.length * 8 + 2);
  header.write("test_book", 0, "latin1");
  header.write("BOOKMOBI", 60, "latin1");
  header.writeUInt16BE(all.length, 76);
  let at = header.length;
  all.forEach((rec, k) => {
    header.writeUInt32BE(at, 78 + k * 8);
    at += rec.length;
  });
  return new Uint8Array(Buffer.concat([header, ...all]));
}
