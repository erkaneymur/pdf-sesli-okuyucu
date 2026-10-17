// Copies the pinned PDF.js build into web/vendor so the page works without a CDN.
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = `${root}node_modules/pdfjs-dist/`;
const dest = `${root}web/vendor/pdfjs/`;

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(`${src}build/pdf.min.mjs`, `${dest}pdf.min.mjs`);
await cp(`${src}build/pdf.worker.min.mjs`, `${dest}pdf.worker.min.mjs`);
await cp(`${src}cmaps`, `${dest}cmaps`, { recursive: true });
await cp(`${src}standard_fonts`, `${dest}standard_fonts`, { recursive: true });
await cp(`${src}LICENSE`, `${dest}LICENSE`);
console.log("PDF.js copied to web/vendor/pdfjs");
