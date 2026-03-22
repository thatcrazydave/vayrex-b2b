const Logger = require('../logger');

// ===== WORD NUMBER MAPPING (for "Question One", "Question Two", etc.) =====
const WORD_TO_NUM = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  'twenty-one': 21, 'twenty-two': 22, 'twenty-three': 23, 'twenty-four': 24, 'twenty-five': 25
};
const WORD_NUM_PATTERN = Object.keys(WORD_TO_NUM).sort((a, b) => b.length - a.length).join('|');
const QUESTION_HEADER_RE = new RegExp(
  '^\\s*(?:question|q)\\s+(' + WORD_NUM_PATTERN + '|\\d+)\\b[\\s.:\\-]*',
  'i'
);

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
 * Parse questions from text content
 * @param {string} text - Raw text content
 * @param {string} topic - Quiz topic
 * @param {string} sourceFile - Original filename
 * @param {string} userId - User ID
 * @returns {Array} - Array of parsed questions
 */
function parseQuestionsFromText(text, topic, sourceFile, userId) {
  if (!text || !text.trim()) {
    Logger.warn('Empty text provided to parser');
    return [];
  }

  // Sanitize text first
  text = sanitizeParserInput(text);

  // STEP 0: PREPROCESS TO SPLIT MERGED QUESTIONS
  text = preprocessMergedQuestions(text);

  // ===== DETECT DOCUMENT TYPE =====
  const docType = detectDocumentType(text);
  Logger.info('Document type detected', { docType });

  if (docType === 'theory') {
    const theoryResult = parseTheoryExam(text, topic, sourceFile, userId);
    if (theoryResult && theoryResult.length > 0) {
      Logger.info('Theory exam parsed successfully', { questions: theoryResult.length });
      return theoryResult;
    }
    Logger.info('Theory parser returned no results, falling back to MCQ parser');
  }

  // ===== CONFIGURATION =====
  const config = {
    letterToIndex: { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7 }, 
    minQuestionLength: 10,
    maxQuestionLength: 1000,
    minOptionLength: 1,
    maxOptionLength: 500,
    minOptions: 2, 
    maxOptions: 8, 
    contextWindow: 3,
  };

  // ===== PREPROCESSING =====
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length === 0) {
    Logger.warn('No lines after preprocessing');
    return [];
  }

  // ===== STATE MANAGEMENT =====
  const state = {
    questions: [],
    current: null,
    answerSection: new Map(),
    inAnswerKey: false,
    answerKeyStartLine: -1,
    trueFalseQuestions: new Set(),
    fillInBlankQuestions: new Set(),
  };

  // ===== ENHANCED REGEX PATTERNS =====
  const patterns = {
    answerKeyHeader: /^(?:answer\s*key|answers?|solutions?|correct\s*answers?|answer\s*sheet)[\s:]*$/i,
    
    inlineAnswerEnd: /\s+Answer:\s*([A-Ha-h])\s*[)\.]?\s*$/i,
    inlineAnswerParens: /\s+\(Answer:\s*([A-Ha-h])\)\s*$/i,
    inlineAnswerMiddle: /\s+Answer:\s*([A-Ha-h])\b/gi,
    
    questionNumber: [
      /^(?:q|question|problem|no\.?|#)\s*(\d+)\s*[\.\)\:\-\s]+(.{5,})$/i,
      /^(\d+)\s*[\.\)\:\-]\s*(.{5,})$/,
      /^(\d+)\s+([A-Z].{10,})$/,
      /^\[(\d+)\]\s*(.{5,})$/,
    ],
    
    // Keyword-based questions (no number)
    questionKeyword: /^(what|which|who|whom|when|where|why|how|can|could|should|would|will|do|does|did|is|are|was|were|has|have|had|define|explain|describe|calculate|solve|determine|identify|compare|list|name|state|give|find|choose|select|match|complete|fill)\b(.{8,})/i,
    
    // Option patterns
    option: [
      /^[\(\[]?([A-Ha-h])[\)\]\.\:\-\s]+(.+)$/,
      /^(?:option\s*)?([A-Ha-h])\s*[\.\:\-]\s*(.+)$/i,
      /^•\s*(.+)$/,
      /^-\s*(.+)$/,
      /^\*\s*(.+)$/,
    ],
    
    // Answer key formats
    answerKeyFormats: [
      /^(\d+)\s*[\.\)\:\-]\s*([A-Ha-h])\b/i,
      /^(?:q|question)\s*(\d+)\s*[\:\=\-]\s*([A-Ha-h])\b/i,
      /^(\d+)\s*-\s*(\d+)\s*[\:\-]\s*([A-Ha-h](?:\s+[A-Ha-h])*)/i,
      /^(\d+)\s+([A-Ha-h])\b/,
    ],
    
    // Special question types
    trueFalse: /\b(true\s*or\s*false|t\/f|true\/false)\b/i,
    fillInBlank: /_{3,}|\.{3,}|\[.*?\]|\(.*?\)/,
    
    // Explanation patterns
    explanation: /^(?:explanation|reasoning|why|because|rationale|note|hint|solution)[\s\:\-]+(.+)$/i,
    
    // Section breaks
    sectionBreak: /^(?:section|part|chapter|unit|module)[\s\d\:\-]+/i,
  };

  // ===== HELPER FUNCTIONS =====

  function matchAnyPattern(line, patternArray) {
    for (const pattern of patternArray) {
      const match = line.match(pattern);
      if (match) return match;
    }
    return null;
  }

  // Extract and remove inline answers
  function extractAndRemoveAnswer(line) {
    let cleanedLine = line;
    let extractedAnswer = null;
    
    const answerPatterns = [
      /^Answer:\s*([A-Ha-h])\)?\s*$/i,
      /^Answer:\s*([A-Ha-h])\s*$/i,
      /\s+Answer:\s*([A-Ha-h])\)\s*$/i,
      /\s+Answer:\s*([A-Ha-h])\s*$/i,
      /\s+\(Answer:\s*([A-Ha-h])\)\s*$/i,
      /\s+Answer:\s*([A-Ha-h])\)/gi,
      /\s+Answer:\s*([A-Ha-h])\b/gi
    ];
    
    for (const pattern of answerPatterns) {
      const match = cleanedLine.match(pattern);
      if (match) {
        const letter = match[1].toUpperCase();
        if (config.letterToIndex[letter] !== undefined) {
          extractedAnswer = config.letterToIndex[letter];
          cleanedLine = cleanedLine.replace(pattern, '').trim();
          break;
        }
      }
    }
    
    return { cleanedLine, extractedAnswer };
  }

  // Normalize option text
  function normalizeOption(text) {
    let cleaned = text
      .replace(/^\s*[\(\[]?[A-Ha-h][\)\]\.\:\-\s]+/, '')
      .replace(/\s+Answer:\s*[A-Ha-h]\)\s*$/i, '')
      .replace(/\s+Answer:\s*[A-Ha-h]\s*$/i, '')
      .replace(/\s+\(Answer:\s*[A-Ha-h]\)\s*$/i, '')
      .replace(/\s+Answer:\s*[A-Ha-h]\)/gi, '')
      .replace(/Answer:\s*[A-Ha-h]\b/gi, '')
      .trim();
    
    // Remove trailing punctuation
    cleaned = cleaned.replace(/[\.\,\;]+$/, '').trim();
    
    return cleaned;
  }

  function isQuestionLike(line) {
    return (
      line.endsWith('?') ||
      /^(?:what|which|who|when|where|why|how)/i.test(line) ||
      /\b(?:calculate|solve|determine|identify|explain|define)\b/i.test(line)
    );
  }

  function detectQuestionType(text) {
    if (patterns.trueFalse.test(text)) return 'true-false';
    if (patterns.fillInBlank.test(text)) return 'fill-in-blank';
    return 'multiple-choice';
  }

  function savePreviousQuestion() {
    if (state.current && isValidQuestionStructure(state.current)) {
      const qType = detectQuestionType(state.current.questionText);
      state.current.questionType = qType;
      
      if (qType === 'true-false' && state.current.options.length === 0) {
        state.current.options = ['True', 'False'];
        state.trueFalseQuestions.add(state.current.qnum);
      }
      
      if (qType === 'fill-in-blank' && state.current.options.length === 0) {
        state.current.options = ['[Open-ended answer]'];
        state.fillInBlankQuestions.add(state.current.qnum);
      }

      if(state.current.correctAnswer === null && state.current.extractedAnswer !== undefined) {
        state.current.correctAnswer = state.current.extractedAnswer;
      }

      state.questions.push(state.current);
    }
  }

  function isValidQuestionStructure(q) {
    return (
      q &&
      q.questionText &&
      q.questionText.trim().length >= config.minQuestionLength &&
      q.questionText.trim().length <= config.maxQuestionLength
    );
  }

  // ===== PHASE 1: DETECT ANSWER KEY SECTION (BULLETPROOF) =====
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Super flexible answer key header detection
    const hasAnswerKeyword = /answer/i.test(line);
    const hasKeyKeyword = /key|sheet|section/i.test(line);
    const isSuspectedHeader = (hasAnswerKeyword && hasKeyKeyword) || 
                              /^answers?\s*:?\s*$/i.test(line) ||
                              /^solutions?\s*:?\s*$/i.test(line);
    const isShortLine = line.length < 100;
    const notAQuestion = !patterns.questionNumber[0].test(line);
    
    if (isSuspectedHeader && isShortLine && notAQuestion) {
      state.answerKeyStartLine = i;
      state.inAnswerKey = true;
      
      Logger.info('Answer key header detected', { line: i, text: line });
      
      // Read ALL remaining lines for answers
      let lastAnswerLine = i;
      let sequentialQuestionNum = 1; // For sequential answers without explicit question numbers
      
      for (let j = i + 1; j < lines.length; j++) {
        const ansLine = lines[j].trim();
        if (!ansLine) continue;
        
        // Stop if we hit obvious question restart
        if (patterns.sectionBreak.test(ansLine)) {
          Logger.info('Section break - stopping answer key parse', { line: j });
          break;
        }
        
        let matched = false;
        
        // Format 1: "1. A" or "1) A" or "1: A" or "1 A"
        const match1 = ansLine.match(/^(\d+)[\s.)\]:=-]*([A-Ha-h])\b/i);
        if (match1) {
          const qNum = parseInt(match1[1]);
          const letter = match1[2].toUpperCase();
          if (config.letterToIndex[letter] !== undefined) {
            state.answerSection.set(qNum, config.letterToIndex[letter]);
            matched = true;
            lastAnswerLine = j;
            sequentialQuestionNum = qNum + 1; // Update for next sequential
          }
        }
        
        // Format 2: "Q1. A" or "Question 1: A"
        if (!matched) {
          const match2 = ansLine.match(/^Q(?:uestion)?\.?\s*(\d+)[\s.)\]:=-]*([A-Ha-h])\b/i);
          if (match2) {
            const qNum = parseInt(match2[1]);
            const letter = match2[2].toUpperCase();
            if (config.letterToIndex[letter] !== undefined) {
              state.answerSection.set(qNum, config.letterToIndex[letter]);
              matched = true;
              lastAnswerLine = j;
              sequentialQuestionNum = qNum + 1;
            }
          }
        }
        
        // Format 3: "(1) A"
        if (!matched) {
          const match3 = ansLine.match(/^\((\d+)\)\s*([A-Ha-h])\b/i);
          if (match3) {
            const qNum = parseInt(match3[1]);
            const letter = match3[2].toUpperCase();
            if (config.letterToIndex[letter] !== undefined) {
              state.answerSection.set(qNum, config.letterToIndex[letter]);
              matched = true;
              lastAnswerLine = j;
              sequentialQuestionNum = qNum + 1;
            }
          }
        }
        
        // Format 4: "1-10: A B C D E" (range format)
        if (!matched) {
          const match4 = ansLine.match(/^(\d+)\s*-\s*(\d+)[\s.)\]:=-]*([A-Ha-h\s]+)/i);
          if (match4) {
            const startNum = parseInt(match4[1]);
            const endNum = parseInt(match4[2]);
            const letters = match4[3].toUpperCase().split(/\s+/).filter(l => l);
            
            for (let k = 0; k < letters.length && startNum + k <= endNum; k++) {
              if (config.letterToIndex[letters[k]] !== undefined) {
                state.answerSection.set(startNum + k, config.letterToIndex[letters[k]]);
                matched = true;
                lastAnswerLine = j;
                sequentialQuestionNum = endNum + 1;
              }
            }
          }
        }
        
        // Format 5: SEQUENTIAL WITHOUT NUMBERS - "C) Jupiter" or "A) Oxygen"
        // This is for answer keys that just list answers in order
        if (!matched) {
          const match5 = ansLine.match(/^([A-Ha-h])\)\s*.+/i);
          if (match5) {
            const letter = match5[1].toUpperCase();
            if (config.letterToIndex[letter] !== undefined) {
              state.answerSection.set(sequentialQuestionNum, config.letterToIndex[letter]);
              matched = true;
              lastAnswerLine = j;
              sequentialQuestionNum++;
              Logger.debug('Sequential answer detected', { 
                qNum: sequentialQuestionNum - 1, 
                letter, 
                line: ansLine.substring(0, 50) 
              });
            }
          }
        }
        
        // Format 6: Just letter at start - "C", "A", "B" (one per line)
        if (!matched && ansLine.length <= 3) {
          const match6 = ansLine.match(/^([A-Ha-h])$/i);
          if (match6) {
            const letter = match6[1].toUpperCase();
            if (config.letterToIndex[letter] !== undefined) {
              state.answerSection.set(sequentialQuestionNum, config.letterToIndex[letter]);
              matched = true;
              lastAnswerLine = j;
              sequentialQuestionNum++;
            }
          }
        }
        
        // Stop if we've gone 20 lines without finding an answer (generous buffer for spacing)
        if (j - lastAnswerLine > 20 && state.answerSection.size > 0) {
          Logger.info('No answers found in 20 lines - ending answer key parse', { 
            line: j, 
            answersFound: state.answerSection.size 
          });
          break;
        }
      }
      
      Logger.info('Answer key parsing complete', { 
        startLine: state.answerKeyStartLine,
        totalAnswers: state.answerSection.size,
        answers: Array.from(state.answerSection.entries())
      });
      
      break;
    }
  }

  // ===== PHASE 2: PARSE QUESTIONS & OPTIONS =====
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    // Skip answer key section completely
    if (state.answerKeyStartLine !== -1 && i >= state.answerKeyStartLine) {
      // Skip until we've passed the answer section
      const estimatedEnd = state.answerKeyStartLine + (state.answerSection.size * 2) + 20;
      if (i < estimatedEnd) {
        continue;
      }
    }
    
    // Skip section breaks
    if (patterns.sectionBreak.test(line)) {
      continue;
    }

    // STEP 1: Extract answer BEFORE parsing
    const { cleanedLine, extractedAnswer } = extractAndRemoveAnswer(line);
    line = cleanedLine;

    if (extractedAnswer !== null && line.length === 0) {
      if (state.current) {
        state.current.correctAnswer = extractedAnswer;
        state.current.extractedAnswer = extractedAnswer;
      }
      continue;
    }

    // ===== DETECT NEW QUESTION =====
    
    let questionMatch = null;
    let questionNumber = null;
    let questionText = null;
    
    // Try numbered question patterns
    for (const pattern of patterns.questionNumber) {
      questionMatch = line.match(pattern);
      if (questionMatch) {
        questionNumber = parseInt(questionMatch[1]);
        questionText = questionMatch[2].trim();
        break;
      }
    }
    
    if (questionMatch && questionNumber && questionText.length >= 5) {
      savePreviousQuestion();
      
      state.current = {
        qnum: questionNumber,
        questionText: questionText,
        options: [],
        correctAnswer: extractedAnswer,
        extractedAnswer: extractedAnswer,
        explanation: "",
        questionType: 'multiple-choice',
      };
      
      continue;
    }
    
    // Try keyword-based questions (no number)
    const keywordMatch = line.match(patterns.questionKeyword);
    if (keywordMatch && 
        (!state.current || state.current.options.length >= config.minOptions)) {
      
      savePreviousQuestion();
      
      state.current = {
        qnum: state.questions.length + 1,
        questionText: line,
        options: [],
        correctAnswer: extractedAnswer,
        extractedAnswer: extractedAnswer,
        explanation: "",
        questionType: 'multiple-choice',
      };
      
      continue;
    }

    // ===== DETECT OPTIONS =====
    
    if (state.current) {
      let optionMatch = null;
      let optionText = null;
      
      for (const pattern of patterns.option) {
        optionMatch = line.match(pattern);
        if (optionMatch) {
          if (optionMatch.length === 3) {
            optionText = normalizeOption(optionMatch[2]);
          } else {
            optionText = normalizeOption(optionMatch[1]);
          }
          break;
        }
      }
      
      if (optionText && 
          optionText.length >= config.minOptionLength && 
          optionText.length <= config.maxOptionLength) {
        
        state.current.options.push(optionText);

        if(extractedAnswer !== null){
          state.current.correctAnswer = extractedAnswer;
          state.current.extractedAnswer = extractedAnswer;
        }

        continue;
      }
      
      // DETECT EXPLANATIONS
      const explMatch = line.match(patterns.explanation);
      if (explMatch) {
        state.current.explanation = explMatch[1].trim();
        continue;
      }
      
      // ===== MULTILINE HANDLING =====
      
      if (state.current.options.length === 0 && 
          !isQuestionLike(line) &&
          line.length > 0 &&
          line.length < 200) {
        
        state.current.questionText += ' ' + line;
        continue;
      }
      
      if (state.current.options.length > 0 && 
          line.length > 0 &&
          line.length < 150 &&
          !/^[A-Ha-h][\.\)\:]/.test(line) &&
          !patterns.questionKeyword.test(line) &&
          !matchAnyPattern(line, patterns.questionNumber)) {
        
        const lastIndex = state.current.options.length - 1;
        state.current.options[lastIndex] += ' ' + line;
        continue;
      }
      
      if (state.current.options.length >= config.minOptions && 
          state.current.explanation &&
          line.length > 20 &&
          line.length < 300) {
        
        state.current.explanation += ' ' + line;
        continue;
      }
    }
  }
  
  savePreviousQuestion();

  // ===== PHASE 3: APPLY ANSWER KEY =====
  
  state.questions.forEach(q => {
    if (q.correctAnswer === null && state.answerSection.has(q.qnum)) {
      q.correctAnswer = state.answerSection.get(q.qnum);
    }
  });

  // ===== PHASE 4: ENHANCED VALIDATION & CLEANING =====
  
  const validated = state.questions.filter((q) => {
    // Clean question text thoroughly
    q.questionText = q.questionText
      .replace(/\s+/g, ' ')
      .replace(/^[^\w\d]+/, '')
      .replace(/\s+Answer:\s*[A-Ha-h]\b.*$/i, '')
      .replace(/\s+\(Answer:\s*[A-Ha-h]\).*$/i, '')
      .replace(/Answer:\s*[A-Ha-h]\b/gi, '')
      .trim();
    
    // Clean options thoroughly
    q.options = q.options
      .map(opt => opt
        .replace(/\s+/g, ' ')
        .replace(/\s+Answer:\s*[A-Ha-h]\b.*$/i, '')
        .replace(/\s+\(Answer:\s*[A-Ha-h]\).*$/i, '')
        .replace(/Answer:\s*[A-Ha-h]\b/gi, '')
        .trim()
      )
      .filter(opt => opt.length > 0);
    
    // Remove duplicate options
    q.options = [...new Set(q.options)];
    
    // Clean explanation
    q.explanation = q.explanation.replace(/\s+/g, ' ').trim();
    
    // ===== VALIDATION RULES =====
    
    if (q.questionText.length > config.maxQuestionLength) {
      q.questionText = q.questionText.substring(0, config.maxQuestionLength) + '...';
    }
    
    // Handle special question types
    if (q.questionType === 'true-false') {
      if (q.options.length !== 2) {
        q.options = ['True', 'False'];
      }
      return true;
    }
    
    if (q.questionType === 'fill-in-blank') {
      return true;
    }
    
    // Multiple choice needs minimum options
    if (q.options.length < config.minOptions) {
      Logger.debug('Insufficient options, skipping question', { 
        qnum: q.qnum, 
        current: q.options.length,
        required: config.minOptions
      });
      return false;
    }
    
    // Limit maximum options
    if (q.options.length > config.maxOptions) {
      q.options = q.options.slice(0, config.maxOptions);
    }
    
    // Validate correct answer index
    if (q.correctAnswer !== null) {
      if (q.correctAnswer < 0 || q.correctAnswer >= q.options.length) {
        Logger.warn('Invalid correctAnswer, resetting', { 
          qnum: q.qnum, 
          correctAnswer: q.correctAnswer, 
          optionsCount: q.options.length 
        });
        q.correctAnswer = null;
      }
    } else if (q.extractedAnswer !== undefined && q.extractedAnswer !== null) {
      if(q.extractedAnswer >= 0 && q.extractedAnswer < q.options.length){
        q.correctAnswer = q.extractedAnswer;
        Logger.info('Restored correctAnswer from extractedAnswer', {
          qnum: q.qnum,
          correctAnswer: q.correctAnswer
        });
      }
    }
    
    return true;
  });

  // ===== PHASE 5: DEDUPLICATION =====
  
  const seen = new Map();
  const deduped = validated.filter(q => {
    const key = q.questionText
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (seen.has(key)) {
      const originalQnum = seen.get(key);
      Logger.debug('Duplicate removed', { 
        qnum: q.qnum, 
        duplicateOf: originalQnum 
      });
      return false;
    }
    
    seen.set(key, q.qnum);
    return true;
  });

  // ===== PHASE 6: QUALITY SCORING =====
  
  deduped.forEach(q => {
    let qualityScore = 0;
    
    if (q.questionText.length > 30) qualityScore += 1;
    if (q.questionText.includes('?')) qualityScore += 1;
    if (q.options.length >= 4) qualityScore += 2;
    if (q.correctAnswer !== null) qualityScore += 2;
    if (q.explanation && q.explanation.length > 20) qualityScore += 1;
    
    q.qualityScore = Math.max(0, qualityScore);
  });

  // ===== RETURN FORMATTED =====
  return deduped.map((q, index) => ({
    userId,
    topic,
    sourceFile,
    qnum: q.qnum || index + 1,
    questionText: q.questionText,
    options: q.options,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation || "",
    questionType: q.questionType || 'multiple-choice',
    qualityScore: q.qualityScore || 0,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// THEORY / ESSAY EXAM PARSER
// Handles documents with "Question One (a)(b)(c)(d)" structure
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect whether document is a theory/essay exam or an MCQ quiz.
 * Scans for structural markers: "Question One/Two/..." headers, (a)-(h) sub-questions,
 * A)-D) MCQ options. Returns 'theory' or 'mcq'.
 */
function detectDocumentType(text) {
  const lines = text.split('\n');
  let wordHeaders = 0;        // "Question One", "Question Two"
  let numericHeaders = 0;     // "Question 1", "Question 2" (standalone)
  let subQPatterns = 0;       // (a) ..., (b) ...
  let mcqOptions = 0;         // A) ..., B) ...
  let questionMarkLines = 0;  // Lines ending with ?

  for (const line of lines) {
    const t = line.trim();
    if (QUESTION_HEADER_RE.test(t) && t.length < 80) {
      const numPart = t.match(QUESTION_HEADER_RE)[1].toLowerCase();
      if (WORD_TO_NUM[numPart]) wordHeaders++;
      else if (/^\d+$/.test(numPart)) numericHeaders++;
    }
    if (/^\([a-h]\)\s*.+/i.test(t)) subQPatterns++;
    if (/^[A-D]\)\s+.{3,}/.test(t)) mcqOptions++;
    if (t.endsWith('?') && t.length > 15) questionMarkLines++;
  }

  const totalHeaders = wordHeaders + numericHeaders;

  // Theory: "Question One" style with sub-questions dominating MCQ options
  if (wordHeaders >= 2) return 'theory';
  if (totalHeaders >= 2 && subQPatterns > mcqOptions * 1.5) return 'theory';
  if (subQPatterns >= 6 && mcqOptions <= 2) return 'theory';

  return 'mcq';
}

