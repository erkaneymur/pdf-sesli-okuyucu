// Document -> Page -> Block -> Sentence data model for extracted PDF text.

export type Lang = "tr" | "en" | "und";

/** One positioned run of text in PDF user space (origin bottom-left). */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
}

export interface Line {
  text: string;
  x: number;
  y: number;
  right: number;
  fontSize: number;
}

export interface Sentence {
  text: string;
}

export interface Block {
  kind: "heading" | "paragraph";
  text: string;
  lang: Lang;
  sentences: Sentence[];
}

export interface Page {
  number: number;
  blocks: Block[];
}

export interface PdfDocumentModel {
  title: string;
  lang: Lang;
  pages: Page[];
}
