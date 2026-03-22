const crypto = require('crypto');
const Logger = require('../logger');
const { distributedProbeSample, buildVocabularyFingerprint } = require('./coherenceService');

/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║  Course Outline Service — Parse, Detect & Structure Outlines     ║
 * ║                                                                   ║
 * ║  Detects whether submitted text is a course outline,              ║
 * ║  parses it into a structured chapter/sub-chapter map,             ║
 * ║  and computes depth tier + content hash for dedup.                ║
 * ║  Includes filename-aware detection for near-perfect accuracy.     ║
 * ║  Auto-extracts course name from content and filename.             ║
 * ║  Zero AI cost — all local processing.                             ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

// ─── DETECTION CONFIG ────────────────────────────────────────────────
const DETECTION_CONFIG = {
  confidenceThreshold: 0.65,  // Above this → auto-classify as outline (lowered for better recall)
  ambiguousLower: 0.35,       // Below this → definitely NOT an outline (no popup)
  ambiguousUpper: 0.65,       // Between lower and upper → popup confirmation needed
  structuralKeywords: [
    'week', 'module', 'lecture', 'unit', 'topic', 'session',
    'chapter', 'lesson', 'class', 'seminar', 'tutorial'
  ],
  // Filename patterns that strongly signal a course outline
  outlineFilenamePatterns: [
    /\b(syllabus|outline|toc|table[_\s-]?of[_\s-]?contents?|curriculum|course[_\s-]?plan|course[_\s-]?schedule|programme|module[_\s-]?guide|scheme[_\s-]?of[_\s-]?work|course[_\s-]?structure|course[_\s-]?outline|content[_\s-]?outline|lesson[_\s-]?plan)\b/i
  ],
  // Filename patterns that strongly signal a regular document/notes
  documentFilenamePatterns: [
    /\b(notes?|summary|cheat[_\s-]?sheet|review|handout|assignment|homework|exam|test|quiz|answer|solution|essay|report|paper|thesis|dissertation|lab[_\s-]?report|slide|presentation)\b/i
  ],
  // Depth tier thresholds based on total sub-topic count
  depthTiers: {
    full:       { maxSubTopics: 24,  wordsPerSubChapter: '400–600' },
    standard:   { maxSubTopics: 50,  wordsPerSubChapter: '250–350' },
    condensed:  { maxSubTopics: Infinity, wordsPerSubChapter: '150–200' }
  }
};

// ─── OUTLINE NUMBERING PATTERNS ──────────────────────────────────────
// Matches lines like: "Week 1:", "Module 2 -", "Lecture 3.", "Unit 4", "Topic 5:", "1.", "1)"
const HEADER_PATTERN = /^\s*(?:(?:week|module|lecture|unit|topic|session|chapter|lesson|class|seminar|tutorial)\s*(\d+)\s*[:.–\-]?\s*(.*)$|^(\d+)\s*[.):\-]\s*(.+)$)/i;

// Matches sub-topic lines: "• item", "- item", "* item", "\t item", "  item" (indented)
const SUB_TOPIC_PATTERN = /^\s*(?:[•\-\*▪▸►◦‣→]\s+|\d+\.\s+|\(\d+\)\s+|\t+\s*)/;

/**
 * Detect whether input text is a course outline.
 * Returns confidence score + structural signals.
 * Optionally uses filename for stronger signal detection.
 *
 * @param {string} text — Extracted text (from paste, OCR, or file parser)
 * @param {string} [fileName] — Original filename (e.g. "BIO201_course_outline.pdf")
 * @returns {{ isOutline: boolean, confidence: number, signals: Object, autoCourseName: string|null }}
 */
