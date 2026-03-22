const pdfParse = require("pdf-parse");
const Logger = require('../logger');
const { stripDifficultyLabels } = require('./textNormalizer');
const { getImageDominantPages, renderAllPages } = require('../services/pdfPageRenderer');
const { ocrImages } = require('../services/imageOcrService');

/**
 * Custom page render callback — concatenates items in reading order (top-to-bottom,
 * left-to-right) without the multi-column artifacts the default renderer introduces.
 * Preserves line breaks by grouping items whose Y positions are close together.
 */
function renderPage(pageData) {
  const items = pageData.Texts;
  if (!items || items.length === 0) return '';

  // pdf-parse Texts are already in document order; just join them with spaces,
  // inserting a newline whenever the Y offset changes significantly (new line in PDF).
  let lastY = null;
  let result = '';

  for (const item of items) {
    const text = decodeURIComponent(item.R.map(r => r.T).join(''));
    if (text.trim() === '') continue;

    if (lastY !== null && Math.abs(item.y - lastY) > 0.3) {
      result += '\n';
    } else if (result.length > 0 && !result.endsWith(' ') && !result.endsWith('\n')) {
      result += ' ';
    }

    result += text;
    lastY = item.y;
  }

  return result + '\n';
}

/**
 * Rejoin words that pdf-parse broke across line boundaries.
 * Justified PDFs cause pdf-parse to wrap mid-word, e.g.:
 *   "operations, c\nlients" → "operations, clients"
 *   "Functiona\nl and" → "Functional and"
 */
function rejoinBrokenWords(text) {
  const lines = text.split('\n');
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i > 0 && result.length > 0 && line.length > 0) {
      const prev = result[result.length - 1];
      const trimmedLine = line.trimStart();
      // Case 1: prev ends with "punct/space + single letter" and current starts lowercase
      // e.g. "operations, c" + "lients" → "operations, clients"
      if (/[,;:\s] [a-zA-Z]$/.test(prev) && /^[a-z]/.test(trimmedLine)) {
        result[result.length - 1] = prev + trimmedLine;
        continue;
      }
      // Case 2: prev ends with letter, current starts with single lowercase + space/punct
      // e.g. "Functiona" + "l and" → "Functional and"
      if (/[a-zA-Z]$/.test(prev) && /^[a-z][ ,;:.]/.test(trimmedLine)) {
        result[result.length - 1] = prev + trimmedLine;
        continue;
      }
    }
    result.push(line);
  }
  return result.join('\n');
}

/**
 * Post-process extracted PDF text:
 * 1. Strip Vayrex export artefacts (watermark, footers, title page, answer key header)
 * 2. Strip inline difficulty labels ([Easy], [Medium], [Hard], etc.)
 * 3. Remove PDF extraction artefacts (soft hyphens, form-feeds, ligature fixes)
 * 4. Collapse runs of blank lines
 */
