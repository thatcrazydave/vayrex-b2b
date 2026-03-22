const Logger = require('../logger');

/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║  Question Density Service — Past Question Detection           ║
 * ║                                                               ║
 * ║  Scores files on "question-likeness" using pattern analysis   ║
 * ║  Detects past exams, quizzes, and question banks              ║
 * ║  Highest-scoring file becomes the style anchor for generation ║
 * ║  Zero AI cost — all local pattern matching                    ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

// ─── CONFIG ─────────────────────────────────────────────────────
const DENSITY_CONFIG = {
  // Minimum score to be considered as having ANY question patterns
  minFloorScore: 5,
  // Sample size for density scoring (first N characters + distributed probes)
  maxSampleChars: 15000,
};

// ─── PATTERN DEFINITIONS ────────────────────────────────────────
// Each pattern has a weight reflecting how strongly it indicates question content
const QUESTION_PATTERNS = [
  {
    name: 'numbered_question',
    // Matches: 1. , 2) , Q3: , Question 4. , etc.
    regex: /^(?:q(?:uestion)?\s*)?(\d{1,3})\s*[.):\-]\s*.{10,}/gim,
    weight: 3,
    description: 'Numbered question lines (1. What is... / Q2: Explain...)'
  },
  {
    name: 'option_pattern_letter',
    // Matches: A) , B. , (C) , a) , etc.
    regex: /^\s*\(?[A-Ea-e][.)]\s*.{2,}/gm,
    weight: 2,
    description: 'Multiple choice option lines (A) ... B) ... C) ...)'
  },
  {
    name: 'option_pattern_roman',
    // Matches: i) , ii. , (iii) , etc.
    regex: /^\s*\(?(?:i{1,3}|iv|vi{0,3})[.)]\s*.{2,}/gm,
    weight: 1.5,
    description: 'Roman numeral options (i) ... ii) ... iii) ...)'
  },
  {
    name: 'question_mark_density',
    // Count question marks per 1000 characters
    regex: /\?/g,
    weight: 0.5,
    perThousandChars: true,
    description: 'Question mark frequency (higher = more question-like)'
  },
  {
    name: 'answer_marker',
    // Matches: Answer: , Ans: , Solution: , Correct answer: , etc.
    regex: /^\s*(?:answer|ans|solution|correct\s*answer|key)\s*[:=]\s*/gim,
    weight: 4,
    description: 'Answer/solution markers'
  },
  {
    name: 'marks_allocation',
    // Matches: (2 marks) , [5 pts] , (10 points) , etc.
    regex: /[\[(]\s*\d{1,3}\s*(?:marks?|pts?|points?)\s*[\])]/gi,
    weight: 5,
    description: 'Mark allocation indicators (2 marks, 5 pts)'
  },
  {
    name: 'exam_header',
    // Matches: Examination, Final Exam, Mid-term Test, Quiz, etc.
    regex: /(?:examination|final\s*exam|mid[\s-]*term|test\s*\d|quiz\s*\d|past\s*question|sample\s*exam)/gi,
    weight: 6,
    description: 'Exam header terms'
  },
  {
    name: 'instruction_line',
    // Matches: Answer ALL questions, Choose the best answer, etc.
    regex: /(?:answer\s+(?:all|any)|choose\s+the\s+(?:best|correct)|select\s+(?:one|the)|circle\s+the|tick\s+the|fill\s+in\s+the\s+blank|true\s+or\s+false)/gi,
    weight: 4,
    description: 'Exam instruction patterns'
  },
  {
    name: 'section_marker',
    // Matches: Section A, Part B, Paper 1, etc.
    regex: /^\s*(?:section|part|paper)\s+[A-Za-z0-9]{1,3}\s*[:.\-]?\s*/gim,
    weight: 2,
    description: 'Exam section markers (Section A, Part B)'
  }
];