function detectCourseOutline(text, fileName = '') {
  if (!text || typeof text !== 'string' || text.trim().length < 30) {
    return { isOutline: false, confidence: 0, signals: {}, autoCourseName: null };
  }

  const lines = text.split('\n').map(l => l.trimEnd()).filter(l => l.trim().length > 0);
  const totalLines = lines.length;
  if (totalLines < 3) {
    return { isOutline: false, confidence: 0, signals: { reason: 'too_few_lines' }, autoCourseName: null };
  }

  let score = 0;
  const signals = {};

  // ── Signal 0 (NEW): Filename analysis — strongest early signal ──
  const cleanedFileName = (fileName || '').replace(/\.[^.]+$/, '').replace(/[_\-]/g, ' ').trim();
  signals.fileName = cleanedFileName || '(none)';

  if (cleanedFileName) {
    const isOutlineFilename = DETECTION_CONFIG.outlineFilenamePatterns.some(p => p.test(cleanedFileName));
    const isDocumentFilename = DETECTION_CONFIG.documentFilenamePatterns.some(p => p.test(cleanedFileName));
    signals.filenameIsOutline = isOutlineFilename;
    signals.filenameIsDocument = isDocumentFilename;

    if (isOutlineFilename) {
      score += 0.35;  // Very strong signal — "course_outline.pdf" is almost certainly an outline
    } else if (isDocumentFilename) {
      score -= 0.35;  // Strong anti-signal — "quiz.pdf", "notes.pdf" etc. are not outlines
    }
  }

  // ── Signal 0b (NEW): Question-content detection — strong anti-outline signal ──
  // Lines ending in '?' or starting with Q1/Q2 patterns are quiz questions, not outline headers
  const questionLines = lines.filter(l => {
    const trimmed = l.trim();
    return trimmed.endsWith('?') ||
           /^Q\d+[\s.):\-]/i.test(trimmed) ||
           /^question\s*\d+/i.test(trimmed);
  });
  const questionRatio = questionLines.length / totalLines;
  signals.questionLineCount = questionLines.length;
  if (questionLines.length >= 3) score -= 0.25;
  if (questionRatio > 0.15) score -= 0.2;

  // ── Signal 0c: MCQ answer-choice pattern — lines starting with A./B./C./D. ──
  const answerChoiceLines = lines.filter(l => /^\s*[A-Da-d][.)]\s+/.test(l));
  signals.answerChoiceCount = answerChoiceLines.length;
  if (answerChoiceLines.length >= 4) score -= 0.15;

  // ── Signal 1: Structural keyword detection (week/module/lecture etc.) ──
  const keywordMatches = lines.filter(l => HEADER_PATTERN.test(l));
  const keywordRatio = keywordMatches.length / totalLines;
  signals.headerLineCount = keywordMatches.length;
  signals.headerRatio = Math.round(keywordRatio * 1000) / 1000;
  if (keywordMatches.length >= 2) score += 0.25;
  if (keywordMatches.length >= 4) score += 0.15;
  // Sanity: real outlines rarely have 20+ chapters — likely quiz numbered items
  if (keywordMatches.length > 20) score -= 0.2;

  // ── Signal 2: Structural keyword vocabulary ──
  const lowerText = text.toLowerCase();
  const foundKeywords = DETECTION_CONFIG.structuralKeywords.filter(kw => lowerText.includes(kw));
  signals.foundKeywords = foundKeywords;
  if (foundKeywords.length >= 1) score += 0.1;
  if (foundKeywords.length >= 3) score += 0.1;

  // ── Signal 3: Indented/bullet sub-items ──
  const subTopicLines = lines.filter(l => SUB_TOPIC_PATTERN.test(l));
  const subTopicRatio = subTopicLines.length / totalLines;
  signals.subTopicLineCount = subTopicLines.length;
  signals.subTopicRatio = Math.round(subTopicRatio * 1000) / 1000;
  if (subTopicLines.length >= 4) score += 0.15;
  if (subTopicRatio > 0.3) score += 0.1;

  // ── Signal 4: Short lines (outlines have short noun-phrase items, not long paragraphs) ──
  const avgLineLength = lines.reduce((sum, l) => sum + l.trim().length, 0) / totalLines;
  signals.avgLineLength = Math.round(avgLineLength);
  if (avgLineLength < 80) score += 0.1;   // outline-like
  if (avgLineLength < 50) score += 0.05;  // strongly outline-like
  if (avgLineLength > 150) score -= 0.2;  // looks like prose, not outline

  // ── Signal 5: Numbered progression (1, 2, 3... or Week 1, Week 2, Week 3...) ──
  const numbers = keywordMatches.map(l => {
    const m = l.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }).filter(n => n !== null);
  const hasProgression = numbers.length >= 2 && numbers.every((n, i) => i === 0 || n >= numbers[i - 1]);
  signals.hasProgression = hasProgression;
  if (hasProgression) score += 0.1;

  // ── Signal 6: Vocabulary fingerprint — check for academic domain terms ──
  const probeText = distributedProbeSample(text, 3, 10);
  const fp = buildVocabularyFingerprint(probeText, 20);
  signals.totalMeaningfulWords = fp.totalWords;
  // Low total words relative to lines = short items = outline-like
  if (fp.totalWords > 0 && (fp.totalWords / totalLines) < 15) score += 0.05;

  // ── Signal 7: Two-line chapter format ──
  // Textbooks and handouts often use "CHAPTER X\nTitle on next line" with no sub-bullets.
  // This pattern is unmistakably a TOC but scores low on Signal 3 (no bullet sub-topics).
  let twoLineChapterCount = 0;
  for (let _j = 0; _j < lines.length - 1; _j++) {
    const _hm = lines[_j].trim().match(HEADER_PATTERN);
    if (_hm && !(_hm[2] || _hm[4] || '').trim()) {
      // Header with no inline title — check if next filtered line is the title
      const _nextLine = lines[_j + 1].trim();
      if (_nextLine && !HEADER_PATTERN.test(_nextLine) && !SUB_TOPIC_PATTERN.test(_nextLine)) {
        twoLineChapterCount++;
      }
    }
  }
  signals.twoLineChapterCount = twoLineChapterCount;
  if (twoLineChapterCount >= 2) score += 0.15;
  if (twoLineChapterCount >= 4) score += 0.10;

  // Clamp score to [0, 1]
  const confidence = Math.max(0, Math.min(1, score));

  // ── Auto-extract course name from text + filename ──
  const autoCourseName = extractCourseName(text, lines, cleanedFileName);

  return {
    isOutline: confidence >= DETECTION_CONFIG.confidenceThreshold,
    confidence: Math.round(confidence * 1000) / 1000,
    signals,
    autoCourseName
  };
}

