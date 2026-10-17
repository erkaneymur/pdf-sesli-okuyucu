// UI wiring: pick/open a PDF, extract text page by page, render a clean article
// that Edge's built-in "Sesli oku" (Read aloud) can voice with Microsoft voices.

import { RunningHeaderFilter, buildPage, detectLanguage } from "./layout.js";
import type { Block, Lang } from "./model.js";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PasswordCancelled, describeError, openPdf, readPageItems, renderPageImage } from "./pdf.js";
import type { RenderJob } from "./pdf.js";
import { loadLastPage, loadPrefs, saveLastPage, savePrefs } from "./storage.js";

const MAX_BYTES = 300 * 1024 * 1024;

// Offline support; service workers need HTTPS (or localhost), so plain LAN http just skips it.
if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("sw.js").catch(() => undefined);
}

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
}

const fileInput = $<HTMLInputElement>("file");
const urlForm = $<HTMLFormElement>("url-form");
const urlInput = $<HTMLInputElement>("url");
const passwordForm = $<HTMLFormElement>("password-form");
const passwordInput = $<HTMLInputElement>("password");
const passwordCancel = $<HTMLButtonElement>("password-cancel");
const statusEl = $<HTMLParagraphElement>("status");
const progress = $<HTMLProgressElement>("progress");
const toolbar = $<HTMLDivElement>("toolbar");
const resumeButton = $<HTMLButtonElement>("resume");
const showAllButton = $<HTMLButtonElement>("show-all");
const gotoForm = $<HTMLFormElement>("goto-form");
const gotoInput = $<HTMLInputElement>("goto");
const pageNumbers = $<HTMLInputElement>("page-numbers");
const help = $<HTMLDetailsElement>("help");
const article = $<HTMLElement>("doc");
const viewToggle = $<HTMLButtonElement>("view-toggle");

let current: AbortController | null = null;
let docId = "";
let pageObserver: IntersectionObserver | null = null;
/** Kept open while shown so page images can be drawn lazily. */
let activeDoc: PDFDocumentProxy | null = null;
const renderJobs = new Map<HTMLCanvasElement, RenderJob>();

function setStatus(text: string, tone: "info" | "error" = "info"): void {
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

const prefs = loadPrefs();
pageNumbers.checked = prefs.showPageNumbers;
article.classList.toggle("hide-page-numbers", !prefs.showPageNumbers);
pageNumbers.addEventListener("change", () => {
  prefs.showPageNumbers = pageNumbers.checked;
  article.classList.toggle("hide-page-numbers", !prefs.showPageNumbers);
  savePrefs(prefs);
});

function applyView(): void {
  const pdf = prefs.view === "pdf";
  article.classList.toggle("view-pdf", pdf);
  article.classList.toggle("view-text", !pdf);
  viewToggle.textContent = pdf ? "Metin görünümü" : "PDF görünümü";
  if (!pdf) for (const canvas of [...renderJobs.keys()]) freeCanvas(canvas);
  else for (const canvas of article.querySelectorAll("canvas")) sheetObserver.unobserve(canvas), sheetObserver.observe(canvas);
}

function freeCanvas(canvas: HTMLCanvasElement): void {
  renderJobs.get(canvas)?.cancel();
  renderJobs.delete(canvas);
  canvas.width = 0;
  canvas.height = 0;
}

// Draws page images only near the viewport and frees them when far away, so
// long PDFs stay within mobile memory.
const sheetObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const canvas = entry.target as HTMLCanvasElement;
      if (!entry.isIntersecting) {
        if (renderJobs.has(canvas)) freeCanvas(canvas);
        continue;
      }
      if (prefs.view !== "pdf" || !activeDoc || renderJobs.has(canvas)) continue;
      const job = renderPageImage(activeDoc, Number(canvas.dataset.page), canvas, canvas.clientWidth);
      renderJobs.set(canvas, job);
      job.promise.catch(() => {
        renderJobs.delete(canvas);
      });
    }
  },
  { rootMargin: "1200px 0px" },
);

viewToggle.addEventListener("click", () => {
  prefs.view = prefs.view === "pdf" ? "text" : "pdf";
  savePrefs(prefs);
  applyView();
});
applyView();

