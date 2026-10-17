// PDF.js bridge. "pdfjs-dist" resolves to web/vendor via the import map in index.html.

import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { toTextItems } from "./items.js";
import type { TextItem } from "./model.js";

const vendor = new URL("../vendor/pdfjs/", import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = `${vendor}pdf.worker.min.mjs`;

/** Resolves to the password, or null when the user cancels. */
export type AskPassword = (wrongPassword: boolean) => Promise<string | null>;

export class PasswordCancelled extends Error {
  constructor() {
    super("password cancelled");
    this.name = "PasswordCancelled";
  }
}

export function openPdf(data: Uint8Array, askPassword: AskPassword): Promise<PDFDocumentProxy> {
  const task = pdfjsLib.getDocument({
    data,
    cMapUrl: `${vendor}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${vendor}standard_fonts/`,
    isEvalSupported: false,
    enableXfa: false,
  });
  let cancelled = false;
  task.onPassword = (update: (password: string) => void, reason: number): void => {
    void askPassword(reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD).then((password) => {
      if (password === null) {
        cancelled = true;
        void task.destroy();
      } else {
        update(password);
      }
    });
  };
  return task.promise.catch((error: unknown) => {
    throw cancelled ? new PasswordCancelled() : error;
  });
}

export async function readPageItems(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<{ items: TextItem[]; width: number; height: number; aspect: number }> {
  const page = await doc.getPage(pageNumber);
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
  const shown = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  page.cleanup();
  return {
    items: toTextItems(content.items, x0, y0),
    width: x1 - x0,
    height: y1 - y0,
    aspect: shown.width / shown.height,
  };
}

export interface RenderJob {
  promise: Promise<void>;
  cancel: () => void;
}

/** Draws one page into `canvas`, sized for `cssWidth` CSS pixels (device pixel ratio capped at 2). */
export function renderPageImage(doc: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement, cssWidth: number): RenderJob {
  let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | null = null;
  let cancelled = false;
  const promise = doc.getPage(pageNumber).then(async (page) => {
    if (cancelled) return;
    const base = page.getViewport({ scale: 1 });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas 2d context unavailable");
    task = page.render({ canvasContext: context, viewport });
    try {
      await task.promise;
    } catch (error) {
      if (!(error instanceof Error && error.name === "RenderingCancelledException")) throw error;
    }
  });
  return {
    promise,
    cancel: () => {
      cancelled = true;
      task?.cancel();
    },
  };
}

/** Turkish, user-facing message for a load failure. */
export function describeError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "PasswordCancelled":
      return "Parola girilmedi; belge açılmadı.";
    case "InvalidPDFException":
      return "Bu dosya geçerli bir PDF değil ya da bozuk.";
    case "MissingPDFException":
      return "PDF bulunamadı.";
    case "UnexpectedResponseException":
      return "Sunucu PDF yerine beklenmeyen bir yanıt döndürdü.";
    default:
      return `PDF açılamadı: ${error instanceof Error ? error.message : String(error)}`;
  }
}
