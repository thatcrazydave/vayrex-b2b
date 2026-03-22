/**
 * pdfPageRenderer.js
 * -----------------------------------------------------------------
 * Renders individual PDF pages to PNG image buffers using:
 *   • pdfjs-dist (legacy Node.js build)  — parses the PDF
 *   • canvas                             — provides the 2-D drawing surface
 *
 * Used by pdfParser to extract image-dominant pages that pdf-parse
 * cannot read as text, handing them off to imageOcrService for OCR.
 * -----------------------------------------------------------------
 */

'use strict';

const { createCanvas } = require('canvas');
const Logger = require('../logger');

// pdfjs-dist is ESM-only in v4+. Use a cached dynamic import so the rest of
// the codebase stays CommonJS.
let _pdfjsLib = null;
async function getPdfjsLib() {
  if (!_pdfjsLib) {
    _pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // Disable the worker thread — not needed (and not available) in Node
    _pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  }
  return _pdfjsLib;
}

// ─── Config ──────────────────────────────────────────────────────────────────

const RENDER_SCALE = parseFloat(process.env.PDF_RENDER_SCALE) || 2.0;
// 2× gives ~144 DPI from a 72-DPI PDF viewport — enough for Tesseract.
// Set PDF_RENDER_SCALE=3 in .env for higher accuracy on blurry scans.

const MAX_PAGES = parseInt(process.env.PDF_OCR_MAX_PAGES) || 100;
// Safety cap — prevents OOM on very large PDFs.

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Determine whether a page is likely image-dominant (i.e. has very little
 * programmatic text but contains at least one image operator in the stream).
 *
 * We call this "lightweight" heuristic rather than fully parsing the page's
 * content stream — it avoids double-rendering text pages.
 *
 * @param {Object} pdfPage    - pdfjs PDFPageProxy
 * @param {string} pageText   - Text already extracted by pdf-parse for this page
 * @returns {Promise<boolean>}
 */
async function isImageDominant(pageText) {
  // If the page has substantial text (> 100 chars) it's fine — skip OCR
  return !pageText || pageText.trim().length < 100;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Render a single PDF page to a PNG buffer.
 *
 * @param {Object} pdfDoc      - pdfjs PDFDocumentProxy
 * @param {number} pageNum     - 1-based page number
 * @param {number} [scale]     - Render scale multiplier (default: RENDER_SCALE)
 * @returns {Promise<Buffer>}  - PNG image buffer
 */
async function renderPageToPng(pdfDoc, pageNum, scale = RENDER_SCALE) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvasEl = createCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height)
  );
  const ctx = canvasEl.getContext('2d');

  await page.render({
    canvasContext: ctx,
    viewport,
    // NodeCanvasFactory is built into pdfjs-dist legacy build
  }).promise;

  page.cleanup();

  return canvasEl.toBuffer('image/png');
}

/**
 * Open a PDF buffer and render the pages whose text is image-dominant to PNG.
 *
 * @param {Buffer}   pdfBuffer       - Raw PDF bytes
 * @param {string[]} perPageTexts    - Array of text strings for each page
 *                                    (index 0 = page 1).  Produced by pdf-parse.
 * @returns {Promise<Array<{ pageNum: number, pngBuffer: Buffer }>>}
 *          Only the pages that need OCR are returned.
 */
async function getImageDominantPages(pdfBuffer, perPageTexts) {
  const pdfjsLib = await getPdfjsLib();

  // pdfjs-dist in Node expects a typed array or object with data property
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
  const pdfDoc = await loadingTask.promise;

  const totalPages = Math.min(pdfDoc.numPages, MAX_PAGES);
  const imageDominantPages = [];

  Logger.info('pdfPageRenderer: scanning pages', { totalPages });

  for (let p = 1; p <= totalPages; p++) {
    const pageText = perPageTexts[p - 1] || '';
    if (await isImageDominant(pageText)) {
      try {
        const pngBuffer = await renderPageToPng(pdfDoc, p);
        imageDominantPages.push({ pageNum: p, pngBuffer });
        Logger.info('pdfPageRenderer: rendered image-dominant page', { pageNum: p });
      } catch (err) {
        Logger.warn('pdfPageRenderer: failed to render page', {
          pageNum: p,
          error: err.message,
        });
      }
    }
  }

  await pdfDoc.destroy();

  Logger.info('pdfPageRenderer: done', {
    totalPages,
    imageDominantCount: imageDominantPages.length,
  });

  return imageDominantPages;
}

/**
 * Render every page of a PDF to PNG (used when pdf-parse returns near-zero
 * text for the whole document — i.e. a fully-scanned PDF).
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<Array<{ pageNum: number, pngBuffer: Buffer }>>}
 */
async function renderAllPages(pdfBuffer) {
  const pdfjsLib = await getPdfjsLib();

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
  const pdfDoc = await loadingTask.promise;

  const totalPages = Math.min(pdfDoc.numPages, MAX_PAGES);
  const pages = [];

  Logger.info('pdfPageRenderer: rendering all pages for full-image PDF', { totalPages });

  for (let p = 1; p <= totalPages; p++) {
    try {
      const pngBuffer = await renderPageToPng(pdfDoc, p);
      pages.push({ pageNum: p, pngBuffer });
    } catch (err) {
      Logger.warn('pdfPageRenderer: failed to render page', {
        pageNum: p,
        error: err.message,
      });
    }
  }

  await pdfDoc.destroy();
  return pages;
}

/**
 * Render PDF pages that contain image operators to PNG for embedding in
 * exported PDFs.  Text-only pages are skipped.
 *
 * Uses pdfjs-dist's page.getOperatorList() to detect pages that actually
 * contain image paint operators (OPS.paintImageXObject etc.) — so we only
 * render the pages that have real visual content, not blank/text-only pages.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<Array<{ pageNum: number, pngBuffer: Buffer }>>}
 */
async function renderPagesForEmbedding(pdfBuffer) {
  const pdfjsLib = await getPdfjsLib();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
  const pdfDoc = await loadingTask.promise;
  const totalPages = Math.min(pdfDoc.numPages, MAX_PAGES);
  const results = [];

  // pdfjs OPS codes for image drawing
  const IMAGE_OPS = new Set([
    pdfjsLib.OPS?.paintImageXObject,
    pdfjsLib.OPS?.paintImageXObjectRepeat,
    pdfjsLib.OPS?.paintInlineImageXObject,
    pdfjsLib.OPS?.paintInlineImageXObjectGroup,
  ].filter(Boolean));

  for (let p = 1; p <= totalPages; p++) {
    try {
      const page = await pdfDoc.getPage(p);
      const ops = await page.getOperatorList();

      // Check if this page paints any image
      const hasImage = ops.fnArray.some(fn => IMAGE_OPS.has(fn));
      page.cleanup();

      if (!hasImage) continue;

      const pngBuffer = await renderPageToPng(pdfDoc, p);
      results.push({ pageNum: p, pngBuffer });
    } catch (err) {
      Logger.warn('renderPagesForEmbedding: failed page', { pageNum: p, error: err.message });
    }
  }

  await pdfDoc.destroy();
  Logger.info('renderPagesForEmbedding: complete', {
    totalPages, pagesWithImages: results.length
  });
  return results;
}

module.exports = {
  getImageDominantPages,
  renderAllPages,
  renderPageToPng,
  renderPagesForEmbedding,
};
