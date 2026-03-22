/**
 * imageOcrService.js
 * -----------------------------------------------------------------
 * Local OCR pipeline:  sharp (preprocessing)  →  Tesseract.js (recognition)
 *
 * Handles:
 *   • Standalone image files (.jpg, .jpeg, .png, .webp, .gif)
 *   • Image buffers extracted from PDF pages
 *   • Image buffers extracted from DOCX drawings
 *
 * No external API calls — fully local, zero cost.
 * -----------------------------------------------------------------
 */

'use strict';

const sharp    = require('sharp');
const { createWorker } = require('tesseract.js');
const Logger   = require('../logger');

// ─── Config ──────────────────────────────────────────────────────────────────

const OCR_CONFIG = {
  // Tesseract language(s).  'eng' covers the vast majority of academic content.
  // Add '+fra', '+deu', etc. here if multilingual support is needed later.
  language: process.env.TESSERACT_LANG || 'eng',

  // How many Tesseract workers to spin up concurrently (per process invocation)
  workerPoolSize: parseInt(process.env.TESSERACT_WORKERS) || 1,

  // Minimum text the OCR must return for a page to be considered "has content".
  minTextLength: 30,

  // Target DPI for sharp upscale — 300 DPI is the standard for good Tesseract accuracy.
  targetDpi: parseInt(process.env.OCR_TARGET_DPI) || 300,

  // Max dimension (px) to resize to before OCR so we don't blow memory on giant images.
  maxDimension: parseInt(process.env.OCR_MAX_DIM) || 3508, // ≈ A4 @ 300 DPI

  // Log timing info
  logMetrics: process.env.OCR_LOG_METRICS !== 'false',
};

// ─── Sharp preprocessing ─────────────────────────────────────────────────────

/**
 * Preprocess an image buffer with sharp to improve Tesseract accuracy.
 *
 * Pipeline (standard — binarize = false):
 *   1. Greyscale  →  2. Normalize  →  3. Upscale  →  4. Cap  →
 *   5. Median(3)  →  6. Sharpen(1.5)  →  PNG
 *
 * Pipeline (document — binarize = true):
 *   Same as above, then  →  7. Threshold(140)  →  PNG
 *   Produces clean black-on-white suitable for photographed pages, scans, etc.
 *
 * @param {Buffer}  inputBuffer  - Raw image bytes (any format sharp supports)
 * @param {boolean} binarize     - If true, apply threshold binarization (best for documents)
 * @returns {Promise<Buffer>}    - Preprocessed PNG buffer
 */