function postProcessPdfText(raw) {
  let t = raw
    // Form-feed characters become section breaks
    .replace(/\f/g, '\n')
    // Soft hyphen line-break artefact: word-\nnext → wordnext
    .replace(/\xAD\n/g, '')
    .replace(/-\n([a-z])/g, '$1')
    // Common PDF ligature replacements
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')

    // ── Vayrex PDF export noise removal ──
    // Watermark text (the word "VAYREX" repeated, sometimes in all-caps)
    .replace(/\bVAYREX\b/g, '')
    // Page footers: "Page X of Y | Vayrex Learning | date"
    .replace(/^\s*Page\s+\d+\s+of\s+\d+\s*[|].*$/gim, '')
    .replace(/^\s*Vayrex\s+Learning\s+Platform\s*$/gim, '')
    .replace(/^\s*Generated\s+by\s+Vayrex\s+Learning\s+Platform\s*$/gim, '')
    // Title page boilerplate
    .replace(/^\s*Question\s+Bank\s*$/gim, '')
    .replace(/^\s*Examination\s+Paper\s*$/gim, '')
    .replace(/^\s*Prepared\s+for:\s*.*/gim, '')
    .replace(/^\s*Total\s+Questions:\s*\d+\s*$/gim, '')
    .replace(/^\s*Generated:\s*.+$/gim, '')
    .replace(/^\s*Vayrex\s+Learning\s*$/gim, '')
    // Answer Key header
    .replace(/^\s*Answer\s+Key\s*$/gim, '')
    // Standalone difficulty lines: "[EASY]" "[MEDIUM]" "[HARD]" (all-caps badge form)
    .replace(/^\s*\[(?:EASY|MEDIUM|HARD)\]\s*$/gm, '')

    // ── Inline difficulty labels ──
    .replace(/\s*\[(?:difficulty:\s*)?(?:very\s+)?(?:easy|medium|hard|beginner|intermediate|advanced|expert)\]/gi, '')
    .replace(/\s*\((?:difficulty:\s*)?(?:very\s+)?(?:easy|medium|hard|beginner|intermediate|advanced|expert)\)/gi, '')
    .replace(/\s+[\u2014\u2013|/]\s*(?:very\s+)?(?:easy|medium|hard|beginner|intermediate|advanced|expert)(?=\s|$)/gi, '')
    .replace(/^\s*(?:difficulty[:\s]+)?(?:very\s+)?(?:easy|medium|hard|beginner|intermediate|advanced|expert)\s*$/gim, '')
    .replace(/difficulty\s*:\s*(?:very\s+)?(?:easy|medium|hard|beginner|intermediate|advanced|expert)/gi, '')

    // ── Justified text artifact cleanup ──
    // Collapse multiple spaces between words (justified PDF typesetting artifact)
    .replace(/ {2,}/g, ' ')

    // ── General cleanup ──
    // Standalone page numbers on their own line (e.g. "2" or "3" between pages)
    .replace(/^\s*\d{1,3}\s*$/gm, '')
    // Remove trailing whitespace per line
    .replace(/[ \t]+$/gm, '')
    // Collapse excessive blank lines
    .replace(/\n{3,}/g, '\n\n');

  // Rejoin words broken across line boundaries by PDF extraction
  t = rejoinBrokenWords(t);

  return t.trim();
}

/**
 * Parse PDF file and extract text content.
 * For image-dominant pages (scanned content, diagrams, etc.), runs local
 * Tesseract OCR via imageOcrService so no text is silently dropped.
 *
 * @param {Buffer} fileBuffer - The PDF file buffer
 * @returns {Promise<string>} - Extracted text content
 */
