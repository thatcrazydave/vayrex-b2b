const PizZip = require('pizzip');
const { DOMParser } = require('@xmldom/xmldom');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const os = require('os');
const logger = require('../logger');

/**
 * Batch Processing Configuration
 */
const BATCH_CONFIG = {
  PPTX: {
    minSlidesPerBatch: 10,
    maxSlidesPerBatch: 25,
    estimatedBytesPerSlide: 2000
  },
  PDF: {
    minPagesPerBatch: 5,
    maxPagesPerBatch: 12,
    estimatedBytesPerPage: 3000
  },
  DOCX: {
    minCharsPerBatch: 5000,
    maxCharsPerBatch: 12000
  },
  Images: {
    pagesPerBatch: 3
  }
};

const TOKEN_BATCH_CONFIG = {
  targetTokensPerBatch: 2500,
  maxBatches: 8
};

/**
 * Dynamic batch size calculation based on file type, size, and system resources
 * Larger files get more parallel batches for faster processing
 * @param {number} fileSize - File size in bytes
 * @param {string} fileType - File type (.pptx, .pdf, .docx)
 * @param {number} contentItems - Number of items (slides, pages, characters)
 * @returns {Object} { batchCount, itemsPerBatch, reason }
 */
function calculateBatchSize(fileSize, fileType, contentItems = null, questionsCount = 10) {
  // Use a sensible system maximum for LLM API concurrency rather than relying on hardware CPU cores
  const maxSystemBatches = 8;
  let batchCount = 1;
  let itemsPerBatch = contentItems;
  let reason = '';

  switch (fileType) {
    case '.pptx':
    case '.ppt': {
      const cfg = BATCH_CONFIG.PPTX;
      if (contentItems > 100) {
        batchCount = Math.min(maxSystemBatches, Math.ceil(contentItems / cfg.minSlidesPerBatch));
        reason = `Large PPTX (${contentItems} slides), ${batchCount} batches`;
      } else if (contentItems > 50) {
        batchCount = Math.min(maxSystemBatches, Math.ceil(contentItems / cfg.maxSlidesPerBatch));
        batchCount = Math.max(batchCount, 3);
        reason = `Medium PPTX (${contentItems} slides), ${batchCount} batches`;
      } else if (contentItems > 20) {
        batchCount = Math.ceil(contentItems / cfg.maxSlidesPerBatch);
        batchCount = Math.max(batchCount, 2);
        reason = `Small-medium PPTX (${contentItems} slides), ${batchCount} batches`;
      } else {
        batchCount = 1;
        reason = `Small PPTX (${contentItems} slides), single batch`;
      }
      itemsPerBatch = Math.ceil(contentItems / batchCount);
      break;
    }

    case '.pdf': {
      const cfg = BATCH_CONFIG.PDF;
      if (contentItems > 100) {
        batchCount = Math.min(maxSystemBatches, Math.ceil(contentItems / cfg.minPagesPerBatch));
        batchCount = Math.max(batchCount, 8);
        reason = `Very large PDF (${contentItems} pages), ${batchCount} batches`;
      } else if (contentItems > 50) {
        batchCount = Math.min(maxSystemBatches, Math.ceil(contentItems / cfg.maxPagesPerBatch));
        batchCount = Math.max(batchCount, 4);
        reason = `Large PDF (${contentItems} pages), ${batchCount} batches`;
      } else if (contentItems > 20) {
        batchCount = Math.ceil(contentItems / cfg.maxPagesPerBatch);
        batchCount = Math.max(batchCount, 2);
        reason = `Medium PDF (${contentItems} pages), ${batchCount} batches`;
      } else {
        batchCount = 1;
        reason = `Small PDF (${contentItems} pages), single batch`;
      }
      itemsPerBatch = Math.ceil(contentItems / batchCount);
      break;
    }

    case '.docx': {
      const cfg = BATCH_CONFIG.DOCX;
      const estimatedPages = Math.ceil(fileSize / 3000);
      if (fileSize > 2000000) {
        batchCount = Math.min(maxSystemBatches, Math.ceil(estimatedPages / 8));
        batchCount = Math.max(batchCount, 6);
        reason = `Very large DOCX (${(fileSize / 1024 / 1024).toFixed(1)}MB), ${batchCount} batches`;
      } else if (fileSize > 500000) {
        batchCount = Math.min(maxSystemBatches, 4);
        reason = `Large DOCX (${(fileSize / 1024).toFixed(0)}KB), ${batchCount} batches`;
      } else if (fileSize > 200000) {
        batchCount = 2;
        reason = `Medium DOCX (${(fileSize / 1024).toFixed(0)}KB), ${batchCount} batches`;
      } else {
        batchCount = 1;
        reason = `Small DOCX (${(fileSize / 1024).toFixed(0)}KB), single batch`;
      }
      itemsPerBatch = Math.ceil(fileSize / batchCount);
      break;
    }

    default:
      batchCount = 1;
      itemsPerBatch = contentItems;
      reason = `Default single batch for ${fileType}`;
  }

  // Step 1 optimization: Micro-batching (Max ~7 questions per call)
  const MAX_QUESTIONS_PER_BATCH = 7;
  const questionBatches = questionsCount ? Math.ceil(questionsCount / MAX_QUESTIONS_PER_BATCH) : 1;

  // Take the maximum of system suggested batches (file based) and question based batches
  batchCount = Math.max(batchCount, questionBatches);

  if (questionBatches > 1 && reason.indexOf('Micro-batching') === -1) {
    reason += ` (Micro-batching: ${batchCount} total)`;
  }

  // Recalculate itemsPerBatch if batchCount was increased.
  // Use contentItems for PPTX/PDF and fileSize for DOCX/other byte-split modes.
  const baseItems = (fileType === '.docx') ? fileSize : (contentItems || fileSize);
  itemsPerBatch = Math.ceil(baseItems / batchCount);

  logger.info('Dynamic batch calculation', { fileType, contentItems, fileSize, batchCount, reason });

  return {
    batchCount,
    itemsPerBatch,
    config: BATCH_CONFIG[fileType === '.pptx' || fileType === '.ppt' ? 'PPTX' : fileType === '.pdf' ? 'PDF' : 'DOCX'] || {},
    reason
  };
}