/**
 * Extract course name automatically from document content and filename.
 * Tries multiple strategies in priority order:
 *  1. Explicit label in text: "Course:", "Subject:", "Programme:", "Title:"
 *  2. First non-header, non-bullet line before any chapter entry
 *  3. Cleaned filename (strip extension, underscores, common prefixes)
 *
 * @param {string} text — Full extracted text
 * @param {string[]} lines — Pre-split non-empty lines
 * @param {string} cleanedFileName — Filename without extension, underscores replaced
 * @returns {string|null}
 */
function extractCourseName(text, lines, cleanedFileName) {
  // ── Strategy 1: Explicit label ──
  const labelPatterns = [
    /^(?:course|subject|programme|program|title|module)\s*(?:name|title)?\s*[:\-–]\s*(.+)/i,
    /^(?:course\s*outline\s*(?:for|of|:))\s*(.+)/i
  ];
  for (const line of lines.slice(0, 10)) {
    const trimmed = line.trim();
    for (const pattern of labelPatterns) {
      const match = trimmed.match(pattern);
      if (match && match[1]) {
        const name = match[1].trim().replace(/["""'']/g, '').trim();
        if (name.length >= 3 && name.length <= 200) {
          return name;
        }
      }
    }
  }

  // ── Strategy 2: First non-header line before any chapter entry ──
  for (const line of lines.slice(0, 8)) {
    const trimmed = line.trim();
    if (HEADER_PATTERN.test(trimmed)) break;  // Reached first chapter — stop

    if (
      !SUB_TOPIC_PATTERN.test(trimmed) &&
      trimmed.length >= 5 &&
      trimmed.length <= 200 &&
      !/^(table\s+of\s+contents?|course\s+outline|syllabus)\s*$/i.test(trimmed)
    ) {
      // Skip lines that are just "Table of Contents" or "Course Outline" without a name
      const cleaned = trimmed
        .replace(/^(course\s*(outline|title|name)\s*[:\-–]?\s*)/i, '')
        .trim();
      if (cleaned.length >= 3) {
        return cleaned;
      }
    }
  }

  // ── Strategy 3: Filename-based extraction ──
  if (cleanedFileName && cleanedFileName.length >= 3) {
    // Remove common prefixes like "outline", "syllabus", "toc"
    const nameFromFile = cleanedFileName
      .replace(/^(course\s*outline|outline|syllabus|toc|table\s*of\s*contents?)\s*/i, '')
      .replace(/\b(20\d{2})\b/g, '')  // Remove year numbers
      .replace(/\s+/g, ' ')
      .trim();

    if (nameFromFile.length >= 3) {
      // Title-case it
      return nameFromFile
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    }
  }

  return null;
}

/**
 * Parse confirmed course outline text into a structured chapter map.
 *
 * @param {string} text — Raw outline text
 * @returns {{ chapters: Array<{ weekNumber: number, chapterTitle: string, subTopics: string[] }>, courseName: string|null, totalSubTopics: number }}
 */
function parseOutlineStructure(text) {
  if (!text || typeof text !== 'string') {
    return { chapters: [], courseName: null, totalSubTopics: 0 };
  }

  // ── OCR noise cleanup ──
  // Tesseract picks up paper edges, shadows, and marks as |, _, =, ~, ' characters.
  // Strip these from the ends of lines and from inline noise patterns.
  const cleanedText = text
    .split('\n')
    .map(line => {
      return line
        .replace(/[|_=~]+\s*$/g, '')           // trailing noise
        .replace(/^\s*[|_=~]+\s*/g, '')         // leading noise
        .replace(/\s+[|_=~]{1,}\s+/g, ' ')      // inline noise clusters (" | | " → " ")
        .replace(/^['‘’“”]+\s*/g, '')  // leading stray quotes from OCR
        .replace(/\s*[~]{2,}\s*$/g, '')          // trailing ~~ patterns
        .replace(/\s*-\s*\|\s*$/g, '')           // trailing " - |" patterns
        .trimEnd();
    })
    .join('\n');

  const lines = cleanedText.split('\n').map(l => l.trimEnd());
  const chapters = [];
  let currentChapter = null;
  let courseName = null;

  // Try to infer course name from the first non-empty line before any numbered header
  const firstNonEmpty = lines.find(l => l.trim().length > 0);
  const firstIsHeader = firstNonEmpty && HEADER_PATTERN.test(firstNonEmpty);

  if (firstNonEmpty && !firstIsHeader) {
    // Check if it looks like a title (not a sub-topic)
    const trimmed = firstNonEmpty.trim();
    if (!SUB_TOPIC_PATTERN.test(trimmed) && trimmed.length > 3 && trimmed.length < 200) {
      courseName = trimmed
        .replace(/^(course\s*(outline|title|name)\s*[:\-–]?\s*)/i, '')
        .trim();
    }
  }

  // Use indexed loop so we can lookahead for the two-line "CHAPTER X\nTitle" format
  for (let _i = 0; _i < lines.length; _i++) {
    const line = lines[_i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if this is a header line (Week/Module/Lecture X: Title)
    const headerMatch = trimmed.match(HEADER_PATTERN);
    if (headerMatch) {
      // Save previous chapter
      if (currentChapter) chapters.push(currentChapter);

      // Extract week number and title
      // Group 1,2 for named headers ("Week 1: title"), Group 3,4 for numbered ("1. title")
      const weekNum = parseInt(headerMatch[1] || headerMatch[3], 10);
      let title = (headerMatch[2] || headerMatch[4] || '').trim();

      // ── Two-line format: "CHAPTER X" on its own line, actual title on the next line ──
      // (common in textbooks / printed course outlines / scanned handouts)
      // Also trigger when title is purely OCR noise (only |, _, =, ~, spaces, punctuation)
      const isNoiseTitle = title && /^[|_=~\s.,;:'"\-–—()\[\]{}]+$/.test(title);
      if (isNoiseTitle) {
        title = ''; // discard noise, fall through to next-line lookup
      }
      if (!title) {
        let nextIdx = _i + 1;
        // skip blank lines
        while (nextIdx < lines.length && !lines[nextIdx].trim()) nextIdx++;
        if (nextIdx < lines.length) {
          const nextTrimmed = lines[nextIdx].trim();
          if (nextTrimmed && !HEADER_PATTERN.test(nextTrimmed) && !SUB_TOPIC_PATTERN.test(nextTrimmed)) {
            title = nextTrimmed;
            _i = nextIdx; // consume the title line — loop will advance past it
          }
        }
      }

      currentChapter = {
        weekNumber: weekNum,
        chapterTitle: (title || `Chapter ${weekNum}`).replace(/[\s\-–—|_=~.,;:]+$/g, '').trim(),
        subTopics: []
      };
      continue;
    }

    // If we have a current chapter, check if this line is a sub-topic
    if (currentChapter) {
      if (SUB_TOPIC_PATTERN.test(line) || (trimmed.length < 150 && !trimmed.endsWith('.'))) {
        // Clean the sub-topic text
        const cleaned = trimmed
          .replace(/^\s*[•\-\*▪▸►◦‣→]\s+/, '')    // remove bullet
          .replace(/^\s*\d+[.)]\s+/, '')             // remove numbered prefix
          .replace(/^\s*\(\d+\)\s+/, '')             // remove (1) prefix
          .trim();
        if (cleaned.length > 2) {
          currentChapter.subTopics.push(cleaned);
        }
      }
    }
  }

  // Push last chapter
  if (currentChapter) chapters.push(currentChapter);

  // Re-number chapters sequentially if numbers are out of order or missing
  chapters.forEach((ch, idx) => {
    if (!ch.weekNumber || isNaN(ch.weekNumber)) {
      ch.weekNumber = idx + 1;
    }
  });

  const totalSubTopics = chapters.reduce((sum, ch) => sum + ch.subTopics.length, 0);

  Logger.info('Course outline parsed', {
    chapters: chapters.length,
    totalSubTopics,
    courseName: courseName || '(not inferred)'
  });

  return { chapters, courseName, totalSubTopics };
}

/**
 * Determine depth tier from sub-topic count and optional user plan level.
 *
 * @param {number} totalSubTopics
 * @param {string} [userTier='pro'] — 'free', 'pro', 'business', 'enterprise'
 * @returns {'full' | 'standard' | 'condensed'}
 */
function determineDepthTier(totalSubTopics, userTier = 'pro') {
  // Business/Enterprise always get full depth
  if (userTier === 'business' || userTier === 'enterprise') {
    return 'full';
  }

  if (totalSubTopics <= DETECTION_CONFIG.depthTiers.full.maxSubTopics) {
    return 'full';
  }
  if (totalSubTopics <= DETECTION_CONFIG.depthTiers.standard.maxSubTopics) {
    return 'standard';
  }
  return 'condensed';
}

/**
 * Generate a SHA-256 hash of the outline text for dedup.
 * @param {string} text
 * @returns {string}
 */
function hashOutlineContent(text) {
  return crypto.createHash('sha256').update(text.trim()).digest('hex');
}

/**
 * Full pre-flight: detect, parse, compute tier and hash.
 * Called by the /parse route before generation starts.
 * Now accepts filename for enhanced detection accuracy.
 *
 * @param {string} text — Raw text (from OCR, parser, or paste)
 * @param {string} [userTier='pro']
 * @param {string} [fileName=''] — Original filename for detection signals
 * @returns {Object}
 */
function analyzeOutline(text, userTier = 'pro', fileName = '') {
  const detection = detectCourseOutline(text, fileName);
  const parsed = parseOutlineStructure(text);
  const depthTier = determineDepthTier(parsed.totalSubTopics, userTier);
  const contentHash = hashOutlineContent(text);

  // Use auto-detected course name from detection, fall back to parser's inference
  const autoCourseName = detection.autoCourseName || parsed.courseName;

  // Determine confirmation behavior:
  // - confidence >= 0.65 → auto-classify as outline, no popup needed
  // - confidence 0.35–0.64 → show friendly popup confirmation
  // - confidence < 0.35 → definitely not an outline, no popup
  const needsConfirmation = !detection.isOutline &&
    detection.confidence >= DETECTION_CONFIG.ambiguousLower &&
    detection.confidence < DETECTION_CONFIG.confidenceThreshold;

  return {
    // Detection
    isOutline: detection.isOutline,
    confidence: detection.confidence,
    confirmationNeeded: needsConfirmation,

    // Auto-extracted course name (null if extraction failed)
    autoCourseName,

    // Parsed structure
    chapters: parsed.chapters,
    courseName: autoCourseName || parsed.courseName,
    totalChapters: parsed.chapters.length,
    totalSubTopics: parsed.totalSubTopics,

    // Generation config
    depthTier,
    contentHash,

    // Signals for debugging / logging
    detectionSignals: detection.signals
  };
}

module.exports = {
  detectCourseOutline,
  parseOutlineStructure,
  extractCourseName,
  determineDepthTier,
  hashOutlineContent,
  analyzeOutline,
  DETECTION_CONFIG
};