function askPassword(wrong: boolean): Promise<string | null> {
  passwordForm.hidden = false;
  passwordInput.value = "";
  passwordInput.setAttribute("aria-invalid", String(wrong));
  setStatus(wrong ? "Parola yanlış. Tekrar deneyin." : "Bu PDF parola korumalı.", wrong ? "error" : "info");
  passwordInput.focus();
  return new Promise((resolve) => {
    const done = (value: string | null): void => {
      passwordForm.hidden = true;
      passwordForm.removeEventListener("submit", onSubmit);
      passwordCancel.removeEventListener("click", onCancel);
      resolve(value);
    };
    const onSubmit = (e: SubmitEvent): void => {
      e.preventDefault();
      done(passwordInput.value);
    };
    const onCancel = (): void => done(null);
    passwordForm.addEventListener("submit", onSubmit);
    passwordCancel.addEventListener("click", onCancel);
  });
}

function renderPage(number: number, blocks: readonly Block[], docLang: Lang, aspect: number): HTMLElement {
  const section = document.createElement("section");
  section.className = "page";
  section.id = `sayfa-${number}`;
  section.dataset.page = String(number);
  const mark = document.createElement("h2");
  mark.className = "page-mark";
  mark.textContent = `Sayfa ${number}`;
  // PDF view: the page image, with the reading-order text laid over it
  // transparently so Read aloud still has real text to voice.
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.style.setProperty("--aspect", String(aspect));
  const canvas = document.createElement("canvas");
  canvas.dataset.page = String(number);
  canvas.setAttribute("aria-hidden", "true");
  const text = document.createElement("div");
  text.className = "page-text";
  if (blocks.length === 0) {
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = "Bu sayfada okunabilir metin yok; taranmış bir görüntü olabilir.";
    text.append(note);
  }
  for (const block of blocks) {
    const el = document.createElement(block.kind === "heading" ? "h3" : "p");
    el.textContent = block.text;
    if (block.lang !== "und" && block.lang !== docLang) el.lang = block.lang;
    text.append(el);
  }
  sheet.append(canvas, text);
  section.append(sheet);
  sheetObserver.observe(canvas);
  return section;
}

function pageSections(): HTMLElement[] {
  return [...article.querySelectorAll<HTMLElement>("section.page")];
}

/** Hides pages before `from`, so Edge's Read aloud starts at that page. */
function startFrom(from: number): void {
  const target = document.getElementById(`sayfa-${from}`);
  if (!target) {
    setStatus(`Sayfa ${from} henüz hazır değil.`, "error");
    return;
  }
  for (const s of pageSections()) s.hidden = Number(s.dataset.page) < from;
  showAllButton.hidden = from <= 1;
  target.scrollIntoView({ block: "start" });
  setStatus(`Sayfa ${from} ve sonrası gösteriliyor. Sesli oku bu sayfadan başlar.`);
}

function trackReadingPosition(): void {
  pageObserver?.disconnect();
  let saveTimer = 0;
  pageObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.page));
      if (visible.length === 0 || !docId) return;
      const page = Math.min(...visible);
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => saveLastPage(docId, page), 500);
    },
    { rootMargin: "0px 0px -60% 0px" },
  );
}