/**
 * Score the question density of a text.
 * Higher score = more likely to be a past question/exam paper.
 * 
 * @param {string} text — Extracted text from one file
 * @returns {{
 *   score: number,
 *   normalizedScore: number,
 *   patternBreakdown: Array<{ name: string, matches: number, weightedScore: number }>,
 *   isLikelyPastQuestion: boolean,
 *   confidence: 'high' | 'medium' | 'low' | 'none'
 * }}
 */
function scoreQuestionDensity(text) {
  if (!text || typeof text !== 'string' || text.trim().length < 50) {
    return {
      score: 0,
      normalizedScore: 0,
      patternBreakdown: [],
      isLikelyPastQuestion: false,
      confidence: 'none'
    };
  }

  // Sample the text (probes from start, middle, end for representative scoring)
  const sample = _getScoringample(text, DENSITY_CONFIG.maxSampleChars);
  const sampleLength = sample.length;
  const thousandCharUnits = sampleLength / 1000;

  let totalScore = 0;
  const patternBreakdown = [];

  for (const pattern of QUESTION_PATTERNS) {
    // Reset regex (global flag means lastIndex needs resetting)
    pattern.regex.lastIndex = 0;
    const matches = sample.match(pattern.regex) || [];
    const matchCount = matches.length;

    let weightedScore;
    if (pattern.perThousandChars) {
      // Normalize by text length (per 1000 chars)
      const density = thousandCharUnits > 0 ? matchCount / thousandCharUnits : 0;
      weightedScore = density * pattern.weight;
    } else {
      weightedScore = matchCount * pattern.weight;
    }

    // Reset regex lastIndex for safety
    pattern.regex.lastIndex = 0;

    totalScore += weightedScore;

    patternBreakdown.push({
      name: pattern.name,
      matches: matchCount,
      weightedScore: Math.round(weightedScore * 100) / 100
    });
  }

  // Normalize score to 0-100 range
  // Typical past exam paper scores 40-80+, notes score 0-15
  const normalizedScore = Math.min(100, Math.round(totalScore * 2));

  // Confidence classification
  let confidence;
  if (normalizedScore >= 50) confidence = 'high';
  else if (normalizedScore >= 25) confidence = 'medium';
  else if (normalizedScore >= DENSITY_CONFIG.minFloorScore) confidence = 'low';
  else confidence = 'none';

  return {
    score: Math.round(totalScore * 100) / 100,
    normalizedScore,
    patternBreakdown,
    isLikelyPastQuestion: normalizedScore >= 25,
    confidence
  };
}

/**
 * Detect the style anchor file from a set of files.
 * The file with the highest question density becomes the template for AI generation.
 * 
 * @param {Array<{ fileName: string, text: string }>} files — Files with extracted text
 * @returns {{
 *   anchorFile: string | null,
 *   anchorScore: number,
 *   anchorText: string,
 *   isStyleAnchor: boolean,
 *   fileScores: Array<{ fileName: string, score: number, normalizedScore: number, confidence: string }>,
 *   contentFiles: string[]
 * }}
 */
/** Yield the event loop so other I/O callbacks (and cron ticks) can run between files. */
const _yieldLoop = () => new Promise(resolve => setImmediate(resolve));

