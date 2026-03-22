const Logger = require('../logger');

/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║  Coherence Service — Topic Coherence Analysis for Multi-File  ║
 * ║                                                               ║
 * ║  Distributed probe sampling + vocabulary fingerprinting       ║
 * ║  Determines if uploaded files share a common topic            ║
 * ║  Zero AI cost — all local NLP                                 ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

// ─── STOP WORDS ─────────────────────────────────────────────────
// Common English words that carry no topic signal
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'this', 'that',
  'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'them',
  'its', 'his', 'her', 'our', 'their', 'my', 'your', 'what', 'which',
  'who', 'whom', 'how', 'when', 'where', 'why', 'not', 'no', 'nor',
  'as', 'if', 'then', 'so', 'than', 'too', 'very', 'just', 'also',
  'about', 'above', 'after', 'before', 'between', 'into', 'through',
  'during', 'until', 'while', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'only', 'own', 'same', 'there',
  'here', 'all', 'any', 'many', 'much', 'new', 'old', 'first', 'last',
  'long', 'great', 'little', 'right', 'big', 'high', 'small', 'part',
  'use', 'used', 'using', 'make', 'made', 'take', 'taken', 'give',
  'given', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'page', 'note', 'notes', 'chapter', 'section',
  'following', 'example', 'answer', 'question', 'questions', 'below',
  'above', 'see', 'figure', 'table', 'true', 'false', 'yes', 'end',
  'get', 'set', 'let', 'say', 'said', 'like', 'know', 'think', 'well',
  'come', 'go', 'went', 'thing', 'work', 'way', 'need', 'show', 'try'
]);

// ─── CONFIG ─────────────────────────────────────────────────────
const COHERENCE_CONFIG = {
  probePositions: 7,         // Number of positions to sample from each file
  linesPerProbe: 20,         // Lines to read at each probe position
  topVocabWords: 80,         // Top-N words for fingerprint (increased from 40 — captures shared domain words alongside file-specific jargon)
  coherenceThreshold: 0.07,  // Minimum pairwise overlap to be "coherent" (7%) — course sub-chapters share less surface vocab than same-topic docs
  minWordLength: 3,          // Minimum word length to consider
};

/**
 * Take distributed probe samples from text at evenly spaced positions.
 * Returns concatenated probe text for fingerprinting.
 * 
 * @param {string} text — Full extracted text
 * @param {number} positions — Number of probe positions (default: 7)
 * @param {number} linesPerProbe — Lines to extract at each position (default: 20)
 * @returns {string} Combined probe text
 */
function distributedProbeSample(text, positions = COHERENCE_CONFIG.probePositions, linesPerProbe = COHERENCE_CONFIG.linesPerProbe) {
  if (!text || typeof text !== 'string') return '';

  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return '';

  // If the file has fewer lines than we'd sample, just use all of it
  if (lines.length <= positions * linesPerProbe) {
    return lines.join('\n');
  }

  const probeTexts = [];

  for (let i = 0; i < positions; i++) {
    // Calculate probe position as percentage of total lines
    // Positions: 5%, 20%, 35%, 50%, 65%, 80%, 95%
    const pct = (5 + (i * 90 / (positions - 1))) / 100;
    const startLine = Math.floor(pct * lines.length);
    const endLine = Math.min(startLine + linesPerProbe, lines.length);

    const probeSlice = lines.slice(startLine, endLine).join('\n');
    probeTexts.push(probeSlice);
  }

  return probeTexts.join('\n');
}

/**
 * Build a vocabulary fingerprint from text.
 * Extracts the top-N most frequent meaningful words (excluding stop words).
 * 
 * @param {string} text — Text to fingerprint (probe sample or full text)
 * @param {number} topN — Number of top words to include (default: 40)
 * @returns {{ words: Set<string>, frequencies: Map<string, number>, totalWords: number }}
 */
/**
 * Lightweight suffix stripping to normalise plural/verb forms.
 * e.g. arrays→array, functions→function, errors→error, handling→handl
 * This improves cross-file matching for course materials with the same
 * domain vocabulary used in different grammatical forms.
 */
function stemWord(w) {
  if (w.length <= 4) return w;
  if (w.endsWith('ing') && w.length > 6) return w.slice(0, -3);
  if (w.endsWith('tion') && w.length > 6) return w.slice(0, -4);
  if (w.endsWith('ies') && w.length > 5) return w.slice(0, -3) + 'y';
  if (w.endsWith('ness') && w.length > 6) return w.slice(0, -4);
  if (w.endsWith('ment') && w.length > 6) return w.slice(0, -4);
  if (w.endsWith('ed') && w.length > 5) return w.slice(0, -2);
  if (w.endsWith('er') && w.length > 5) return w.slice(0, -2);
  if (w.endsWith('ly') && w.length > 5) return w.slice(0, -2);
  if (w.endsWith('s') && w.length > 4) return w.slice(0, -1);
  return w;
}