/**
 * Parse a theory/essay exam into individual questions.
 * Splits on "Question X" headers, then on (a)-(h) sub-questions within each.
 * Large sub-questions containing (i)(ii)(iii) sub-sub-questions are further split,
 * with scenario context prepended to each.
 */
function parseTheoryExam(text, topic, sourceFile, userId) {
  const lines = text
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // Before splitting into blocks, pre-split lines that contain multiple (a)-(h) markers
  const expandedLines = [];
  for (const line of lines) {
    const markers = [...line.matchAll(/\(([a-h])\)\s*/gi)];
    if (markers.length > 1) {
      let last = 0;
      for (const m of markers) {
        if (m.index > last) {
          const before = line.substring(last, m.index).trim();
          if (before) expandedLines.push(before);
        }
        last = m.index;
      }
      if (last < line.length) expandedLines.push(line.substring(last).trim());
    } else {
      expandedLines.push(line);
    }
  }

  // ── Step 1: Find "Question X" headers and split into blocks ──
  const blocks = [];
  let currentBlock = null;

  for (const line of expandedLines) {
    const hMatch = line.match(QUESTION_HEADER_RE);
    if (hMatch && line.length < 80) {
      if (currentBlock) blocks.push(currentBlock);
      const numStr = hMatch[1].toLowerCase();
      const num = WORD_TO_NUM[numStr] || parseInt(numStr) || blocks.length + 1;
      currentBlock = { num, lines: [] };
      // Keep any text after the header on the same line
      const rest = line.replace(QUESTION_HEADER_RE, '').trim();
      if (rest) currentBlock.lines.push(rest);
      continue;
    }
    if (currentBlock) {
      currentBlock.lines.push(line);
    }
    // Lines before first header are ignored (title, instructions, etc.)
  }
  if (currentBlock) blocks.push(currentBlock);

  if (blocks.length === 0) return null;

  Logger.info('Theory exam: found question blocks', { count: blocks.length });

  // ── Step 2: Extract sub-questions from each block ──
  const questions = [];

  for (const block of blocks) {
    const subQs = extractTheorySubQuestions(block.lines);

    if (subQs.length === 0) {
      // No sub-questions → whole block is one question
      const fullText = cleanTheoryText(block.lines.join(' '));
      if (fullText.length >= 10) {
        questions.push({
          questionNumber: String(block.num),
          subPart: null,
          questionText: truncateQuestionText(fullText),
          questionType: 'theory',
          options: [],
          correctAnswer: null,
          modelAnswer: null,
        });
      }
    } else {
      for (const sq of subQs) {
        const qText = cleanTheoryText(sq.text);
        if (qText.length >= 10) {
          questions.push({
            questionNumber: String(block.num),
            subPart: sq.part,
            questionText: truncateQuestionText(qText),
            questionType: 'theory',
            options: [],
            correctAnswer: null,
            modelAnswer: null,
          });
        }
      }
    }
  }

  if (questions.length === 0) return null;

  // Format output
  return questions.map((q, i) => ({
    userId,
    topic,
    sourceFile,
    qnum: i + 1,
    questionNumber: q.questionNumber,
    subPart: q.subPart,
    questionText: q.questionText,
    options: q.options,
    correctAnswer: q.correctAnswer,
    explanation: '',
    questionType: q.questionType,
    modelAnswer: q.modelAnswer,
    qualityScore: q.questionText.length > 30 ? 3 : 1,
  }));
}

