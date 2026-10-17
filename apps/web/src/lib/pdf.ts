// The "legacy" build of pdf.js includes polyfills for newer JS features
// (e.g. Map.prototype.getOrInsertComputed) that Android WebViews and older browsers lack.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs, workerUrl };
export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
