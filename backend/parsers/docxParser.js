const mammoth = require("mammoth");
const PizZip = require('pizzip');
const { DOMParser } = require('@xmldom/xmldom');
const Logger = require('../logger');
const { stripDifficultyLabels, stripExportNoise } = require('./textNormalizer');

// ─── Security limits for DOCX image extraction ───
const DOCX_IMAGE_LIMITS = {
  MAX_IMAGES: 200,
  MAX_IMAGE_SIZE: 10 * 1024 * 1024,   // 10 MB per image
  MIN_IMAGE_SIZE: 2 * 1024,            // 2 KB — skip tiny icons/bullets
};

/**
 * Extract images from a DOCX file with positional paragraph-index tracking.
 *
 * DOCX images sit in word/media/. Their positions are tracked by reading
 * word/document.xml — each <w:p> (paragraph) is numbered sequentially, and
 * inline drawings (<a:blip>) reference a relationship ID that maps to a media file
 * via word/_rels/document.xml.rels.
 *
 * @param {Buffer} fileBuffer - Raw DOCX bytes
 * @param {Object} [opts]
 * @param {boolean} [opts.includeBuffers=false]
 * @returns {{ images: Array<{ name, size, type, buffer?, paragraphIndex }> }}
 */
function extractDocxImages(fileBuffer, opts = {}) {
  const { includeBuffers = false } = opts;
  const images = [];

  try {
    const zip = new PizZip(fileBuffer);

    // 1. Build rId → media filename map from word/_rels/document.xml.rels
    const relsFile = zip.file('word/_rels/document.xml.rels');
    if (!relsFile) return { images };

    const xmlParser = new DOMParser();
    const relsDoc = xmlParser.parseFromString(relsFile.asText(), 'text/xml');
    const relElements = relsDoc.getElementsByTagName('Relationship');

    const ridToMedia = {};
    for (let i = 0; i < relElements.length; i++) {
      const type = relElements[i].getAttribute('Type') || '';
      if (!type.includes('/image')) continue;
      const rId = relElements[i].getAttribute('Id') || '';
      const target = relElements[i].getAttribute('Target') || '';
      ridToMedia[rId] = target; // e.g. "media/image1.png"
    }

    if (Object.keys(ridToMedia).length === 0) return { images };

    // 2. Build media filename → buffer lookup
    const mediaBuffers = {};
    const mediaFolder = zip.folder('word/media');
    if (mediaFolder) {
      const files = mediaFolder.file(/.*/);
      for (const f of files) {
        const shortName = f.name.replace(/^.*\//, '');
        mediaBuffers[shortName] = f.asNodeBuffer();
      }
    }

    // 3. Walk word/document.xml paragraphs to find inline images + their position
    const docFile = zip.file('word/document.xml');
    if (!docFile) return { images };

    const docXml = xmlParser.parseFromString(docFile.asText(), 'text/xml');
    const paragraphs = docXml.getElementsByTagName('w:p');
    let imageCount = 0;

    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      // Look for <a:blip r:embed="rIdX"> inside this paragraph
      const blips = paragraphs[pIdx].getElementsByTagName('a:blip');
      for (let b = 0; b < blips.length; b++) {
        const rId = blips[b].getAttribute('r:embed') || blips[b].getAttribute('r:link') || '';
        const mediaTarget = ridToMedia[rId];
        if (!mediaTarget) continue;

        const mediaShort = mediaTarget.replace(/^.*\//, '');
        const buf = mediaBuffers[mediaShort];
        if (!buf) continue;

        // Enforce limits
        if (buf.length > DOCX_IMAGE_LIMITS.MAX_IMAGE_SIZE) continue;
        if (buf.length < DOCX_IMAGE_LIMITS.MIN_IMAGE_SIZE) continue;
        if (++imageCount > DOCX_IMAGE_LIMITS.MAX_IMAGES) break;

        const entry = {
          name: mediaShort,
          size: buf.length,
          type: (mediaShort.split('.').pop() || '').toLowerCase(),
          paragraphIndex: pIdx,
          totalParagraphs: paragraphs.length
        };
        if (includeBuffers) entry.buffer = buf;
        images.push(entry);
      }
      if (imageCount > DOCX_IMAGE_LIMITS.MAX_IMAGES) break;
    }

    Logger.info('extractDocxImages: complete', {
      totalImages: images.length,
      totalParagraphs: paragraphs.length
    });
  } catch (err) {
    Logger.warn('extractDocxImages: failed', { error: err.message });
  }

  return { images };
}

/**
 * Parse DOCX file and extract text content
 * @param {Buffer} fileBuffer - The DOCX file buffer
 * @returns {Promise<string>} - Extracted text content
 */
async function parseDocx(fileBuffer) {
  try {
    // Validate input
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
      throw new Error('Invalid DOCX buffer provided');
    }

    // Check minimum ZIP file size (DOCX is a ZIP archive)
    if (fileBuffer.length < 22) {
      throw new Error('File is too small to be a valid DOCX');
    }

    // Validate ZIP magic bytes (PK header)
    const header = fileBuffer.slice(0, 4);
    if (header[0] !== 0x50 || header[1] !== 0x4B || header[2] !== 0x03 || header[3] !== 0x04) {
      throw new Error('File does not have a valid DOCX/ZIP header');
    }

    // Parse DOCX with timeout protection
    const parsePromise = mammoth.extractRawText({ buffer: fileBuffer });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('DOCX parsing timed out after 45 seconds')), 45000)
    );

    const result = await Promise.race([parsePromise, timeoutPromise]);
    
    // Validate output
    if (!result || !result.value) {
      Logger.warn('DOCX parsing returned no text');
      return '';
    }

    // Log any warnings from mammoth
    if (result.messages && result.messages.length > 0) {
      Logger.debug('DOCX parsing warnings', { warnings: result.messages });
    }

    // Strip inline difficulty labels, export noise, and clean up
    const rawText = result.value || '';
    const textContent = stripExportNoise(stripDifficultyLabels(rawText))
      .replace(/\f/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    Logger.info('DOCX parsed successfully', {
      rawLength: rawText.length,
      cleanedLength: textContent.length
    });

    return textContent;
  } catch (err) {
    Logger.error('DOCX parsing error', { error: err.message, stack: err.stack });
    throw new Error(`Failed to parse DOCX file: ${err.message}`);
  }
}

module.exports = {
  parseDocx,
  extractDocxImages,
  DOCX_IMAGE_LIMITS
};
