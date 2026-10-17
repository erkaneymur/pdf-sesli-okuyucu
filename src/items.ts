// Converts PDF.js text content into layout TextItems. Kept free of PDF.js runtime
// imports so Node tests can reuse it with the legacy build.

import type { TextItem } from "./model.js";

export interface PdfJsTextLike {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
}

/** `originX`/`originY` are the page's view box origin, so x/y become page-relative. */
export function toTextItems(raw: readonly object[], originX = 0, originY = 0): TextItem[] {
  const out: TextItem[] = [];
  for (const it of raw as readonly PdfJsTextLike[]) {
    if (typeof it.str !== "string" || !it.transform) continue;
    const [, , c = 0, d = 0, e = 0, f = 0] = it.transform;
    out.push({
      str: it.str,
      x: e - originX,
      y: f - originY,
      width: it.width ?? 0,
      fontSize: Math.hypot(c, d) || it.height || 10,
    });
  }
  return out;
}