function calculateTokenBatchSize(contentLength, questionsCount = 10) {
  const estimatedTokens = Math.max(1, Math.ceil(contentLength / 4));
  let batchCount = Math.ceil(estimatedTokens / TOKEN_BATCH_CONFIG.targetTokensPerBatch);
  batchCount = Math.min(TOKEN_BATCH_CONFIG.maxBatches, Math.max(1, batchCount));

  const MAX_QUESTIONS_PER_BATCH = 7;
  const questionBatches = questionsCount ? Math.ceil(questionsCount / MAX_QUESTIONS_PER_BATCH) : 1;
  batchCount = Math.max(batchCount, questionBatches);

  const itemsPerBatch = Math.ceil(estimatedTokens / batchCount);
  const reason = `Token-based batching (~${estimatedTokens} tokens, ${batchCount} batches)`;

  logger.info('Token batch calculation', { estimatedTokens, batchCount, itemsPerBatch, reason });

  return { batchCount, itemsPerBatch, estimatedTokens, reason };
}

/**
 * Extract text from XML (reused from pptxParser)
 */
function extractTextFromXml(xml) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const textNodes = doc.getElementsByTagName('a:t');

    let text = '';
    for (let i = 0; i < textNodes.length; i++) {
      const nodeText = textNodes[i].textContent || '';
      text += nodeText + ' ';
    }

    return text.trim();
  } catch (error) {
    logger.error('Error extracting text from XML:', error);
    return '';
  }
}

/**
 * Extract a batch of slides from PPTX
 * @param {Buffer} fileBuffer - PPTX file buffer
 * @param {number} startSlide - Start slide number (1-indexed)
 * @param {number} endSlide - End slide number (inclusive, 1-indexed)
 * @returns {Promise<string>} Combined text from slides
 */