async function detectStyleAnchor(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return {
      anchorFile: null,
      anchorScore: 0,
      anchorText: '',
      isStyleAnchor: false,
      fileScores: [],
      contentFiles: []
    };
  }

  // Score each file for question density, yielding between files to avoid
  // monopolising the event loop during CPU-bound regex work
  const fileScores = [];
  for (const file of files) {
    const densityResult = scoreQuestionDensity(file.text);
    fileScores.push({ fileName: file.fileName, text: file.text, ...densityResult });
    await _yieldLoop();
  }

  // Sort by score descending — highest density file is the candidate anchor
  fileScores.sort((a, b) => b.normalizedScore - a.normalizedScore);

  const topFile = fileScores[0];
  const isStyleAnchor = topFile.normalizedScore >= DENSITY_CONFIG.minFloorScore;

  // Extract exemplar questions from the anchor file for prompt injection
  let anchorText = '';
  if (isStyleAnchor) {
    anchorText = _extractExemplarQuestions(topFile.text);
  }

  // All files except the anchor are "content files"
  const contentFiles = isStyleAnchor
    ? fileScores.slice(1).map(f => f.fileName)
    : fileScores.map(f => f.fileName);

  const result = {
    anchorFile: isStyleAnchor ? topFile.fileName : null,
    anchorScore: topFile.normalizedScore,
    anchorText,
    isStyleAnchor,
    fileScores: fileScores.map(f => ({
      fileName: f.fileName,
      score: f.score,
      normalizedScore: f.normalizedScore,
      confidence: f.confidence,
      isLikelyPastQuestion: f.isLikelyPastQuestion
    })),
    contentFiles
  };

  Logger.info('Style anchor detection complete', {
    anchorFile: result.anchorFile,
    anchorScore: result.anchorScore,
    isStyleAnchor: result.isStyleAnchor,
    filesScored: fileScores.length
  });

  return result;
}

// ─── INTERNAL HELPERS ───────────────────────────────────────────

/**
 * Get a representative sample of text for scoring.
 * Takes text from beginning (10%), middle (40-60%), and end (90%).
 */
function _getScoringample(text, maxChars) {
  if (text.length <= maxChars) return text;

  const chunkSize = Math.floor(maxChars / 3);
  const startChunk = text.substring(0, chunkSize);
  const midStart = Math.floor(text.length * 0.4);
  const midChunk = text.substring(midStart, midStart + chunkSize);
  const endStart = Math.max(0, text.length - chunkSize);
  const endChunk = text.substring(endStart);

  return startChunk + '\n\n' + midChunk + '\n\n' + endChunk;
}

/**
 * Extract the first 5-10 question-like blocks from text for use as style exemplars.
 * These are injected into the AI prompt as format references.
 */
function _extractExemplarQuestions(text) {
  if (!text) return '';

  const lines = text.split('\n');
  const exemplars = [];
  let currentQuestion = [];
  let collecting = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect question start: numbered line or "Q" prefix
    const isQuestionStart = /^(?:q(?:uestion)?\s*)?\d{1,3}\s*[.):\-]\s*.{10,}/i.test(trimmed);

    if (isQuestionStart) {
      // Save the previous collected question
      if (collecting && currentQuestion.length > 0) {
        exemplars.push(currentQuestion.join('\n'));
        if (exemplars.length >= 5) break;
      }
      currentQuestion = [trimmed];
      collecting = true;
      continue;
    }

    // Collect option lines and answer lines as part of the current question
    if (collecting) {
      const isOption = /^\s*\(?[A-Ea-e][.)]\s*.{2,}/i.test(trimmed);
      const isAnswer = /^\s*(?:answer|ans|solution|correct)\s*[:=]\s*/i.test(trimmed);
      const isEmpty = trimmed.length === 0;

      if (isOption || isAnswer) {
        currentQuestion.push(trimmed);
      } else if (isEmpty && currentQuestion.length > 1) {
        // End of question block
        exemplars.push(currentQuestion.join('\n'));
        currentQuestion = [];
        collecting = false;
        if (exemplars.length >= 5) break;
      } else if (trimmed.length > 5) {
        // Continuation line (multiline question text)
        currentQuestion.push(trimmed);
      }
    }
  }

  // Don't forget the last collected question
  if (collecting && currentQuestion.length > 0 && exemplars.length < 5) {
    exemplars.push(currentQuestion.join('\n'));
  }

  if (exemplars.length === 0) return '';

  return exemplars.join('\n\n---\n\n');
}

module.exports = {
  scoreQuestionDensity,
  detectStyleAnchor,
  DENSITY_CONFIG,
  QUESTION_PATTERNS
};