async function loadDocument(data: Uint8Array, name: string): Promise<void> {
  current?.abort();
  const controller = new AbortController();
  current = controller;
  const { signal } = controller;

  for (const canvas of [...renderJobs.keys()]) freeCanvas(canvas);
  sheetObserver.disconnect();
  void activeDoc?.destroy();
  activeDoc = null;
  article.replaceChildren();
  toolbar.hidden = true;
  resumeButton.hidden = true;
  showAllButton.hidden = true;
  setStatus("PDF açılıyor…");

  let doc;
  try {
    doc = await openPdf(data, askPassword);
  } catch (error) {
    if (!signal.aborted) setStatus(describeError(error), error instanceof PasswordCancelled ? "info" : "error");
    return;
  }
  if (signal.aborted) {
    void doc.destroy();
    return;
  }

  activeDoc = doc;
  docId = doc.fingerprints[0] ?? name;
  const meta = await doc.getMetadata().catch(() => null);
  const info = meta?.info as { Title?: unknown } | undefined;
  const title = typeof info?.Title === "string" && info.Title.trim() ? info.Title.trim() : name.replace(/\.pdf$/i, "");
  const heading = document.createElement("h1");
  heading.className = "doc-title";
  heading.textContent = title;
  article.append(heading);
  document.title = `${title} · PDF Sesli Okuyucu`;

  const total = doc.numPages;
  progress.max = total;
  progress.value = 0;
  progress.hidden = false;
  gotoInput.max = String(total);
  toolbar.hidden = false;
  help.open = false;
  trackReadingPosition();

  const lastPage = loadLastPage(docId);
  const filter = new RunningHeaderFilter();
  let docLang: Lang | null = null;
  let emptyPages = 0;

  try {
    for (let n = 1; n <= total; n++) {
      if (signal.aborted) return;
      const { items, width, height, aspect } = await readPageItems(doc, n);
      const blocks = buildPage(items, width, height, filter);
      if (blocks.length === 0) emptyPages++;
      if (docLang === null) {
        const sample = blocks.map((b) => b.text).join(" ");
        const lang = detectLanguage(sample);
        if (lang !== "und" || n >= 3) {
          docLang = lang === "und" ? "tr" : lang;
          article.lang = docLang;
        }
      }
      const section = renderPage(n, blocks, docLang ?? "tr", aspect);
      article.append(section);
      pageObserver?.observe(section);
      if (lastPage && n === lastPage && lastPage > 1) {
        resumeButton.textContent = `Devam et: sayfa ${lastPage}`;
        resumeButton.hidden = false;
      }
      progress.value = n;
      setStatus(`${n} / ${total} sayfa hazırlandı…`);
      if (n % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  } catch (error) {
    if (!signal.aborted) setStatus(describeError(error), "error");
    return;
  } finally {
    if (current === controller) progress.hidden = true;
  }

  if (emptyPages === total) {
    setStatus("Bu PDF'te metin yok; taranmış görüntülerden oluşuyor olabilir. Metin tanıma (OCR) henüz desteklenmiyor.", "error");
  } else if (emptyPages > 0) {
    setStatus(`Hazır: ${total} sayfa. ${emptyPages} sayfada metin bulunamadı. Edge menüsü → Sesli oku.`);
  } else {
    setStatus(`Hazır: ${total} sayfa. Edge menüsü → Sesli oku.`);
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  if (file.size > MAX_BYTES) {
    setStatus("Dosya çok büyük (300 MB üstü).", "error");
    return;
  }
  void file.arrayBuffer().then(
    (buf) => loadDocument(new Uint8Array(buf), file.name),
    () => setStatus("Dosya okunamadı. Erişim izni verildiğinden emin olun.", "error"),
  );
});

urlForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const raw = urlInput.value.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    setStatus("Geçerli bir bağlantı girin (https://… ile başlayan).", "error");
    return;
  }
  if (url.protocol !== "https:") {
    setStatus("Yalnızca https:// bağlantıları açılabilir.", "error");
    return;
  }
  setStatus("PDF indiriliyor…");
  void fetch(url, { credentials: "omit" })
    .then(async (res) => {
      if (!res.ok) throw new Error(`Sunucu ${res.status} döndürdü.`);
      const length = Number(res.headers.get("content-length") ?? 0);
      if (length > MAX_BYTES) throw new Error("Dosya çok büyük (300 MB üstü).");
      const name = decodeURIComponent(url.pathname.split("/").pop() || "belge.pdf");
      await loadDocument(new Uint8Array(await res.arrayBuffer()), name);
    })
    .catch((error: unknown) => {
      const message =
        error instanceof TypeError
          ? "Bağlantı açılamadı. Sunucu, PDF'in başka sitelerden okunmasına izin vermiyor olabilir (CORS). PDF'i indirip “PDF seç” ile açın."
          : error instanceof Error
            ? error.message
            : String(error);
      setStatus(message, "error");
    });
});

resumeButton.addEventListener("click", () => {
  const page = loadLastPage(docId);
  if (page) startFrom(page);
});

showAllButton.addEventListener("click", () => {
  for (const s of pageSections()) s.hidden = false;
  showAllButton.hidden = true;
  setStatus("Tüm sayfalar gösteriliyor.");
});

gotoForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const page = Number(gotoInput.value);
  if (!Number.isInteger(page) || page < 1) {
    setStatus("Geçerli bir sayfa numarası girin.", "error");
    return;
  }
  startFrom(page);
});