function buildVocabularyFingerprint(text, topN = COHERENCE_CONFIG.topVocabWords) {
  if (!text || typeof text !== 'string') {
    return { words: new Set(), frequencies: new Map(), totalWords: 0 };
  }

  const wordFreq = new Map();
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(w =>
    w.length >= COHERENCE_CONFIG.minWordLength && !STOP_WORDS.has(w)
  );

  for (const raw of tokens) {
    const word = stemWord(raw);
    if (STOP_WORDS.has(word)) continue;
    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
  }

  // Sort by frequency descending, take top N
  const sorted = [...wordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  const topWords = new Set(sorted.map(([w]) => w));
  const topFreqs = new Map(sorted);

  return {
    words: topWords,
    frequencies: topFreqs,
    totalWords: tokens.length
  };
}

/**
 * Calculate pairwise coherence score between two vocabulary fingerprints.
 * Uses overlap coefficient: |intersection| / min(|A|, |B|)
 *
 * This is more appropriate than Jaccard for course sub-chapters, where each
 * file's vocabulary is a different slice of the same domain. The overlap
 * coefficient answers "what fraction of the smaller file's keywords also
 * appear in the larger file?" rather than penalising the total vocabulary
 * diversity across both files.
 *
 * @param {Set<string>} wordsA — Vocabulary set A
 * @param {Set<string>} wordsB — Vocabulary set B
 * @returns {number} Overlap score between 0.0 and 1.0
 */
function pairwiseCoherenceScore(wordsA, wordsB) {
  if (!wordsA || !wordsB || wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const minSize = Math.min(wordsA.size, wordsB.size);
  return minSize > 0 ? intersection / minSize : 0;
}

/**
 * Analyze coherence across multiple files.
 * Runs distributed probe sampling → vocabulary fingerprinting → pairwise scoring.
 * 
 * @param {Array<{ fileName: string, text: string }>} files — Extracted text per file
 * @returns {{
 *   coherenceLevel: 'all_coherent' | 'partial' | 'all_divergent',
 *   overallScore: number,
 *   pairScores: Array<{ fileA: string, fileB: string, score: number }>,
 *   fileFingerprints: Array<{ fileName: string, topWords: string[] }>,
 *   outlierFiles: string[],
 *   coherentFiles: string[],
 *   coherenceMessage: string
 * }}
 */
/** Yield the event loop so other I/O callbacks (and cron ticks) can run between files. */
const _yieldLoop = () => new Promise(resolve => setImmediate(resolve));

async function analyzeCoherence(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return {
      coherenceLevel: 'all_coherent',
      overallScore: 1.0,
      pairScores: [],
      fileFingerprints: [],
      outlierFiles: [],
      coherentFiles: [],
      coherenceMessage: 'No files to analyze'
    };
  }

  // Single file — always coherent with itself
  if (files.length === 1) {
    return {
      coherenceLevel: 'all_coherent',
      overallScore: 1.0,
      pairScores: [],
      fileFingerprints: [{
        fileName: files[0].fileName,
        topWords: [...buildVocabularyFingerprint(distributedProbeSample(files[0].text)).words].slice(0, 10)
      }],
      outlierFiles: [],
      coherentFiles: [files[0].fileName],
      coherenceMessage: 'Single file — coherence check skipped'
    };
  }

  // Step 1: Probe sample + fingerprint each file
  // Yield between files so cron ticks and I/O callbacks aren’t starved
  const fingerprints = [];
  for (const file of files) {
    const probeText = distributedProbeSample(file.text);
    const fp = buildVocabularyFingerprint(probeText);
    fingerprints.push({ fileName: file.fileName, ...fp });
    await _yieldLoop();
  }

  // Step 2: Pairwise coherence scoring
  const pairScores = [];
  for (let i = 0; i < fingerprints.length; i++) {
    for (let j = i + 1; j < fingerprints.length; j++) {
      const score = pairwiseCoherenceScore(fingerprints[i].words, fingerprints[j].words);
      pairScores.push({
        fileA: fingerprints[i].fileName,
        fileB: fingerprints[j].fileName,
        score: Math.round(score * 1000) / 1000
      });
    }
  }

  // Step 3: Determine coherence per-file (average score with all other files)
  const fileScores = fingerprints.map((fp, idx) => {
    const relevantPairs = pairScores.filter(p =>
      p.fileA === fp.fileName || p.fileB === fp.fileName
    );
    const avgScore = relevantPairs.length > 0
      ? relevantPairs.reduce((sum, p) => sum + p.score, 0) / relevantPairs.length
      : 0;
    return { fileName: fp.fileName, avgScore };
  });

  const threshold = COHERENCE_CONFIG.coherenceThreshold;
  const coherentFiles = fileScores.filter(f => f.avgScore >= threshold).map(f => f.fileName);
  const outlierFiles = fileScores.filter(f => f.avgScore < threshold).map(f => f.fileName);

  // Step 4: Classify overall coherence level
  let coherenceLevel;
  let coherenceMessage;

  if (outlierFiles.length === 0) {
    coherenceLevel = 'all_coherent';
    coherenceMessage = 'All files share a common topic. Questions generated from unified context.';
  } else if (coherentFiles.length > 0) {
    coherenceLevel = 'partial';
    coherenceMessage = `${outlierFiles.length} file(s) cover different topics. Questions will span all content.`;
  } else {
    coherenceLevel = 'all_divergent';
    coherenceMessage = 'Files cover different topics. Questions generated across all content.';
  }

  // Overall score = average of all pair scores
  const overallScore = pairScores.length > 0
    ? Math.round((pairScores.reduce((s, p) => s + p.score, 0) / pairScores.length) * 1000) / 1000
    : 0;

  const result = {
    coherenceLevel,
    overallScore,
    pairScores,
    fileFingerprints: fingerprints.map(fp => ({
      fileName: fp.fileName,
      topWords: [...fp.words].slice(0, 10),
      totalWords: fp.totalWords
    })),
    outlierFiles,
    coherentFiles,
    coherenceMessage
  };

  Logger.info('Coherence analysis complete', {
    coherenceLevel,
    overallScore,
    filesAnalyzed: files.length,
    coherentCount: coherentFiles.length,
    outlierCount: outlierFiles.length
  });

  return result;
}

module.exports = {
  distributedProbeSample,
  buildVocabularyFingerprint,
  pairwiseCoherenceScore,
  analyzeCoherence,
  COHERENCE_CONFIG
};
