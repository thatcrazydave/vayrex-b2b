const crypto = require('crypto');
const AdmZip = require('adm-zip');
const Logger = require('../logger');

/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║  Multi-File Service — Orchestration for Multi-File Uploads    ║
 * ║                                                               ║
 * ║  S3 ZIP bundling, proportional question budgeting,            ║
 * ║  combined content hashing, file manifest management           ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

/**
 * Compute a combined content hash from multiple files.
 * Hash is ORDER-INDEPENDENT: same files in any upload order produce the same hash.
 * 
 * @param {Array<{ contentHash: string }>} files — Files with per-file SHA256 hashes
 * @returns {string} SHA256 hex string
 */
function computeCombinedContentHash(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('No files provided for combined hash');
  }

  // Single file → just return its hash directly (backward compatible)
  if (files.length === 1) return files[0].contentHash;

  // Sort hashes lexicographically → order-independent
  const sortedHashes = files.map(f => f.contentHash).sort();
  const joined = sortedHashes.join('');

  return crypto.createHash('sha256').update(joined).digest('hex');
}

/**
 * Create a ZIP archive bundle from multiple file buffers.
 * Returns a single buffer containing all files — uploaded as ONE S3 object.
 * 
 * @param {Array<{ fileName: string, data: Buffer, mimeType: string }>} files
 * @returns {{ bundleBuffer: Buffer, manifest: Array<{ fileName: string, size: number, mimeType: string }> }}
 */
function createBundle(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('No files provided for bundling');
  }

  const zip = new AdmZip();
  const manifest = [];

  for (const file of files) {
    // Sanitize filename to prevent path traversal in ZIP
    const safeName = file.fileName.replace(/[\/\\]/g, '_').replace(/\.\./g, '_');
    zip.addFile(safeName, file.data, `Original: ${file.fileName}`);
    manifest.push({
      fileName: safeName,
      originalName: file.fileName,
      size: file.data.length,
      mimeType: file.mimeType
    });
  }

  const bundleBuffer = zip.toBuffer();

  Logger.info('ZIP bundle created', {
    fileCount: files.length,
    bundleSizeBytes: bundleBuffer.length,
    totalFileSizeBytes: files.reduce((sum, f) => sum + f.data.length, 0)
  });

  return { bundleBuffer, manifest };
}

/**
 * Extract files from a ZIP archive bundle.
 * 
 * @param {Buffer} bundleBuffer — ZIP buffer fetched from S3
 * @returns {Array<{ fileName: string, data: Buffer }>}
 */
function extractBundle(bundleBuffer) {
  const zip = new AdmZip(bundleBuffer);
  const entries = zip.getEntries();
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    // SECURITY: Sanitize filenames from ZIP to prevent path traversal
    const safeName = entry.entryName
      .replace(/[\/\\]/g, '_')   // Strip path separators
      .replace(/\.\./g, '_')      // Strip parent directory refs
      .replace(/[\x00-\x1f]/g, '') // Strip control characters
      .replace(/^\./g, '_');       // Strip leading dots
    
    if (!safeName || safeName.length === 0) continue; // Skip empty names
    
    files.push({
      fileName: safeName,
      data: entry.getData()
    });
  }

  Logger.info('ZIP bundle extracted', { fileCount: files.length });
  return files;
}

/**
 * Calculate an EQUAL question budget per file.
 * Every file receives the same number of questions regardless of text length,
 * so a 200-page PDF and a 2-page PPTX each contribute equally to the quiz.
 *
 * Any remainder from integer division is distributed round-robin (1 extra
 * question per file starting from the first) so the total is always exact.
 *
 * @param {Array<{ fileName: string, textLength: number }>} files
 * @param {number} totalQuestions — Total questions requested by user
 * @returns {Array<{ fileName: string, questionBudget: number, percentage: number }>}
 */
function calculateProportionalBudget(files, totalQuestions) {
  if (!Array.isArray(files) || files.length === 0) return [];

  // Single file gets 100% of the budget
  if (files.length === 1) {
    return [{
      fileName: files[0].fileName,
      questionBudget: totalQuestions,
      percentage: 100
    }];
  }

  const perFile = Math.floor(totalQuestions / files.length);
  let remainder = totalQuestions - perFile * files.length;   // 0 ≤ remainder < files.length
  const equalPct = Math.round(100 / files.length);

  const budgets = files.map(file => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return {
      fileName: file.fileName,
      questionBudget: perFile + extra,
      percentage: equalPct,
      textLength: file.textLength
    };
  });

  const totalTextLength = files.reduce((sum, f) => sum + f.textLength, 0);

  Logger.info('Equal question budget calculated', {
    totalQuestions,
    fileCount: files.length,
    totalTextLength,
    budgets: budgets.map(b => ({ file: b.fileName, budget: b.questionBudget, pct: b.percentage }))
  });

  return budgets;
}

/**
 * Build a combined text pool from multiple files' extracted text.
 * Adds file markers for question attribution + controls ordering.
 * 
 * @param {Array<{ fileName: string, text: string }>} files — Files with extracted text
 * @returns {{ combinedText: string, totalLength: number, fileOffsets: Array<{ fileName: string, startOffset: number, endOffset: number }> }}
 */
function buildCombinedTextPool(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return { combinedText: '', totalLength: 0, fileOffsets: [] };
  }

  const parts = [];
  const fileOffsets = [];
  let currentOffset = 0;

  for (const file of files) {
    const marker = `\n\n=== [FILE: ${file.fileName}] ===\n\n`;
    const block = marker + file.text;
    const startOffset = currentOffset + marker.length;
    const endOffset = currentOffset + block.length;

    fileOffsets.push({
      fileName: file.fileName,
      startOffset,
      endOffset
    });

    parts.push(block);
    currentOffset = endOffset;
  }

  const combinedText = parts.join('\n\n--- [FILE BOUNDARY] ---\n\n');

  return {
    combinedText,
    totalLength: combinedText.length,
    fileOffsets
  };
}

/**
 * Build the S3 key for a multi-file bundle upload.
 * Format: uploads/{userId}/bundles/{timestamp}_{fileCount}files.zip
 */
function buildBundleS3Key(userId, fileCount) {
  return `uploads/${userId}/bundles/${Date.now()}_${fileCount}files.zip`;
}

module.exports = {
  computeCombinedContentHash,
  createBundle,
  extractBundle,
  calculateProportionalBudget,
  buildCombinedTextPool,
  buildBundleS3Key
};