async function extractPptxBatch(fileBuffer, startSlide, endSlide) {
  try {
    const zip = new PizZip(fileBuffer);
    const slidesFolder = zip.folder('ppt/slides');

    if (!slidesFolder) {
      logger.error('No slides folder found in PPTX');
      return '';
    }

    const files = slidesFolder.file(/slide\d+\.xml$/);
    let combinedText = '';

    for (const file of files) {
      // Extract slide number from filename
      const slideMatch = file.name.match(/slide(\d+)/);
      if (!slideMatch) continue;

      const slideNum = parseInt(slideMatch[1]);

      // Only process slides in this batch
      if (slideNum < startSlide || slideNum > endSlide) continue;

      try {
        const xml = file.asText();
        const slideText = extractTextFromXml(xml);
        combinedText += slideText + '\n';
      } catch (error) {
        logger.warn(`Error parsing slide ${slideNum}:`, error.message);
        continue;
      }
    }

    const result = combinedText.trim();
    logger.info('PPTX batch extracted', { startSlide, endSlide, textLength: result.length });
    return result;
  } catch (error) {
    logger.error('Error extracting PPTX batch:', error);
    throw new Error(`Failed to extract PPTX batch (${startSlide}-${endSlide}): ${error.message}`);
  }
}

/**
 * Extract a batch of pages from PDF
 * @param {Buffer} fileBuffer - PDF file buffer
 * @param {number} startPage - Start page number (1-indexed)
 * @param {number} endPage - End page number (inclusive, 1-indexed)
 * @returns {Promise<string>} Combined text from pages
 */
async function extractPdfBatch(fileBuffer, startPage, endPage) {
  try {
    const pdfData = await pdfParse(fileBuffer);

    // pdf-parse doesn't provide per-page extraction natively.
    // We slice the full text proportionally by page range.
    // In production, consider using pdfjs for true page-by-page extraction.
    const fullText = pdfData.text;
    const totalPages = pdfData.numpages;

    const startChar = Math.floor(((startPage - 1) / totalPages) * fullText.length);
    const endChar = Math.floor((endPage / totalPages) * fullText.length);

    const result = fullText.substring(startChar, endChar).trim();
    logger.info('PDF batch extracted', { startPage, endPage, totalPages, textLength: result.length });
    return result;
  } catch (error) {
    logger.error('Error extracting PDF batch:', error);
    throw new Error(`Failed to extract PDF batch (${startPage}-${endPage}): ${error.message}`);
  }
}

/**
 * Extract text from DOCX
 * @param {Buffer} fileBuffer - DOCX file buffer
 * @param {number} startIndex - Start byte index
 * @param {number} endIndex - End byte index
 * @returns {Promise<string>} Text chunk
 */
async function extractDocxBatch(fileBuffer, startIndex, endIndex) {
  try {
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    const fullText = result.value;

    // Split into batches by character count
    const chunkSize = endIndex - startIndex;
    const startChar = Math.floor((startIndex / fileBuffer.length) * fullText.length);
    const endChar = Math.floor((endIndex / fileBuffer.length) * fullText.length);

    const textChunk = fullText.substring(startChar, endChar).trim();
    logger.info('DOCX batch extracted', { startIndex, endIndex, textLength: textChunk.length });
    return textChunk;
  } catch (error) {
    logger.error('Error extracting DOCX batch:', error);
    throw new Error(`Failed to extract DOCX batch: ${error.message}`);
  }
}

/**
 * Extract full content for monolithic files
 * @param {Buffer} fileBuffer 
 * @param {string} fileType 
 * @returns {Promise<string>}
 */
