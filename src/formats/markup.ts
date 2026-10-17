// Walks a parsed HTML/XML tree and emits heading/paragraph blocks. Only text is
// read (never re-inserted as markup), and DOMParser documents never run scripts
// or load resources, so untrusted e-book markup is safe to process here.

import { makeBlock } from "../layout.js";
import type { Block } from "../model.js";

export interface Profile {
  /** Elements that start/end a paragraph. */
  blocks: ReadonlySet<string>;
  /** Elements whose whole text becomes one heading block. */
  headings: ReadonlySet<string>;
  /** Elements skipped with all their content. */
  skip: ReadonlySet<string>;
  /** Empty elements that stand for a space (br, tab, …). */
  spaces: ReadonlySet<string>;
  /** Extra heading test (e.g. DOCX paragraph styles). */
  isHeading?: (el: Element) => boolean;
}

const set = (s: string): ReadonlySet<string> => new Set(s.split(" "));

export const HTML: Profile = {
  blocks: set(
    "p div li blockquote pre dd dt td th caption figcaption section article aside header footer main body tr table ul ol dl figure address center hr pagebreak",
  ),
  headings: set("h1 h2 h3 h4 h5 h6"),
  skip: set("script style head noscript svg math template nav button select rt rp iframe object title"),
  spaces: set("br wbr"),
};

export const FB2: Profile = {
  blocks: set("p v section epigraph poem stanza cite text-author annotation empty-line body"),
  headings: set("title subtitle"),
  skip: set("binary description stylesheet"),
  spaces: set(""),
};

export const ODT: Profile = {
  blocks: set("p list-item table-cell"),
  headings: set("h"),
  skip: set("note annotation tracked-changes bookmark-ref"),
  spaces: set("s tab line-break"),
};

export const DOCX: Profile = {
  blocks: set("p tc"),
  headings: set(""),
  skip: set("instrtext deltext rpr ppr sectpr"),
  spaces: set("tab br cr"),
  isHeading: (el) => {
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType !== 1 || tag(child as Element) !== "ppr") continue;
      for (const prop of Array.from(child.childNodes)) {
        if (prop.nodeType === 1 && tag(prop as Element) === "pstyle") {
          const val = attr(prop as Element, "val");
          return /^(heading|başlık|baslik|title)/i.test(val);
        }
        if (prop.nodeType === 1 && tag(prop as Element) === "outlinelvl") return true;
      }
    }
    return false;
  },
};

/** Lower-case local name without namespace prefix ("w:p" → "p"). */
export function tag(el: Element): string {
  return (el.localName || el.tagName).toLowerCase().replace(/^.*:/, "");
}

/** Attribute by local name, ignoring any prefix ("w:val" → "val"). */
export function attr(el: Element, local: string): string {
  for (const a of Array.from(el.attributes)) {
    if (a.name.toLowerCase().replace(/^.*:/, "") === local) return a.value;
  }
  return "";
}

/** All descendants (document order) with the given local name. */
export function findAll(root: Element | Document, local: string): Element[] {
  const out: Element[] = [];
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1) continue;
      if (tag(child as Element) === local) out.push(child as Element);
      walk(child);
    }
  };
  walk(root);
  return out;
}

function textOf(el: Element, profile: Profile): string {
  let s = "";
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) s += child.nodeValue ?? "";
      else if (child.nodeType === 1) {
        const t = tag(child as Element);
        if (profile.skip.has(t)) continue;
        if (profile.spaces.has(t) || profile.blocks.has(t)) s += " ";
        walk(child);
      }
    }
  };
  walk(el);
  return s;
}

export function domToBlocks(root: Element, profile: Profile): Block[] {
  const out: Block[] = [];
  let buffer = "";
  const flush = (): void => {
    const text = buffer.replace(/\s+/g, " ").trim();
    if (text) out.push(makeBlock("paragraph", text));
    buffer = "";
  };
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        buffer += child.nodeValue ?? "";
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      const t = tag(el);
      if (profile.skip.has(t)) continue;
      if (profile.spaces.has(t)) {
        buffer += " ";
      } else if (profile.headings.has(t) || (profile.isHeading?.(el) ?? false)) {
        flush();
        const text = textOf(el, profile).replace(/\s+/g, " ").trim();
        if (text) out.push(makeBlock("heading", text));
      } else if (profile.blocks.has(t)) {
        flush();
        walk(el);
        flush();
      } else {
        walk(el);
      }
    }
  };
  walk(root);
  flush();
  return out;
}

/** Parses XML, falling back to the forgiving HTML parser on malformed input. */
export function parseXml(source: string, type: DOMParserSupportedType = "application/xml"): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(source, type);
  if (findAll(doc, "parsererror").length > 0) return parser.parseFromString(source, "text/html");
  return doc;
}

export function htmlToBlocks(source: string): { title: string; blocks: Block[] } {
  const doc = new DOMParser().parseFromString(source, "text/html");
  const title = findAll(doc, "title")[0]?.textContent?.trim() ?? "";
  const body = findAll(doc, "body")[0] ?? doc.documentElement;
  return { title, blocks: body ? domToBlocks(body, HTML) : [] };
}