async function preprocessImage(inputBuffer, binarize = false) {
  try {
    const img = sharp(inputBuffer);
    const meta = await img.metadata();

    const w = meta.width  || 0;
    const h = meta.height || 0;

    // Build the pipeline
    let pipeline = sharp(inputBuffer)
      .greyscale()             // Colour doesn't help OCR and wastes memory
      .normalize();            // Stretch contrast (helps faded scans)

    // Upscale to ~2500 px on the long side (≈ 300 DPI for a standard document).
    // Cap at maxDimension so we don't OOM on a 10000×10000 image.
    const longSide = Math.max(w, h);
    const TARGET_LONG = 2500;

    if (longSide > 0 && longSide < TARGET_LONG) {
      const scale = Math.min(TARGET_LONG / longSide, 4); // max 4× upscale
      pipeline = pipeline.resize(
        Math.round(w * scale),
        Math.round(h * scale),
        { kernel: sharp.kernel.lanczos3, fit: 'fill' }
      );
    } else if (w > OCR_CONFIG.maxDimension || h > OCR_CONFIG.maxDimension) {
      pipeline = pipeline.resize(OCR_CONFIG.maxDimension, OCR_CONFIG.maxDimension, {
        kernel: sharp.kernel.lanczos3,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Median filter removes speckle / salt-and-pepper noise
    pipeline = pipeline.median(3);

    // Stronger sharpen for clearer character edges
    pipeline = pipeline.sharpen({ sigma: 1.5 });

    // Binarize: convert to pure black/white — best for Tesseract on documents
    if (binarize) {
      pipeline = pipeline.threshold(140);
    }

    return await pipeline.png().toBuffer();
  } catch (err) {
    Logger.warn('imageOcrService: sharp preprocessing failed, using raw buffer', {
      error: err.message,
    });
    // Fall through with the original buffer — Tesseract can still try
    return inputBuffer;
  }
}

// ─── Singleton worker pool ────────────────────────────────────────────────────

let _workerPool   = null;   // resolved Promise<TesseractWorker[]>
let _poolIndex    = 0;

async function getWorker() {
  if (!_workerPool) {
    _workerPool = (async () => {
      const workers = [];
      for (let i = 0; i < OCR_CONFIG.workerPoolSize; i++) {
        const w = await createWorker(OCR_CONFIG.language, 1, {
          // Suppress Tesseract's own console output
          logger: () => {},
          errorHandler: (err) => Logger.warn('Tesseract worker error', { error: err }),
        });
        workers.push(w);
      }
      Logger.info('imageOcrService: Tesseract worker pool ready', {
        size: workers.length,
        lang: OCR_CONFIG.language,
      });
      return workers;
    })();
  }

  const workers = await _workerPool;
  // Round-robin across the pool
  const worker = workers[_poolIndex % workers.length];
  _poolIndex++;
  return worker;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run OCR on a single image buffer.
 *
 * @param {Buffer}  imageBuffer  - Raw image bytes (jpg/png/webp/gif/tiff)
 * @param {string}  [hint]       - Label used in log messages (e.g. filename or page number)
 * @param {Object}  [opts]       - Options
 * @param {boolean} [opts.document=false] - If true, apply document-oriented binarization
 * @returns {Promise<{ text: string, confidence: number, timeMs: number }>}
 */
async function ocrImage(imageBuffer, hint = 'image', opts = {}) {
  const start = Date.now();
  const isDocument = opts.document === true;

  try {
    // Step 1: preprocess (use binarization for documents)
    const processed = await preprocessImage(imageBuffer, isDocument);

    // Step 2: OCR
    const worker = await getWorker();
    const { data } = await worker.recognize(processed);

    let text = (data.text || '').trim();
    let confidence = data.confidence || 0;

    // If document mode returned low confidence, retry WITHOUT binarization
    // (some images with complex backgrounds do better without threshold)
    if (isDocument && confidence < 40 && text.length < OCR_CONFIG.minTextLength) {
      Logger.info('imageOcrService: low-confidence document OCR, retrying without binarization', {
        hint, confidence: Math.round(confidence), charCount: text.length
      });
      const fallback = await preprocessImage(imageBuffer, false);
      const { data: data2 } = await worker.recognize(fallback);
      const text2 = (data2.text || '').trim();
      const conf2 = data2.confidence || 0;

      if (conf2 > confidence || text2.length > text.length) {
        text = text2;
        confidence = conf2;
      }
    }

    const timeMs = Date.now() - start;

    if (OCR_CONFIG.logMetrics) {
      Logger.info('imageOcrService: OCR complete', {
        hint,
        charCount: text.length,
        confidence: Math.round(confidence),
        timeMs,
        document: isDocument,
      });
    }

    return { text, confidence, timeMs };
  } catch (err) {
    Logger.error('imageOcrService: OCR failed', { hint, error: err.message });
    return { text: '', confidence: 0, timeMs: Date.now() - start, error: err.message };
  }
}

/**
 * Run OCR across multiple image buffers in parallel (respects pool size).
 * Returns an array of text strings in the same order as the input.
 *
 * @param {Array<{ buffer: Buffer, hint: string }>} images
 * @returns {Promise<string[]>}
 */
async function ocrImages(images) {
  if (!images || images.length === 0) return [];

  const results = await Promise.all(
    images.map(({ buffer, hint }) => ocrImage(buffer, hint))
  );

  return results.map(r => r.text);
}

/**
 * Terminate all Tesseract workers once the process is shutting down.
 * Call from app cleanup / SIGTERM handler if desired.
 */
async function terminate() {
  if (_workerPool) {
    try {
      const workers = await _workerPool;
      await Promise.all(workers.map(w => w.terminate()));
      _workerPool = null;
      Logger.info('imageOcrService: Tesseract worker pool terminated');
    } catch (err) {
      Logger.warn('imageOcrService: error terminating workers', { error: err.message });
    }
  }
}

module.exports = {
  ocrImage,
  ocrImages,
  preprocessImage,
  terminate,
  OCR_CONFIG,
};
