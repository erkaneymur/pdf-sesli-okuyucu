// Small RTF reader: keeps body text, drops formatting and non-text destinations
// (font/colour tables, pictures, headers, field instructions, metadata).

import { makeBlock } from "../layout.js";
import type { Block } from "../model.js";

const SKIP_DESTINATIONS = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "headerl", "headerr", "headerf", "footer",
  "footerl", "footerr", "footerf", "fldinst", "themedata", "colorschememapping", "latentstyles", "datastore",
  "xmlnstbl", "listtable", "listoverridetable", "rsidtbl", "generator", "mmathpr", "pgdsctbl", "nonshppict",
  "filetbl", "revtbl", "bkmkstart", "bkmkend", "xmlopen", "footnote", "annotation", "atnid", "atnauthor",
]);

const SYMBOLS: Record<string, string> = {
  emdash: "—", endash: "–", bullet: "•", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”", tab: " ",
  line: " ", emspace: " ", enspace: " ", qmspace: " ",
};

function codepageName(cp: number): string {
  if (cp === 65001) return "utf-8";
  if ([874, 1250, 1251, 1252, 1253, 1254, 1255, 1256, 1257, 1258].includes(cp)) return `windows-${cp}`;
  return { 932: "shift_jis", 936: "gbk", 949: "euc-kr", 950: "big5" }[cp] ?? "windows-1252";
}

interface State {
  skip: boolean;
  uc: number;
}

export function rtfToText(bytes: Uint8Array): string {
  // RTF is 7-bit ASCII with escapes; read it byte for byte.
  let src = "";
  for (let i = 0; i < bytes.length; i += 0x8000) src += String.fromCharCode(...bytes.subarray(i, i + 0x8000));

  let codepage = 1252;
  const stack: State[] = [];
  let state: State = { skip: false, uc: 1 };
  let out = "";
  let pending: number[] = [];
  let fallbackSkip = 0;

  const flushBytes = (): void => {
    if (pending.length === 0) return;
    try {
      out += new TextDecoder(codepageName(codepage)).decode(new Uint8Array(pending));
    } catch {
      out += new TextDecoder("windows-1252").decode(new Uint8Array(pending));
    }
    pending = [];
  };
  const emit = (s: string): void => {
    if (state.skip) return;
    if (fallbackSkip > 0) {
      fallbackSkip--;
      return;
    }
    flushBytes();
    out += s;
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i++];
    if (c === "{") {
      stack.push(state);
      state = { ...state };
      continue;
    }
    if (c === "}") {
      flushBytes();
      state = stack.pop() ?? { skip: false, uc: 1 };
      fallbackSkip = 0;
      continue;
    }
    if (c === "\r" || c === "\n") continue;
    if (c !== "\\") {
      emit(c ?? "");
      continue;
    }
    const next = src[i] ?? "";
    if (/[a-zA-Z]/.test(next)) {
      const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i, i + 40));
      if (!m) continue;
      i += m[0].length;
      const word = (m[1] ?? "").toLowerCase();
      const param = m[2] === undefined ? null : Number(m[2]);
      if (word === "bin" && param !== null) {
        i += param;
      } else if (word === "ansicpg" && param !== null) {
        codepage = param;
      } else if (word === "uc" && param !== null) {
        state.uc = param;
      } else if (word === "u" && param !== null) {
        if (!state.skip) {
          flushBytes();
          out += String.fromCharCode(param < 0 ? param + 65536 : param);
          fallbackSkip = state.uc;
        }
      } else if (word === "par" || word === "sect" || word === "page" || word === "row") {
        if (!state.skip) {
          flushBytes();
          out += "\n";
        }
      } else if (word === "cell") {
        emit(" ");
      } else if (SKIP_DESTINATIONS.has(word)) {
        state.skip = true;
      } else if (SYMBOLS[word] !== undefined) {
        emit(SYMBOLS[word] ?? "");
      }
      continue;
    }
    i++;
    if (next === "'") {
      const byte = parseInt(src.slice(i, i + 2), 16);
      i += 2;
      if (state.skip || Number.isNaN(byte)) continue;
      if (fallbackSkip > 0) {
        fallbackSkip--;
        continue;
      }
      pending.push(byte);
    } else if (next === "*") {
      state.skip = true;
    } else if (next === "~") {
      emit(" ");
    } else if (next === "_") {
      emit("-");
    } else if (next === "-") {
      // optional hyphen
    } else if (next === "\n" || next === "\r") {
      if (!state.skip) out += "\n";
    } else {
      emit(next);
    }
  }
  flushBytes();
  return out;
}

export function rtfToBlocks(bytes: Uint8Array): Block[] {
  return rtfToText(bytes)
    .split("\n")
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((p) => makeBlock("paragraph", p));
}
