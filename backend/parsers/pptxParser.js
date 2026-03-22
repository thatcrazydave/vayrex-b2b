const PizZip = require('pizzip');
const { DOMParser } = require('@xmldom/xmldom');
const logger = require('../logger');

/**
 * PPTX Parser Security Limits
 * Prevents memory exhaustion and DoS attacks from malicious PPTX files
 */
const PPTX_LIMITS = {
  MAX_FILE_SIZE: 50 * 1024 * 1024,     // 50 MB max file size
  MAX_SLIDES: 500,                      // Maximum slides to process
  MAX_IMAGES: 200,                      // Maximum images to extract
  MAX_IMAGE_SIZE: 10 * 1024 * 1024,    // 10 MB per image
  MAX_TEXT_LENGTH: 1024 * 1024,        // 1 MB of text content max
  MAX_TABLE_CELLS: 1000,                // Maximum table cells to process
  MAX_EXTRACTION_TIME: 30000            // 30 seconds timeout
};

/**
 * Sanitize text content to prevent injection attacks
 * @param {string} text - Raw text input
 * @returns {string} Sanitized text
 */
function sanitizeText(text) {
  if (!text || typeof text !== 'string') return '';
  
  // Remove control characters except newlines and tabs
  let sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // Remove potential NoSQL operators
  sanitized = sanitized.replace(/[${}]/g, '');
  
  return sanitized.trim();
}

/**
 * Extract text content from XML
 * @param {string} xml - XML content
 * @returns {string} Extracted text
 */
function extractTextFromXml(xml) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const textNodes = doc.getElementsByTagName('a:t');
    
    let text = '';
    let charCount = 0;
    
    for (let i = 0; i < textNodes.length; i++) {
      const nodeText = textNodes[i].textContent || '';
      charCount += nodeText.length;
      
      // Enforce text length limit
      if (charCount > PPTX_LIMITS.MAX_TEXT_LENGTH) {
        logger.warn('PPTX text extraction exceeded MAX_TEXT_LENGTH limit');
        break;
      }
      
      text += nodeText + ' ';
    }
    
    return sanitizeText(text);
  } catch (error) {
    logger.error('Error extracting text from XML:', error);
    return '';
  }
}

/**
 * Extract tables from XML
 * @param {string} xml - XML content
 * @returns {Array} Extracted table data
 */
function extractTablesFromXml(xml) {
  const tables = [];
  let totalCells = 0;
  
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const tableElements = doc.getElementsByTagName('a:tbl');
    
    for (let i = 0; i < tableElements.length; i++) {
      const tableElement = tableElements[i];
      const rows = tableElement.getElementsByTagName('a:tr');
      const tableData = [];
      
      for (let j = 0; j < rows.length; j++) {
        const cells = rows[j].getElementsByTagName('a:tc');
        const rowData = [];
        
        for (let k = 0; k < cells.length; k++) {
          totalCells++;
          
          // Enforce table cell limit
          if (totalCells > PPTX_LIMITS.MAX_TABLE_CELLS) {
            logger.warn('PPTX table extraction exceeded MAX_TABLE_CELLS limit');
            return tables;
          }
          
          const cellText = extractTextFromXml(cells[k].toString());
          rowData.push(cellText);
        }
        
        tableData.push(rowData);
      }
      
      if (tableData.length > 0) {
        tables.push(tableData);
      }
    }
  } catch (error) {
    logger.error('Error extracting tables from XML:', error);
  }
  
  return tables;
}

/**
 * Extract images from PPTX (with buffers for OCR / PDF embedding)
 * @param {PizZip} zip - PizZip instance
 * @param {boolean} [includeBuffers=false] - Whether to include raw image buffers
 * @returns {Array} Image metadata (and optionally buffers)
 */
