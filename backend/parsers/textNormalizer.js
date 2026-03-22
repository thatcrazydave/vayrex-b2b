const Logger = require('../logger');

/**
 * Normalize text by fixing line endings and excessive whitespace
 * @param {string} text - Raw text to normalize
 * @returns {string} - Normalized text
 */
function normalizeText(text) {
  if (!text) return "";

  let t = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n");

  return t.trim();
}

// Difficulty labels that may appear inline in exported quiz PDFs/DOCXs.
// Matches: [Easy] [Medium] [Hard] [Very Easy] [Very Hard] [Difficulty: Medium]
// Also bare suffixes:  — Easy   /Easy  (Easy)  (Difficulty: Hard)
const DIFFICULTY_PATTERN = /(?:^|\s)(?:\[(?:difficulty:\s*)?(?:very\s+)?(?:easy|medium|hard|beginner|intermediate|advanced|expert)\]|\((?:difficulty:\s*)?(?:very\s+)?(?:easy|medium|hard|beginner|intermediate|advanced|expert)\)|—\s*(?:very\s+)?(?:easy|medium|hard|beginner|intermediate|advanced|expert)|[/|]\s*(?:very\s+)?(?:easy|medium|hard|beginner|intermediate|advanced|expert))(?=\s|$)/gi;

/**
 * Strip inline difficulty labels that quiz-export tools embed next to options/questions.
 * e.g. "D) Photosynthesis [Medium]" → "D) Photosynthesis"
 */
function stripDifficultyLabels(text) {
  if (!text) return '';
  return text
    // bracket form: [Easy] [Medium] [Hard] [Very Hard] [Difficulty: Medium]
    .replace(/\s*\[(?:difficulty:\s*)?(?:very\s+)?(?:easy|medium|hard|beginner|intermediate|advanced|expert)\]/gi, '')
    // paren form: (Easy) (Difficulty: Hard)
    .replace(/\s*\((?:difficulty:\s*)?(?:very\s+)?(?:easy|medium|hard|beginner|intermediate|advanced|expert)\)/gi, '')
    // dash/pipe separator form: " — Medium"  " | Hard"
    .replace(/\s+[—–|/]\s*(?:very\s+)?(?:easy|medium|hard|beginner|intermediate|advanced|expert)(?=\s|$)/gi, '')
    // standalone lines that are only a difficulty label
    .replace(/^\s*(?:difficulty[:\s]+)?(?:very\s+)?(?:easy|medium|hard|beginner|intermediate|advanced|expert)\s*$/gim, '')
    // "Difficulty: Easy" anywhere on its own or after a colon
    .replace(/difficulty\s*:\s*(?:very\s+)?(?:easy|medium|hard|beginner|intermediate|advanced|expert)/gi, '');
}

/**
 * Strip Vayrex PDF/DOCX export noise (watermarks, footers, title-page boilerplate,
 * answer-key headers) so re-uploaded exports yield clean question text.
 */
function stripExportNoise(text) {
  if (!text) return '';
  return text
    .replace(/\bVAYREX\b/g, '')
    .replace(/^\s*Page\s+\d+\s+of\s+\d+\s*[|].*$/gim, '')
    .replace(/^\s*Vayrex\s+Learning\s+Platform\s*$/gim, '')
    .replace(/^\s*Generated\s+by\s+Vayrex\s+Learning\s+Platform\s*$/gim, '')
    .replace(/^\s*Question\s+Bank\s*$/gim, '')
    .replace(/^\s*Examination\s+Paper\s*$/gim, '')
    .replace(/^\s*Prepared\s+for:\s*.*/gim, '')
    .replace(/^\s*Total\s+Questions:\s*\d+\s*$/gim, '')
    .replace(/^\s*Generated:\s*.+$/gim, '')
    .replace(/^\s*Vayrex\s+Learning\s*$/gim, '')
    .replace(/^\s*Answer\s+Key\s*$/gim, '')
    .replace(/^\s*\[(?:EASY|MEDIUM|HARD)\]\s*$/gm, '');
}

/**
 * Clean extracted text by removing page numbers, difficulty labels, figures, etc.
 * @param {string} raw - Raw extracted text
 * @returns {string} - Cleaned text
 */
function cleanExtractedText(raw) {
  if (!raw) return "";

  let t = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  // Strip inline difficulty labels (e.g. [Medium] appended to options)
  t = stripDifficultyLabels(t);

  // Remove page numbers, table/figure captions
  t = t.replace(/page\s*\d+/gi, "");
  t = t.replace(/table\s*\d+/gi, "");
  t = t.replace(/figure\s*\d+/gi, "");
  // Remove soft-hyphen line breaks from PDF extraction
  t = t.replace(/-\n/g, "");
  // Remove PDF form-feed characters
  t = t.replace(/\f/g, "\n");
  // Collapse runs of blank lines
  t = t.replace(/\n{3,}/g, "\n\n");
  // Remove trailing whitespace on each line
  t = t.replace(/[\t ]+$/gm, "");

  return t.trim();
}

/**
 * Preprocess text to split merged questions
 * @param {string} text - Text with potentially merged questions
 * @returns {string} - Text with split questions
 */
function preprocessMergedQuestions(text) {
  Logger.info('Preprocessing: Splitting merged questions');
  
  let processed = text;
  
  // STEP 1: Split "Answer: X) Question" patterns
  processed = processed
    .replace(/Answer:\s*([A-Ha-h])\)\s+(\d+\.)/gi, 'Answer: $1)\n\n$2')
    .replace(/Answer:\s*([A-Ha-h])\)\s+(What|Who|Which|When|Where|Why|How)\b/gi, 'Answer: $1)\n\n$2');
  
  // STEP 2: Split when option letter is immediately followed by question word
  processed = processed
    .replace(/([A-Ha-h])\)\s+(What|Who|Which|When|Where|Why|How)\s/g, '$1)\n\n$2 ');
  
  // STEP 3: Ensure question numbers are on new lines
  processed = processed
    .replace(/([^\n\d])\s+(\d+\.\s+[A-Z])/g, '$1\n\n$2');
  
  // STEP 4: Split mathematical expressions that follow answers
  processed = processed
    .replace(/Answer:\s*([A-Ha-h])\)\s+(What is \d+)/gi, 'Answer: $1)\n\n$2');
  
  // STEP 5: Normalize multiple spaces/newlines
  processed = processed
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ');
  
  const linesAdded = (processed.match(/\n/g) || []).length - (text.match(/\n/g) || []).length;
  
  Logger.info('Preprocessing complete', {
    originalLength: text.length,
    processedLength: processed.length,
    linesAdded
  });
  
  return processed;
}

/**
 * Sanitize text to prevent injection attacks
 * @param {string} text - Text to sanitize
 * @returns {string} - Sanitized text
 */
function sanitizeText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Remove control characters except newlines and tabs
  let sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // Remove potential NoSQL operators
  sanitized = sanitized.replace(/\$[a-zA-Z]+/g, '');
  
  // Limit total length
  const MAX_TEXT_LENGTH = 500000; // 500KB
  if (sanitized.length > MAX_TEXT_LENGTH) {
    Logger.warn('Text truncated due to size limit', {
      originalLength: sanitized.length,
      limit: MAX_TEXT_LENGTH
    });
    sanitized = sanitized.substring(0, MAX_TEXT_LENGTH);
  }

  return sanitized;
}

module.exports = {
  normalizeText,
  cleanExtractedText,
  stripDifficultyLabels,
  stripExportNoise,
  preprocessMergedQuestions,
  sanitizeText
};
