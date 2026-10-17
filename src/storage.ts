// Per-device conveniences in localStorage. Every access is guarded: storage can be
// unavailable (private mode, blocked site data) and the reader must still work.

const PREFIX = "pdfoku:";

export interface Prefs {
  showPageNumbers: boolean;
  view: "pdf" | "text";
}

const DEFAULT_PREFS: Prefs = { showPageNumbers: true, view: "pdf" };

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Not persisted; nothing else to do.
  }
}

export function loadLastPage(docId: string): number | null {
  const value = read(`doc:${docId}`);
  if (value && typeof value === "object" && "page" in value && typeof value.page === "number") return value.page;
  return null;
}

export function saveLastPage(docId: string, page: number): void {
  write(`doc:${docId}`, { page, at: Date.now() });
}

export function loadPrefs(): Prefs {
  const prefs = { ...DEFAULT_PREFS };
  const value = read("prefs");
  if (value && typeof value === "object") {
    if ("showPageNumbers" in value && typeof value.showPageNumbers === "boolean") prefs.showPageNumbers = value.showPageNumbers;
    if ("view" in value && (value.view === "pdf" || value.view === "text")) prefs.view = value.view;
  }
  return prefs;
}

export function savePrefs(prefs: Prefs): void {
  write("prefs", prefs);
}