function extractImagesFromPptx(zip, includeBuffers = false) {
  const images = [];
  let imageCount = 0;
  
  try {
    const mediaFolder = zip.folder('ppt/media');
    if (!mediaFolder) return images;
    
    const files = mediaFolder.file(/.*/);
    
    for (const file of files) {
      imageCount++;
      
      // Enforce image count limit
      if (imageCount > PPTX_LIMITS.MAX_IMAGES) {
        logger.warn('PPTX image extraction exceeded MAX_IMAGES limit');
        break;
      }
      
      const content = file.asNodeBuffer();
      
      // Enforce image size limit
      if (content.length > PPTX_LIMITS.MAX_IMAGE_SIZE) {
        logger.warn(`Image ${file.name} exceeds MAX_IMAGE_SIZE, skipping`);
        continue;
      }
      
      const entry = {
        name: file.name,
        size: content.length,
        type: file.name.split('.').pop()
      };
      if (includeBuffers) entry.buffer = content;
      images.push(entry);
    }
  } catch (error) {
    logger.error('Error extracting images from PPTX:', error);
  }
  
  return images;
}

/**
 * Map images to slides using PPTX relationship XML files.
 * Reads ppt/slides/_rels/slideN.xml.rels to find which media files each slide references.
 * @param {PizZip} zip - PizZip instance
 * @param {Array} slideFiles - Sorted array of { path, file } from extractStructuredContent
 * @param {Array} imageList - Images from extractImagesFromPptx (with buffers)
 * @returns {Object} Map of slideNumber → [image entries]
 */
