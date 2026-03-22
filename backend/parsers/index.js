/**
 * Central export point for all parsers
 * This module consolidates all file parsing functionality
 */

const pdfParser = require('./pdfParser');
const docxParser = require('./docxParser');
const pptxParser = require('./pptxParser');
const questionParser = require('./questionParser');
const textNormalizer = require('./textNormalizer');

module.exports = {
  // PDF Parser
  parsePdf: pdfParser.parsePdf,
  
  // DOCX Parser
  parseDocx: docxParser.parseDocx,
  extractDocxImages: docxParser.extractDocxImages,
  DOCX_IMAGE_LIMITS: docxParser.DOCX_IMAGE_LIMITS,
  
  // PPTX Parser
  parsePptx: pptxParser.parsePptxFile,
  extractStructuredContent: pptxParser.extractStructuredContent,
  PPTX_LIMITS: pptxParser.PPTX_LIMITS,
  
  // Question Parser
  parseQuestionsFromText: questionParser.parseQuestionsFromText,
  preprocessMergedQuestions: questionParser.preprocessMergedQuestions,
  sanitizeParserInput: questionParser.sanitizeParserInput,
  
  // Text Normalizer
  normalizeText: textNormalizer.normalizeText,
  cleanExtractedText: textNormalizer.cleanExtractedText,
  stripDifficultyLabels: textNormalizer.stripDifficultyLabels,
  stripExportNoise: textNormalizer.stripExportNoise,
  preprocessText: textNormalizer.preprocessMergedQuestions,
  sanitizeText: textNormalizer.sanitizeText
};