/**
 * Split a question block's lines into (a)-(h) sub-questions.
 * Lines before the first sub-question marker are treated as preamble/context.
 * Sub-questions containing (i)(ii)(iii) sub-sub-questions are further expanded.
 */
function extractTheorySubQuestions(blockLines) {
  const SUB_Q_RE = /^\(([a-h])\)\s*(.*)/i;
  const subQs = [];
  let currentPart = null;
  let currentText = [];
  let preambleLines = [];

  for (const line of blockLines) {
    const subMatch = line.match(SUB_Q_RE);
    if (subMatch) {
      if (currentPart !== null && currentText.length > 0) {
        subQs.push({ part: currentPart, text: currentText.join(' ') });
      }
      currentPart = subMatch[1].toLowerCase();
      currentText = subMatch[2] ? [subMatch[2]] : [];
      continue;
    }

    if (currentPart !== null) {
      currentText.push(line);
    } else {
      preambleLines.push(line);
    }
  }

  if (currentPart !== null && currentText.length > 0) {
    subQs.push({ part: currentPart, text: currentText.join(' ') });
  }

  // Expand sub-questions that contain (i)(ii)(iii) sub-sub-questions
  const expanded = [];
  for (const sq of subQs) {
    const romanSplit = splitOnRomanNumerals(sq.text, preambleLines);
    if (romanSplit.length > 1) {
      for (const rs of romanSplit) {
        expanded.push({ part: sq.part + '(' + rs.roman + ')', text: rs.text });
      }
    } else {
      expanded.push(sq);
    }
  }

  return expanded;
}