async function extractFullContent(fileBuffer, fileType) {
  try {
    if (fileType === '.pdf') {
      const pdfData = await pdfParse(fileBuffer);
      logger.info('Full PDF content extracted', { textLength: pdfData.text.length, pages: pdfData.numpages });
      return pdfData.text;
    } else if (fileType === '.docx') {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      logger.info('Full DOCX content extracted', { textLength: result.value.length });
      return result.value;
    } else if (fileType === '.pptx' || fileType === '.ppt') {
      const zip = new PizZip(fileBuffer);
      const slidesFolder = zip.folder('ppt/slides');
      if (!slidesFolder) return '';
      const files = slidesFolder.file(/slide\d+\.xml$/);
      // Sort slides numerically so content is in presentation order
      files.sort((a, b) => {
        const numA = parseInt((a.name.match(/slide(\d+)/) || [])[1] || 0);
        const numB = parseInt((b.name.match(/slide(\d+)/) || [])[1] || 0);
        return numA - numB;
      });
      let allText = '';
      for (const file of files) {
        const xml = file.asText();
        allText += extractTextFromXml(xml) + '\n';
      }
      const trimmed = allText.trim();
      logger.info('Full PPTX content extracted', { textLength: trimmed.length, slides: files.length });
      return trimmed;
    }
    return '';
  } catch (error) {
    logger.error(`Error in extractFullContent for ${fileType}:`, error);
    return '';
  }
}

/**
 * Semantic slicing: Extract representative chunks for large documents
 * Breaks text into chunks, ranks them by keyword overlap with the topic, and picks top chunks.
 * @param {string} text - Full extracted text
 * @param {string} topic - The topic to search for relevance
 * @param {number} targetChunks - Number of chunks to extract
 * @param {number} chunkSize - Characters per chunk (default ~4000)
 * @returns {string} Representative text
 */
function sliceRepresentativeContext(text, topic = '', targetChunks = 5, chunkSize = 4000) {
  if (!text || text.length < chunkSize) return text;

  const totalLength = text.length;
  // Step 1: Split into equal-ish chunks
  const allChunks = [];
  for (let i = 0; i < totalLength; i += chunkSize) {
    let end = i + chunkSize;
    // Align end to a newline if possible to avoid cutting sentences
    if (end < totalLength) {
      const nextNewline = text.indexOf('\n', end);
      if (nextNewline !== -1 && nextNewline < end + 200) {
        end = nextNewline + 1;
      }
    }
    allChunks.push({
      text: text.substring(i, end),
      index: allChunks.length,
      score: 0
    });
    i = end - chunkSize; // adjust loop for the newline skip
  }

  // Step 2: Basic keyword heuristic ranking based on topic
  const keywords = topic.toLowerCase().split(/[\s,-]+/).filter(w => w.length > 2);

  if (keywords.length > 0) {
    allChunks.forEach(chunk => {
      const chunkLower = chunk.text.toLowerCase();
      let score = 0;
      keywords.forEach(kw => {
        // Count occurrences of keyword
        const regex = new RegExp(`\\b${kw}\\b`, 'g');
        const matches = chunkLower.match(regex);
        if (matches) {
          score += matches.length;
        }
      });
      // Small bonus for earlier chunks (often outline/intro)
      score += Math.max(0, 10 - chunk.index) * 0.1;
      chunk.score = score;
    });

    // Sort by score descending
    allChunks.sort((a, b) => b.score - a.score);
  }

  // Step 3: Take the top N chunks and re-sort them chronologically
  const selectedChunks = allChunks.slice(0, targetChunks).sort((a, b) => a.index - b.index);

  const result = selectedChunks.map(c => c.text).join('\n\n--- [SECTION BREAK] ---\n\n');
  const reductionPercent = Math.round((1 - (result.length / totalLength)) * 100);

  logger.info('Semantic chunking complete', {
    originalLength: totalLength,
    chunksExtracted: selectedChunks.length,
    finalLength: result.length,
    reductionPercent: `${reductionPercent}%`,
    topic
  });

  return result;
}

/**
 * Split image batches (reuse existing logic pattern)
 * Groups images into batches of specified size
 * @param {number} totalImages - Total number of images/pages
 * @returns {Array} Array of batch ranges
 */