function mapImagesToSlides(zip, slideFiles, imageList) {
  const slideImageMap = {};
  if (!imageList || imageList.length === 0) return slideImageMap;

  // Build a lookup: normalized media filename → image entry
  const byName = {};
  for (const img of imageList) {
    // img.name is like "ppt/media/image1.png" — extract just "image1.png"
    const short = img.name.replace(/^.*\//, '');
    byName[short] = img;
  }

  const xmlParser = new DOMParser();

  for (let i = 0; i < slideFiles.length; i++) {
    const slideNum = i + 1;
    slideImageMap[slideNum] = [];

    // Relationship file path: ppt/slides/_rels/slideN.xml.rels
    const slidePath = slideFiles[i].path; // e.g. "ppt/slides/slide1.xml"
    const relsPath = slidePath.replace(/(slide\d+\.xml)$/, '_rels/$1.rels');

    try {
      const relsFile = zip.file(relsPath);
      if (!relsFile) continue;

      const relsXml = relsFile.asText();
      const doc = xmlParser.parseFromString(relsXml, 'text/xml');
      const rels = doc.getElementsByTagName('Relationship');

      for (let r = 0; r < rels.length; r++) {
        const type = rels[r].getAttribute('Type') || '';
        if (!type.includes('/image')) continue;

        const target = rels[r].getAttribute('Target') || '';
        // Target is relative, e.g. "../media/image1.png"
        const mediaName = target.replace(/^.*\//, '');
        if (byName[mediaName]) {
          slideImageMap[slideNum].push({ ...byName[mediaName], slideNumber: slideNum });
        }
      }
    } catch (err) {
      logger.warn(`Failed to read rels for slide ${slideNum}`, { error: err.message });
    }
  }

  return slideImageMap;
}

/**
 * Extract structured content from PPTX file
 * @param {PizZip} zip - PizZip instance
 * @param {boolean} [includeImageBuffers=false] - Include raw image buffers for OCR / PDF embedding
 * @returns {Object} Structured content with slides, text, tables, images
 */
function extractStructuredContent(zip, includeImageBuffers = false) {
  const content = {
    slides: [],
    allText: '',
    tables: [],
    images: []
  };
  
  try {
    // Extract slide files using the correct PizZip API
    const slideFiles = [];
    const slidesFolder = zip.folder('ppt/slides');

    if (slidesFolder) {
      const files = slidesFolder.file(/slide\d+\.xml$/);

      for (const file of files) {
        slideFiles.push({
          path: file.name,
          file: file
        });
      }
    }

    // Sort slides numerically
    slideFiles.sort((a, b) => {
      const numA = parseInt(a.path.match(/\d+/)[0]);
      const numB = parseInt(b.path.match(/\d+/)[0]);
      return numA - numB;
    });

    // Process each slide
    for (let i = 0; i < slideFiles.length; i++) {
      // Enforce slide limit
      if (i >= PPTX_LIMITS.MAX_SLIDES) {
        logger.warn('PPTX extraction exceeded MAX_SLIDES limit');
        break;
      }

      const { file } = slideFiles[i];
      const xml = file.asText();

      const slideText = extractTextFromXml(xml);
      const slideTables = extractTablesFromXml(xml);

      content.slides.push({
        slideNumber: i + 1,
        text: slideText,
        tables: slideTables
      });

      content.allText += slideText + '\n';
      content.tables.push(...slideTables);
    }
    
    // Extract images (with buffers if requested for OCR / PDF embed)
    content.images = extractImagesFromPptx(zip, includeImageBuffers);

    // Map images to slides via relationship XML
    if (includeImageBuffers && content.images.length > 0) {
      const slideImageMap = mapImagesToSlides(zip, slideFiles, content.images);
      for (const slide of content.slides) {
        slide.images = slideImageMap[slide.slideNumber] || [];
      }
    }
    
  } catch (error) {
    logger.error('Error extracting structured content from PPTX:', error);
  }
  
  return content;
}

/**
 * Check if file is old PPT format (OLE/CFB) vs modern PPTX (ZIP)
 * @param {Buffer} fileBuffer 
 * @returns {boolean} true if old PPT format
 */
function isOldPptFormat(fileBuffer) {
  // Old PPT files start with OLE/CFB signature: D0 CF 11 E0
  if (fileBuffer.length < 8) return false;
  return fileBuffer[0] === 0xD0 && 
         fileBuffer[1] === 0xCF && 
         fileBuffer[2] === 0x11 && 
         fileBuffer[3] === 0xE0;
}

/**
 * Parse PPTX file with security limits
 * @param {Buffer} fileBuffer - PPTX file buffer
 * @param {Object} [opts] - Options
 * @param {boolean} [opts.includeImageBuffers=false] - Return raw image buffers per slide
 * @returns {Promise<Object>} Extracted text content and optionally image buffers
 */

async function parsePptxFile(fileBuffer, opts = {}) {
  const { includeImageBuffers = false } = opts;
  return new Promise((resolve, reject) =>{
    const timeout = setTimeout(() => {
      reject ( new Error('PPTX extraction timeout exceeded') );
    }, PPTX_LIMITS.MAX_EXTRACTION_TIME );

    try {
      if (fileBuffer.length > PPTX_LIMITS.MAX_FILE_SIZE) {
        clearTimeout(timeout);
        return reject(new Error(`PPTX file exceeded maximum size of ${PPTX_LIMITS.MAX_FILE_SIZE / 1024 / 1024} MB`));
      }

      // Check for old PPT format
      if (isOldPptFormat(fileBuffer)) {
        clearTimeout(timeout);
        return reject(new Error('OLD_PPT_FORMAT: This appears to be an old .ppt file. Please convert it to .pptx format (Open in PowerPoint and Save As .pptx) or use PDF/Word format instead.'));
      }

    const zip = new PizZip(fileBuffer);

    const content = extractStructuredContent(zip, includeImageBuffers);

    let finalText = content.allText;

    for (const table of content.tables) {
      for (const row of table) {
        finalText += row.join(' | ') + '\n';
      }
      finalText += '\n';
    }

    const sanitizedText = sanitizeText(finalText);

    clearTimeout(timeout);

    resolve({
      allText: sanitizedText,
      metadata: {
        totalSlides: content.slides.length,
        totalImages: content.images.length,
        totalTables: content.tables.length,
        extractedAt: new Date().toISOString()
      },
      slides: content.slides,
      tables: content.tables,
      images: content.images
    });
  } catch (error) {
    clearTimeout(timeout);
    logger.error('Error parsing PPTX file:', error);
    reject(new Error('Failed to parse PPTX file: ' + error.message));
  }
});
}

module.exports = {
  parsePptxFile,
  extractTextFromXml,
  extractTablesFromXml,
  extractImagesFromPptx,
  mapImagesToSlides,
  sanitizeText,
  extractStructuredContent,
  PPTX_LIMITS
};