/**
 * Split a sub-question body on (i)(ii)(iii)(iv)(v) roman numeral markers.
 * Returns an array of { roman, text } objects.
 * Only splits if there's a substantial scenario before the markers
 * and the sub-sub-question texts are meaningful (not just short list items).
 */
function splitOnRomanNumerals(text, preambleLines) {
  // Split on roman numeral markers: (i), (ii), (iii), (iv), (v), (vi), (vii), (viii), (ix), (x)
  const parts = text.split(/\(([ivx]+)\)\s*/i);
  // parts = [before, roman1, text1, roman2, text2, ...]
  if (parts.length < 5) return []; // Need at least 2 roman numerals

  const scenarioText = parts[0].trim();

  // Only split if there's substantial scenario preceding the roman numerals
  // Short text before (i) usually means they're list items, not standalone questions
  if (scenarioText.length < 50) return [];

  // Check that most sub-sub-question texts are substantial (not short list items)
  let longCount = 0;
  const totalSubs = Math.floor((parts.length - 1) / 2);
  for (let i = 1; i < parts.length - 1; i += 2) {
    const qText = (parts[i + 1] || '').trim();
    if (qText.length >= 30) longCount++;
  }

  if (longCount < totalSubs * 0.5) return []; // Mostly short → list items, not questions

  // Build sub-sub-questions with scenario context
  const subSubs = [];
  const truncatedScenario = scenarioText.length > 800
    ? scenarioText.substring(0, 800) + '...'
    : scenarioText;

  for (let i = 1; i < parts.length - 1; i += 2) {
    const roman = parts[i];
    const qText = (parts[i + 1] || '').trim();
    if (qText.length >= 15) {
      // Prepend scenario context for short sub-questions that reference it
      const fullText = qText.length < 200
        ? truncatedScenario + ' ' + qText
        : qText;
      subSubs.push({ roman, text: fullText });
    }
  }

  return subSubs;
}

/**
 * Clean theory question text: collapse spaces, join lines into a paragraph.
 */
function cleanTheoryText(text) {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/-\n\s*/g, '-')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Truncate question text to fit the 2000-char model limit.
 */
function truncateQuestionText(text) {
  const MAX = 2000;
  if (text.length <= MAX) return text;
  return text.substring(0, MAX - 3) + '...';
}

/**
 * Sanitize parser input to prevent injection attacks
 * @param {string} text - Input text to sanitize
 * @returns {string} - Sanitized text
 */
function sanitizeParserInput(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Remove control characters except newlines and tabs
  let sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // Remove potential NoSQL operators
  sanitized = sanitized.replace(/\$[a-zA-Z]+/g, '');
  
  // Limit total length
  const MAX_TEXT_LENGTH = 1000000; // 1MB
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
  parseQuestionsFromText,
  preprocessMergedQuestions,
  sanitizeParserInput,
  detectDocumentType,
  parseTheoryExam
};