function calculateImageBatches(totalImages) {
  const batches = [];
  const batchSize = BATCH_CONFIG.Images.pagesPerBatch;

  for (let i = 0; i < totalImages; i += batchSize) {
    batches.push({
      startIndex: i,
      endIndex: Math.min(i + batchSize - 1, totalImages - 1),
      count: Math.min(batchSize, totalImages - i)
    });
  }

  return batches;
}

/**
 * Determine file content items count (slides for PPTX, pages for PDF, etc.)
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} fileType - File type extension
 * @returns {Promise<number>} Number of items
 */
async function getContentItemCount(fileBuffer, fileType) {
  try {
    switch (fileType) {
      case '.pptx':
        // Count slides
        const zip = new PizZip(fileBuffer);
        const slidesFolder = zip.folder('ppt/slides');
        if (!slidesFolder) return 0;

        const slideFiles = slidesFolder.file(/slide\d+\.xml$/);
        logger.info('Content item count', { fileType, itemCount: slideFiles.length });
        return slideFiles.length;

      case '.pdf':
        // Count pages
        const pdfData = await pdfParse(fileBuffer);
        logger.info('Content item count', { fileType, itemCount: pdfData.numpages });
        return pdfData.numpages;

      case '.docx':
        // For DOCX, return file size as indicator (will be split by bytes)
        logger.info('Content item count', { fileType, itemCount: fileBuffer.length, unit: 'bytes' });
        return fileBuffer.length;

      default:
        return 1;
    }
  } catch (error) {
    logger.error('Error counting file items:', error);
    return 1;
  }
}

/**
 * Generate batch specifications
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} fileType - File type extension
 * @returns {Promise<Array>} Array of batch specifications
 */
async function generateBatchSpecs(fileBuffer, fileType, questionsCount) {
  try {
    const itemCount = await getContentItemCount(fileBuffer, fileType);
    const { batchCount, itemsPerBatch } = calculateBatchSize(
      fileBuffer.length,
      fileType,
      itemCount,
      questionsCount
    );

    const batches = [];

    for (let i = 0; i < batchCount; i++) {
      const startItem = i * itemsPerBatch + 1; // 1-indexed
      if (startItem > itemCount) break; // Cannot start out of bounds
      const endItem = Math.min((i + 1) * itemsPerBatch, itemCount);
      if (endItem < startItem) {
        continue;
      }

      batches.push({
        batchId: i + 1,
        startItem,
        endItem,
        itemCount: endItem - startItem + 1,
        totalItemsCount: itemCount,
        fileType
      });
    }

    logger.info(
      `Generated ${batchCount} batch(es) for ${fileType} file (${itemCount} total items)`,
      { batchCount, itemCount, itemsPerBatch }
    );

    return batches;
  } catch (error) {
    logger.error('Error generating batch specs:', error);
    throw new Error(`Failed to generate batch specifications: ${error.message}`);
  }
}

function generateTokenBatchSpecsFromContent(contentLength, fileType, questionsCount) {
  const { batchCount, itemsPerBatch, estimatedTokens } = calculateTokenBatchSize(contentLength, questionsCount);
  const batches = [];

  for (let i = 0; i < batchCount; i++) {
    const startItem = i * itemsPerBatch + 1;
    if (startItem > estimatedTokens) break;
    const endItem = Math.min((i + 1) * itemsPerBatch, estimatedTokens);
    if (endItem < startItem) {
      continue;
    }

    batches.push({
      batchId: i + 1,
      startItem,
      endItem,
      itemCount: endItem - startItem + 1,
      totalItemsCount: estimatedTokens,
      fileType
    });
  }

  logger.info(
    `Generated ${batches.length} token-based batch(es) for ${fileType} content`,
    { batchCount: batches.length, estimatedTokens, itemsPerBatch }
  );

  return batches;
}

module.exports = {
  calculateBatchSize,
  extractPptxBatch,
  extractPdfBatch,
  extractDocxBatch,
  calculateImageBatches,
  getContentItemCount,
  generateBatchSpecs,
  extractFullContent,
  sliceRepresentativeContext,
  BATCH_CONFIG,
  generateTokenBatchSpecsFromContent
};