async function parsePdf(fileBuffer) {
  try {
    // Validate input
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
      throw new Error('Invalid PDF buffer provided');
    }

    if (fileBuffer.length < 67) {
      throw new Error('File is too small to be a valid PDF');
    }

    const header = fileBuffer.slice(0, 5).toString('ascii');
    if (!header.startsWith('%PDF')) {
      throw new Error('File does not have a valid PDF header');
    }

    // ── Step 1: pdf-parse pass ─────────────────────────────────────────────
    const parsePromise = pdfParse(fileBuffer, {
      max: 500,
      version: 'v2.0.550'
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('PDF parsing timed out after 60 seconds')), 60000)
    );

    const pdfData = await Promise.race([parsePromise, timeoutPromise]);

    const rawText = (pdfData && pdfData.text) ? pdfData.text : '';
    const numPages = (pdfData && pdfData.numpages) || 0;

    // pdf-parse inserts \f (form-feed) between pages — split on that to get per-page text
    // This is the reliable way to obtain per-page density without a pagerender callback
    const perPageTexts = rawText.split('\f').map(p => p.trim());

    Logger.info('pdfParser: pdf-parse pass complete', {
      numPages,
      rawLength: rawText.length,
      detectedPages: perPageTexts.length
    });

    // ── Step 2: Detect image-only / image-dominant scenario ──────────────────
    // Case A: Entire document returned near-zero text → fully-scanned PDF
    const isFullyScanned = rawText.trim().length < 50 && numPages > 0;

    // Case B: Some pages have text, others don't → mixed PDF
    const imageDominantIndices = perPageTexts.reduce((acc, t, i) => {
      if ((t || '').trim().length < 100) acc.push(i); // 0-based
      return acc;
    }, []);
    const hasMixedContent = !isFullyScanned && imageDominantIndices.length > 0;

    let finalText = rawText;

    // ── Step 3A: Fully-scanned PDF — OCR every page ───────────────────────────
    if (isFullyScanned) {
      Logger.info('pdfParser: fully-scanned PDF detected — running full OCR', { numPages });
      try {
        const allPages = await renderAllPages(fileBuffer);
        if (allPages.length > 0) {
          const ocrTexts = await ocrImages(
            allPages.map(p => ({ buffer: p.pngBuffer, hint: `page-${p.pageNum}` }))
          );
          finalText = ocrTexts.join('\n\n');
          Logger.info('pdfParser: full OCR complete', { charCount: finalText.length });
        }
      } catch (ocrErr) {
        Logger.warn('pdfParser: full OCR failed, returning empty', { error: ocrErr.message });
        finalText = '';
      }
    }

    // ── Step 3B: Mixed PDF — OCR only image-dominant pages, merge result ──────
    else if (hasMixedContent) {
      Logger.info('pdfParser: mixed PDF — OCR-ing image-dominant pages', {
        totalPages: numPages,
        imageDominantCount: imageDominantIndices.length
      });
      try {
        const renderedPages = await getImageDominantPages(fileBuffer, perPageTexts);
        if (renderedPages.length > 0) {
          const ocrTexts = await ocrImages(
            renderedPages.map(p => ({ buffer: p.pngBuffer, hint: `page-${p.pageNum}` }))
          );

          // Merge: rebuild page-by-page using OCR text for image pages, original for others
          // Convert perPageTexts to a mutable array (may be shorter if pdf-parse missed some pages)
          const merged = [];
          const ocrMap = new Map(renderedPages.map((p, i) => [p.pageNum - 1, ocrTexts[i] || '']));
          for (let i = 0; i < Math.max(perPageTexts.length, numPages); i++) {
            if (ocrMap.has(i)) {
              merged.push(ocrMap.get(i));
            } else {
              merged.push(perPageTexts[i] || '');
            }
          }
          finalText = merged.join('\n\n');
          Logger.info('pdfParser: mixed OCR merge complete', { charCount: finalText.length });
        }
      } catch (ocrErr) {
        Logger.warn('pdfParser: mixed OCR failed, using text-only extraction', { error: ocrErr.message });
        // Fall through to text-only result
        finalText = rawText;
      }
    }

    if (!finalText || finalText.trim().length === 0) {
      Logger.warn('pdfParser: no text extracted from PDF (all paths exhausted)');
      return '';
    }

    // Detect potentially corrupted output
    const printableRatio = (finalText.replace(/[\x00-\x1F\x7F]/g, '').length) / (finalText.length || 1);
    if (finalText.length > 100 && printableRatio < 0.3) {
      Logger.warn('pdfParser: low printable character ratio — may be corrupted', { ratio: printableRatio });
    }

    const textContent = postProcessPdfText(finalText);

    Logger.info('pdfParser: PDF parsed successfully', {
      rawLength: finalText.length,
      cleanedLength: textContent.length,
      pages: numPages,
      ocrApplied: isFullyScanned || hasMixedContent
    });

    return textContent;
  } catch (err) {
    Logger.error('PDF parsing error', { error: err.message, stack: err.stack });
    throw new Error(`Failed to parse PDF file: ${err.message}`);
  }
}

module.exports = {
  parsePdf
};
