const PDFDocument = require('pdfkit');
const Logger = require('../logger');

const WATERMARK_TEXT = 'VAYREX';

const COLORS = {
  primary: '#1a365d',
  secondary: '#2d3748',
  accent: '#3182ce',
  lightGray: '#e2e8f0',
  mediumGray: '#a0aec0',
  text: '#2d3748',
  correct: '#276749',
  incorrect: '#c53030',
  watermark: '#444a53'
};

const FONTS = {
  title: 'Helvetica-Bold',
  heading: 'Helvetica-Bold',
  body: 'Helvetica',
  italic: 'Helvetica-Oblique'
};

/**
 * Generate PDF from questions array
 * @param {Array} questions - Array of question objects
 * @param {Object} options - Export options
 * @returns {Buffer} PDF buffer
 */
async function generateQuestionsPDF(questions, options = {}) {
  const {
    title = 'Question Bank',
    topic = 'General',
    includeAnswers = true,
    userName = '',
    difficulty = null,
    watermark = true,
    fontSize = 11,
    fontFamily = 'Helvetica'
  } = options;

  // Map user's font choice to PDFKit built-in families
  const fontMap = {
    'Helvetica': { normal: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' },
    'Times': { normal: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic' },
    'Courier': { normal: 'Courier', bold: 'Courier-Bold', italic: 'Courier-Oblique' }
  };
  const fonts = fontMap[fontFamily] || fontMap['Helvetica'];

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 60, bottom: 60, left: 50, right: 50 },
        bufferPages: true,
        info: {
          Title: `${title} - ${topic}`,
          Author: 'Vayrex Learning',
          Subject: `Questions - ${topic}`,
          Creator: 'Vayrex Learning Platform'
        }
      });

      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // ===== TITLE PAGE =====
      renderTitlePage(doc, { title, topic, userName, difficulty, questionCount: questions.length, fonts, fontSize });

      // ===== QUESTIONS =====
      doc.addPage();
      let questionNum = 0;

      for (const question of questions) {
        questionNum++;
        
        // Estimate space needed: question text + options + spacing (~20px per option + 60px base)
        const optionCount = (question.options && question.options.length) || 0;
        const estimatedHeight = 60 + (optionCount * 20) + (fontSize * 2);
        
        // Check if we need a new page (leave room for the question)
        if (doc.y + estimatedHeight > doc.page.height - 80) {
          doc.addPage();
        }

        renderQuestion(doc, question, questionNum, includeAnswers, fonts, fontSize);
      }

      // ===== ANSWER KEY (if answers included) =====
      if (includeAnswers && questions.some(q => q.correctAnswer !== null && q.correctAnswer !== undefined || q.answer || q.blankAnswer || q.modelAnswer)) {
        doc.addPage();
        renderAnswerKey(doc, questions, fonts, fontSize);
      }

      // ===== WATERMARK ON ALL PAGES =====
      if (watermark) {
        const pages = doc.bufferedPageRange();
        for (let i = pages.start; i < pages.start + pages.count; i++) {
          doc.switchToPage(i);
          addWatermark(doc);
        }
      }

      // ===== PAGE NUMBERS =====
      const pageRange = doc.bufferedPageRange();
      for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
        doc.switchToPage(i);
        addFooter(doc, i + 1, pageRange.count, fonts);
      }

      doc.end();
    } catch (error) {
      Logger.error('PDF generation error', { error: error.message });
      reject(error);
    }
  });
}

function renderTitlePage(doc, { title, topic, userName, difficulty, questionCount, fonts, fontSize }) {
  doc.moveDown(6);

  // Title
  doc.font(fonts.bold)
    .fontSize(28)
    .fillColor(COLORS.primary)
    .text(title, { align: 'center' });

  doc.moveDown(0.5);

  // Topic
  doc.font(fonts.bold)
    .fontSize(18)
    .fillColor(COLORS.accent)
    .text(topic, { align: 'center' });

  doc.moveDown(2);

  // Divider
  const dividerY = doc.y;
  doc.moveTo(150, dividerY).lineTo(445, dividerY)
    .strokeColor(COLORS.accent)
    .lineWidth(2)
    .stroke();

  doc.moveDown(2);

  // Info
  doc.font(fonts.normal)
    .fontSize(fontSize)
    .fillColor(COLORS.secondary);

  if (userName) {
    doc.text(`Prepared for: ${userName}`, { align: 'center' });
    doc.moveDown(0.3);
  }

  doc.text(`Total Questions: ${questionCount}`, { align: 'center' });
  doc.moveDown(0.3);

  if (difficulty) {
    doc.text(`Difficulty: ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}`, { align: 'center' });
    doc.moveDown(0.3);
  }

  doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, { align: 'center' });

  doc.moveDown(4);

  // Footer on title page
  doc.font(fonts.italic)
    .fontSize(9)
    .fillColor(COLORS.mediumGray)
    .text('Generated by Vayrex Learning Platform', { align: 'center' });
}

function renderQuestion(doc, question, num, includeAnswers, fonts, fontSize) {
  const startY = doc.y;

  // Question number + text
  // Schema field is 'questionText', with fallbacks for 'question' or 'text'
  const rawQText = question.questionText || question.question || question.text || 'No question text available';
  const qText = sanitiseText(latexToReadable(rawQText));
  
  doc.font(fonts.bold)
    .fontSize(fontSize)
    .fillColor(COLORS.primary)
    .text(`Q${num}. `, { continued: true });

  doc.font(fonts.normal)
    .fontSize(fontSize)
    .fillColor(COLORS.text)
    .text(qText, {
      width: 460,
      lineGap: 2
    });

  doc.moveDown(0.3);

  // Options (for MCQ)
  if (question.options && question.options.length > 0) {
    const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
    question.options.forEach((opt, idx) => {
      if (idx >= labels.length) return;
      
      // Strip any letter prefix the AI may have baked into the option text
      // (e.g. "A. Nyaya" → "Nyaya"), then sanitise Unicode
      const cleanOpt = sanitiseText(String(opt).replace(/^[A-Fa-f][.):\s]\s*/i, '').trim());

      // correctAnswer is stored as index (Number) in the schema
      const isCorrect = includeAnswers && (
        question.correctAnswer === idx ||
        question.answer === labels[idx] ||
        question.answer === opt
      );

      doc.font(isCorrect ? fonts.bold : fonts.normal)
        .fontSize(fontSize - 1)
        .fillColor(isCorrect ? COLORS.correct : COLORS.text)
        .text(`   ${labels[idx]}. ${cleanOpt}`, {
          indent: 15,
          width: 440,
          lineGap: 1
        });
    });
  } else {
    // Fill-in-blank or Theory — render answer space
    const qType = (question.questionType || '').toLowerCase();
    const isFill = qType === 'fill-in-blank' || qType === 'fill-in-gap';

    if (isFill) {
      // Draw a blank line for fill-in-gap
      doc.moveDown(0.3);
      const lineY = doc.y;
      doc.moveTo(65, lineY).lineTo(350, lineY)
        .strokeColor(COLORS.secondary)
        .lineWidth(1)
        .stroke();
      doc.moveDown(0.3);

      if (includeAnswers && question.blankAnswer) {
        doc.font(fonts.bold)
          .fontSize(fontSize - 1)
          .fillColor(COLORS.correct)
          .text(`   Answer: ${sanitiseText(question.blankAnswer)}`, { indent: 15, width: 440 });
      }
    } else {
      // Theory / essay — indicate answer space
      doc.moveDown(0.2);
      doc.font(fonts.italic)
        .fontSize(fontSize - 1)
        .fillColor(COLORS.mediumGray)
        .text('   [Written response required]', { indent: 15, width: 440 });

      if (includeAnswers && question.modelAnswer) {
        doc.moveDown(0.2);
        doc.font(fonts.bold)
          .fontSize(fontSize - 1)
          .fillColor(COLORS.correct)
          .text('   Model Answer:', { indent: 15, width: 440 });
        doc.font(fonts.normal)
          .fontSize(fontSize - 1)
          .fillColor(COLORS.text)
          .text(`   ${sanitiseText(question.modelAnswer)}`, { indent: 15, width: 440, lineGap: 1 });
      }
    }
  }

  doc.moveDown(0.8);

  // Separator line
  if (doc.y < doc.page.height - 80) {
    doc.moveTo(50, doc.y).lineTo(545, doc.y)
      .strokeColor(COLORS.lightGray)
      .lineWidth(0.5)
      .stroke();
    doc.moveDown(0.5);
  }
}

function renderAnswerKey(doc, questions, fonts, fontSize) {
  doc.font(fonts.bold)
    .fontSize(20)
    .fillColor(COLORS.primary)
    .text('Answer Key', { align: 'center' });

  doc.moveDown(1);

  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  // Use 4 columns for compactness; each 120px wide, fitting A4 (595 - 100 margins = 495 usable)
  const NUM_COLS = 4;
  const colWidth = Math.floor(495 / NUM_COLS); // 123px
  const startX = doc.page.margins.left;
  const startY = doc.y;
  let col = 0;
  let currentY = startY;

  questions.forEach((q, idx) => {
    const qType = (q.questionType || '').toLowerCase();
    const isFill = qType === 'fill-in-blank' || qType === 'fill-in-gap';
    const isTheory = qType === 'theory' || qType === 'short-answer' || qType === 'essay';

    const hasAnswer = q.correctAnswer !== null && q.correctAnswer !== undefined || q.answer || q.blankAnswer || q.modelAnswer;
    if (!hasAnswer) return;

    const num = idx + 1;
    let answerText;

    if (isFill && q.blankAnswer) {
      answerText = sanitiseText(q.blankAnswer);
    } else if (isTheory && q.modelAnswer) {
      const cleaned = sanitiseText(q.modelAnswer);
      answerText = cleaned.length > 30 ? cleaned.substring(0, 27) + '...' : cleaned;
    } else if (q.correctAnswer !== null && q.correctAnswer !== undefined && q.options && q.options.length > 0) {
      answerText = labels[q.correctAnswer] || String(q.correctAnswer);
    } else if (q.answer) {
      answerText = q.answer;
      if (q.options && q.options.length > 0) {
        const optIdx = q.options.indexOf(q.answer);
        if (optIdx >= 0 && optIdx < labels.length) answerText = labels[optIdx];
      }
    } else {
      return;
    }

    // Truncate non-MCQ answers to fit column width (approx 18 chars at fontSize-1 in 120px col)
    if (answerText.length > 18) answerText = answerText.substring(0, 15) + '...';

    // ── Check overflow BEFORE drawing — keeps entries fully within their column
    if (currentY + fontSize + 4 > doc.page.height - doc.page.margins.bottom) {
      col++;
      currentY = startY;
      if (col >= NUM_COLS) {
        col = 0;
        doc.addPage();
        currentY = doc.page.margins.top;
      }
    }

    const x = startX + col * colWidth;
    doc.font(fonts.normal)
      .fontSize(fontSize - 1)
      .fillColor(COLORS.text)
      .text(`${num}. ${answerText}`, x, currentY, { width: colWidth - 6, lineBreak: false });

    // Advance by actual font line height (don't use doc.y since lineBreak:false doesn't move it)
    currentY += Math.ceil((fontSize - 1) * 1.4) + 2;
  });
}

function addWatermark(doc) {
  const pageWidth  = doc.page.width;
  const pageHeight = doc.page.height;

  // Exactly two watermarks per page: left-centre and right-centre, both at -45°
  const positions = [
    { x: pageWidth * 0.25, y: pageHeight * 0.5 },
    { x: pageWidth * 0.75, y: pageHeight * 0.5 }
  ];

  for (const pos of positions) {
    doc.save();
    doc.font(FONTS.title)
       .fontSize(54)
       .fillColor(COLORS.watermark)
       .opacity(0.07)
       .translate(pos.x, pos.y)
       .rotate(-45, { origin: [0, 0] })
       .text(WATERMARK_TEXT, -80, -15, { width: 200, align: 'center', lineBreak: false });
    doc.restore();
  }
}

function addFooter(doc, pageNum, totalPages, fonts) {
  // Keep footer inside printable bounds; writing below bottom margin triggers
  // PDFKit auto-pagination and creates duplicate footer-only pages.
  const footerY = doc.page.height - doc.page.margins.bottom - 10;

  doc.font(fonts.normal)
    .fontSize(8)
    .fillColor(COLORS.mediumGray)
    .text(
      `Page ${pageNum} of ${totalPages}  |  Vayrex Learning  |  ${new Date().toLocaleDateString()}`,
      50,
      footerY,
      { align: 'center', width: doc.page.width - 100, lineBreak: false }
    );
}

/**
 * Generate exam-style PDF (no answers shown)
 */
async function generateExamPDF(questions, options = {}) {
  return generateQuestionsPDF(questions, {
    ...options,
    includeAnswers: false,
    title: options.title || 'Examination Paper'
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// ─── Course Outline Notes PDF Export ──────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Render markdown-lite text into PDFKit calls.
 * Handles: **bold**, *italic*, bullet lists (- or •), paragraph breaks.
 */
function renderMarkdownContent(doc, rawInput, fonts, fontSize) {
  if (!rawInput) return;
  // Convert LaTeX math FIRST (before sanitiseText strips backslash commands)
  const mathConverted = latexToReadable(rawInput);
  // Then sanitise the converted text
  const text = sanitiseText(mathConverted);
  if (!text) return;

  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines (add spacing)
    if (!trimmed) {
      doc.moveDown(0.3);
      i++;
      continue;
    }

    // Bullet list item
    if (/^\s*[-•\*▪▸►◦‣→]\s/.test(trimmed)) {
      const bulletText = trimmed.replace(/^\s*[-•\*▪▸►◦‣→]\s+/, '');
      renderInlineFormatting(doc, `  •  ${bulletText}`, fonts, fontSize - 0.5, 25);
      doc.moveDown(0.15);
      i++;
      continue;
    }

    // Numbered list item
    if (/^\s*\d+[.)]\s/.test(trimmed)) {
      renderInlineFormatting(doc, `  ${trimmed}`, fonts, fontSize - 0.5, 25);
      doc.moveDown(0.15);
      i++;
      continue;
    }

    // Regular paragraph line
    renderInlineFormatting(doc, trimmed, fonts, fontSize, 0);
    doc.moveDown(0.2);
    i++;
  }
}

/**
 * Convert LaTeX math expressions to readable Unicode text for PDF rendering.
 * PDFKit cannot render HTML/KaTeX, so we do a best-effort text approximation.
 * This runs BEFORE sanitiseText so we don't lose the backslashes.
 *
 * Handles:
 *  - Display math blocks: \[...\] and $$...$$
 *  - Inline math: \(...\) and $...$
 *  - Common macros: \frac, \dfrac, \tfrac, \sqrt, \int, \sum, \prod, Greek letters, etc.
 */
function latexToReadable(text) {
  if (!text) return text;

  // Helper: strip outer { } wrapping a single argument
  const unwrap = (s) => s.replace(/^\{([\s\S]*)\}$/, '$1').trim();

  // Recursively convert a LaTeX snippet to text
  const convertMath = (src) => {
    let s = src.trim();

    // \frac{a}{b} or \dfrac / \tfrac / \cfrac
    s = s.replace(/\\[dct]?frac\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g,
      (_, num, den) => `(${convertMath(num)})/(${convertMath(den)})`);

    // \sqrt[n]{x} or \sqrt{x}
    s = s.replace(/\\sqrt\[([^\]]+)\]\{([^{}]*)\}/g, (_, n, x) => `${convertMath(x)}^(1/${n})`);
    s = s.replace(/\\sqrt\{([^{}]*)\}/g, (_, x) => `\u221a(${convertMath(x)})`);
    s = s.replace(/\\sqrt\b/g, '\u221a');

    // \int, \iint, \oint
    s = s.replace(/\\iint\b/g, '\u222c').replace(/\\oint\b/g, '\u222e').replace(/\\int\b/g, '\u222b');

    // \sum, \prod, \lim
    s = s.replace(/\\sum\b/g, '\u03a3').replace(/\\prod\b/g, '\u03a0').replace(/\\lim\b/g, 'lim');

    // Superscripts: ^{abc} or ^a  →  avoid confusing output
    s = s.replace(/\^\{([^{}]+)\}/g, (_, e) => `^${convertMath(e)}`);
    s = s.replace(/\^([^\s{\\])/g, '^$1');

    // Subscripts: _{abc} or _a
    s = s.replace(/_\{([^{}]+)\}/g, (_, e) => `_${convertMath(e)}`);
    s = s.replace(/_([^\s{\\])/g, '_$1');

    // \left( ... \right) etc.
    s = s.replace(/\\left\s*\(/g, '(').replace(/\\right\s*\)/g, ')');
    s = s.replace(/\\left\s*\[/g, '[').replace(/\\right\s*\]/g, ']');
    s = s.replace(/\\left\s*\{/g, '{').replace(/\\right\s*\}/g, '}');
    s = s.replace(/\\left\s*\|/g, '|').replace(/\\right\s*\|/g, '|');
    s = s.replace(/\\bigl?\s*[({[]/g, '(').replace(/\\bigr?\s*[)}\]]/g, ')');

    // Greek lowercase
    const greek = {
      alpha: '\u03b1', beta: '\u03b2', gamma: '\u03b3', delta: '\u03b4',
      epsilon: '\u03b5', zeta: '\u03b6', eta: '\u03b7', theta: '\u03b8',
      iota: '\u03b9', kappa: '\u03ba', lambda: '\u03bb', mu: '\u03bc',
      nu: '\u03bd', xi: '\u03be', pi: '\u03c0', rho: '\u03c1',
      sigma: '\u03c3', tau: '\u03c4', upsilon: '\u03c5', phi: '\u03c6',
      chi: '\u03c7', psi: '\u03c8', omega: '\u03c9',
      // uppercase
      Gamma: '\u0393', Delta: '\u0394', Theta: '\u0398', Lambda: '\u039b',
      Xi: '\u039e', Pi: '\u03a0', Sigma: '\u03a3', Phi: '\u03a6', Psi: '\u03a8', Omega: '\u03a9',
      // partial, nabla, infty
      partial: '\u2202', nabla: '\u2207', infty: '\u221e',
      // relations & operators
      neq: '\u2260', leq: '\u2264', geq: '\u2265', approx: '\u2248',
      equiv: '\u2261', sim: '\u223c', pm: '\u00b1', mp: '\u2213',
      times: '\u00d7', div: '\u00f7', cdot: '\u00b7',
      // arrows
      rightarrow: '\u2192', leftarrow: '\u2190', Rightarrow: '\u21d2', Leftarrow: '\u21d0',
      leftrightarrow: '\u2194', Leftrightarrow: '\u21d4',
      // sets
      in: '\u2208', notin: '\u2209', cup: '\u222a', cap: '\u2229',
      subset: '\u2282', supset: '\u2283', emptyset: '\u2205',
      // misc
      ldots: '...', cdots: '...', forall: '\u2200', exists: '\u2203',
      therefore: '\u2234', because: '\u2235',
    };
    for (const [cmd, sym] of Object.entries(greek)) {
      s = s.replace(new RegExp(`\\\\${cmd}\\b`, 'g'), sym);
    }

    // Strip remaining braces
    s = s.replace(/\{/g, '').replace(/\}/g, '');

    // Strip remaining backslash-commands: \text{...} etc.
    s = s.replace(/\\text\{([^}]*)\}/g, '$1');
    s = s.replace(/\\[a-zA-Z]+\b\s*/g, '');

    // Clean up multiple spaces
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  };

  // --- Replace display math blocks first ---
  // \[ ... \]
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, body) => {
    const readable = convertMath(body);
    return `\n[ ${readable} ]\n`;
  });

  // $$ ... $$
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, body) => {
    const readable = convertMath(body);
    return `\n[ ${readable} ]\n`;
  });

  // --- Replace inline math ---
  // \( ... \)
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, body) => convertMath(body));

  // $ ... $ (single, non-greedy, no newlines)
  text = text.replace(/\$(?!\$)([^$\n]+?)\$/g, (_, body) => convertMath(body));

  // --- Bare LaTeX macros outside delimiters (AI sometimes writes them raw) ---
  // e.g. \frac{dy}{dx} or \dfrac{d^2y}{dx^2}
  // These are typically on their own line or part of a sentence
  text = text.replace(/(?<![`\w])\\[dct]?frac\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, (m) => convertMath(m));

  return text;
}

/**
 * Strip characters that PDFKit's built-in fonts (Helvetica/Times/Courier) cannot
 * represent — these are WinAnsi-range fonts so anything outside Latin-1 + common
 * symbols either renders as a box or corrupts the glyph stream.
 * We replace them with a safe ASCII approximation where possible.
 */
function sanitiseText(text) {
  if (!text) return '';
  return text
    // ── Step 1: Transliterate common Unicode diacritics to ASCII equivalents
    // Sanskrit / Indic romanization (covers most philosophy textbook terms)
    .replace(/[\u0100\u0101]/g, 'a')   // Ā ā
    .replace(/[\u012A\u012B]/g, 'i')   // Ī ī
    .replace(/[\u016A\u016B]/g, 'u')   // Ū ū
    .replace(/[\u1E6C\u1E6D]/g, 't')   // Ṭ ṭ
    .replace(/[\u1E0C\u1E0D]/g, 'd')   // Ḍ ḍ
    .replace(/[\u1E46\u1E47]/g, 'n')   // Ṇ ṇ
    .replace(/[\u015A\u015B]/g, 's')   // Ś ś
    .replace(/[\u1E62\u1E63]/g, 's')   // Ṣ ṣ
    .replace(/[\u1E42\u1E43]/g, 'm')   // Ṃ ṃ
    .replace(/[\u1E24\u1E25]/g, 'h')   // Ḥ ḥ
    .replace(/[\u1E44\u1E45]/g, 'n')   // Ṅ ṅ
    .replace(/[\u1E36\u1E37]/g, 'l')   // Ḷ ḷ
    .replace(/[\u1E5A\u1E5B]/g, 'r')   // Ṛ ṛ
    // Broader Latin extended (Czech, Polish, Hungarian, etc.)
    .replace(/[\u0102\u0103\u01CE\u01CF]/g, 'a') // Ă ă
    .replace(/[\u0106\u0107\u010C\u010D]/g, 'c') // Ć ć Č č
    .replace(/[\u010E\u010F]/g, 'd')   // Ď ď
    .replace(/[\u0118\u0119\u011A\u011B]/g, 'e') // Ę ę Ě ě
    .replace(/[\u011E\u011F]/g, 'g')   // Ğ ğ
    .replace(/[\u0130\u0131]/g, 'i')   // İ ı
    .replace(/[\u0141\u0142]/g, 'l')   // Ł ł
    .replace(/[\u0143\u0144\u0147\u0148]/g, 'n') // Ń ń Ň ň
    .replace(/[\u0150\u0151]/g, 'o')   // Ő ő
    .replace(/[\u0154\u0155\u0158\u0159]/g, 'r') // Ŕ ŕ Ř ř
    .replace(/[\u015E\u015F\u0160\u0161]/g, 's') // Ş ş Š š
    .replace(/[\u0162\u0163\u0164\u0165]/g, 't') // Ţ ţ Ť ť
    .replace(/[\u016E\u016F\u0170\u0171]/g, 'u') // Ů ů Ű ű
    .replace(/[\u0178]/g, 'y')          // Ÿ
    .replace(/[\u0179\u017A\u017B\u017C\u017D\u017E]/g, 'z') // Ź ź Ż ż Ž ž
    // Greek letters commonly used in philosophy
    .replace(/\u03B1/g, 'alpha').replace(/\u03B2/g, 'beta').replace(/\u03B3/g, 'gamma')
    .replace(/\u03B4/g, 'delta').replace(/\u03BB/g, 'lambda').replace(/\u03C6/g, 'phi')
    .replace(/\u03C8/g, 'psi').replace(/\u03C9/g, 'omega').replace(/\u03B5/g, 'epsilon')
    .replace(/\u03B8/g, 'theta').replace(/\u03BC/g, 'mu').replace(/\u03C0/g, 'pi')
    .replace(/\u03C3/g, 'sigma').replace(/\u03C4/g, 'tau').replace(/\u03BD/g, 'nu')
    .replace(/\u03BA/g, 'kappa').replace(/\u03B7/g, 'eta').replace(/\u03C1/g, 'rho')
    // ── Step 2: Common typographic replacements → ASCII
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2022\u2023\u2043\u204C\u204D]/g, '-')
    .replace(/[\u00B7\u2027]/g, '.')
    // ── Step 3: Strip anything still outside printable Latin-1 (0x20–0xFF)
    // EXCEPT Unicode math symbols produced by latexToReadable() which we want to keep:
    //   Greek letters (U+03B1–U+03C9, U+0391–U+03A9)
    //   Math operators, arrows, sets (U+00B1, U+00B7, U+00D7, U+00F7, U+2200–U+22FF)
    //   Integrals, sums (U+222B–U+222E)
    //   Square root (U+221A), infinity (U+221E), partial (U+2202), nabla (U+2207)
    .replace(/[^\x09\x0A\x0D\x20-\xFF\u0391-\u03C9\u00B1\u00B7\u00D7\u00F7\u2190-\u21FF\u2200-\u22FF]/g, '')
    // Remove leftover isolated asterisks or markdown artefacts
    .replace(/(^|\s)\*(\s|$)/g, '$1 $2')
    .trim();
}

/**
 * Render a line with inline **bold** and *italic* formatting.
 * Uses a flat segment approach — no PDFKit continued-chain — to avoid
 * text scatter caused by indent + continued interactions.
 */
function renderInlineFormatting(doc, rawText, fonts, fontSize, indent) {
  const text = sanitiseText(latexToReadable(rawText));
  if (!text) return;

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right - indent;

  // Parse into segments: { text, bold, italic }
  const segments = [];
  // Only match **bold** and *italic* when the markers wrap non-whitespace content
  const TOKEN = /(\*\*[^*\n]+?\*\*)|(\*[^*\n]+?\*)/g;
  let last = 0;
  let m;
  while ((m = TOKEN.exec(text)) !== null) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), bold: false, italic: false });
    if (m[1]) segments.push({ text: m[1].slice(2, -2), bold: true,  italic: false });
    else       segments.push({ text: m[2].slice(1, -1), bold: false, italic: true  });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), bold: false, italic: false });

  // If no formatting present, single plain render — avoids any continued issues
  if (segments.length === 1 && !segments[0].bold && !segments[0].italic) {
    doc.font(fonts.normal).fontSize(fontSize).fillColor(COLORS.text)
       .text(segments[0].text, { width: pageWidth, indent, lineGap: 2 });
    return;
  }

  const fullPlain = segments.map(s => s.text).join('');
  const lineEstimate = Math.ceil((fullPlain.length * (fontSize * 0.55)) / pageWidth);

  if (lineEstimate > 2) {
    doc.font(fonts.normal).fontSize(fontSize).fillColor(COLORS.text)
       .text(fullPlain, { width: pageWidth, indent, lineGap: 2 });
    return;
  }

  // Single/double line: safe to use continued chain
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const isLast = si === segments.length - 1;
    const segFont = seg.bold ? fonts.bold : seg.italic ? fonts.italic : fonts.normal;
    const opts = {
      width: pageWidth,
      indent: si === 0 ? indent : 0,
      continued: !isLast,
      lineGap: 2
    };
    doc.font(segFont).fontSize(fontSize).fillColor(COLORS.text).text(seg.text, opts);
  }
  // Close the continuing chain if needed
  doc.text('', { continued: false });
}

/**
 * Generate a professional PDF from a course outline session.
 *
 * @param {Object} sessionData — Full SummarySession document
 * @param {Object} options — Export options
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateNotesPDF(sessionData, options = {}) {
  const {
    userName = '',
    watermark = true,
    fontSize = 11,
    fontFamily = 'Helvetica'
  } = options;

  const fontMap = {
    'Helvetica': { normal: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' },
    'Times': { normal: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic' },
    'Courier': { normal: 'Courier', bold: 'Courier-Bold', italic: 'Courier-Oblique' }
  };
  const fonts = fontMap[fontFamily] || fontMap['Helvetica'];

  const courseName = sessionData.courseName || sessionData.title || 'Course Notes';
  const chapters = sessionData.chapters || [];
  const depthTier = sessionData.depthTier || 'standard';
  const totalSubChapters = chapters.reduce((sum, ch) => sum + (ch.subChapters?.length || 0), 0);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 60, bottom: 60, left: 50, right: 50 },
        bufferPages: true,
        info: {
          Title: courseName,
          Author: 'Vayrex Learning',
          Subject: `Course Notes - ${courseName}`,
          Creator: 'Vayrex Learning Platform'
        }
      });

      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // ===== TITLE PAGE =====
      doc.moveDown(5);
      doc.font(fonts.bold).fontSize(28).fillColor(COLORS.primary)
        .text(courseName, { align: 'center' });
      doc.moveDown(0.5);
      // doc.font(fonts.normal).fontSize(14).fillColor(COLORS.accent)
      //   .text('AI-Generated Study Notes', { align: 'center' });
      doc.moveDown(2);

      // Divider
      const divY = doc.y;
      doc.moveTo(150, divY).lineTo(445, divY).strokeColor(COLORS.accent).lineWidth(2).stroke();
      doc.moveDown(2);

      // Info
      doc.font(fonts.normal).fontSize(fontSize).fillColor(COLORS.secondary);
      if (userName) {
        doc.text(`Prepared for: ${userName}`, { align: 'center' });
        doc.moveDown(0.3);
      }
      doc.text(`Chapters: ${chapters.length}  |  Sub-chapters: ${totalSubChapters}  |  Depth: ${depthTier}`, { align: 'center' });
      doc.moveDown(0.3);
      doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, { align: 'center' });
      doc.moveDown(3);

      // AI Disclaimer
      doc.font(fonts.italic).fontSize(8.5).fillColor(COLORS.mediumGray)
        .text(
          'DISCLAIMER: These notes are AI-generated from general academic knowledge based on a course outline. ' +
          'They may not reflect your lecturer\'s specific teaching material. Always cross-reference with your course content.',
          { align: 'center', width: 400 }
        );
      doc.moveDown(1);
      doc.font(fonts.italic).fontSize(9).fillColor(COLORS.mediumGray)
        .text('Generated by Vayrex Learning Platform', { align: 'center' });

      // ===== TABLE OF CONTENTS =====
      doc.addPage();
      doc.font(fonts.bold).fontSize(22).fillColor(COLORS.primary)
        .text('Table of Contents', { align: 'center' });
      doc.moveDown(1.5);

      for (const chapter of chapters) {
        const chNum = chapter.id;
        // Chapter entry
        doc.font(fonts.bold).fontSize(fontSize).fillColor(COLORS.primary)
          .text(`Chapter ${chNum}: ${chapter.title}`, { indent: 0 });
        doc.moveDown(0.2);

        // Sub-chapter entries
        if (chapter.subChapters?.length) {
          for (const sc of chapter.subChapters) {
            doc.font(fonts.normal).fontSize(fontSize - 1).fillColor(COLORS.secondary)
              .text(`    ${sc.number}  ${sc.title}`, { indent: 20 });
            doc.moveDown(0.1);
          }
        }
        doc.moveDown(0.4);

        // Safety: avoid overflowing the TOC page
        if (doc.y > doc.page.height - 100) {
          doc.addPage();
        }
      }

      // ===== CHAPTER CONTENT =====
      for (const chapter of chapters) {
        const chNum = chapter.id;

        // Chapter title page / separator
        doc.addPage();
        doc.moveDown(3);
        doc.font(fonts.bold).fontSize(14).fillColor(COLORS.accent)
          .text(`CHAPTER ${chNum}`, { align: 'center' });
        doc.moveDown(0.5);
        doc.font(fonts.bold).fontSize(22).fillColor(COLORS.primary)
          .text(chapter.title, { align: 'center' });
        doc.moveDown(1);
        const chDivY = doc.y;
        doc.moveTo(100, chDivY).lineTo(495, chDivY).strokeColor(COLORS.lightGray).lineWidth(1).stroke();
        doc.moveDown(1.5);

        // Chapter overview (X.0)
        if (chapter.overview) {
          doc.font(fonts.bold).fontSize(fontSize + 1).fillColor(COLORS.accent)
            .text('Overview');
          doc.moveDown(0.5);
          renderMarkdownContent(doc, chapter.overview, fonts, fontSize);
          doc.moveDown(1);
        }

        // Sub-chapters
        if (chapter.subChapters?.length) {
          for (const sc of chapter.subChapters) {
            // Check if we need a new page
            if (doc.y > doc.page.height - 150) {
              doc.addPage();
            }

            // Sub-chapter heading
            doc.font(fonts.bold).fontSize(fontSize + 1).fillColor(COLORS.primary)
              .text(`${sc.number}  ${sc.title}`);
            doc.moveDown(0.4);

            // Sub-chapter content
            if (sc.status === 'failed') {
              doc.font(fonts.italic).fontSize(fontSize).fillColor(COLORS.incorrect)
                .text('This section could not be generated. Please try regenerating this sub-chapter.');
            } else {
              renderMarkdownContent(doc, sc.content, fonts, fontSize);
            }
            doc.moveDown(1);
          }
        }
      }

      // ===== WATERMARK ON ALL PAGES =====
      if (watermark) {
        const pages = doc.bufferedPageRange();
        for (let i = pages.start; i < pages.start + pages.count; i++) {
          doc.switchToPage(i);
          addWatermark(doc);
        }
      }

      // ===== PAGE NUMBERS =====
      const pageRange = doc.bufferedPageRange();
      for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
        doc.switchToPage(i);
        addFooter(doc, i + 1, pageRange.count, fonts);
      }

      doc.end();
    } catch (error) {
      Logger.error('Notes PDF generation error', { error: error.message });
      reject(error);
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// ─── File Summary PDF Export ─────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Generate a professional PDF from a file-summary session.
 *
 * File summaries use: hook, coreTeaching[{sectionTitle, content}], keyTakeaways[], notes
 * (no subChapters — that's the course-outline variant).
 *
 * @param {Object} sessionData — Full SummarySession document (lean)
 * @param {Object} options — Export options
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateSummaryPDF(sessionData, options = {}) {
  const {
    userName = '',
    watermark = true,
    fontSize = 13,
    fontFamily = 'Helvetica',
    sourceImages = []       // Array of { buffer: Buffer, name, slideNumber, type }
  } = options;

  const fontMap = {
    'Helvetica': { normal: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' },
    'Times': { normal: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic' },
    'Courier': { normal: 'Courier', bold: 'Courier-Bold', italic: 'Courier-Oblique' }
  };
  const fonts = fontMap[fontFamily] || fontMap['Helvetica'];

  const title = sessionData.title || 'Study Summary';
  // Sort chapters by id so they always appear in the correct order
  const chapters = (sessionData.chapters || []).slice().sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

  // Build chapter→image map using positional matching (chapterId tags) or fallback to even distribution
  const embeddableTypes = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'tiff', 'bmp']);
  const validImages = sourceImages.filter(
    img => img.buffer && embeddableTypes.has((img.type || '').toLowerCase())
  ).sort((a, b) => (a.position || a.slideNumber || 0) - (b.position || b.slideNumber || 0));

  const chapterImageMap = {};
  if (validImages.length > 0 && chapters.length > 0) {
    const hasChapterTags = validImages.some(img => img.chapterId != null);
    if (hasChapterTags) {
      // Positional distribution: images tagged with their target chapter
      for (const img of validImages) {
        const cid = img.chapterId;
        if (cid == null) continue;
        if (!chapterImageMap[cid]) chapterImageMap[cid] = [];
        chapterImageMap[cid].push(img);
      }
    } else {
      // Fallback: even distribution by position order
      const perChapter = Math.ceil(validImages.length / chapters.length);
      for (let i = 0; i < chapters.length; i++) {
        chapterImageMap[chapters[i].id] = validImages.slice(i * perChapter, (i + 1) * perChapter);
      }
    }
  }

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 60, bottom: 60, left: 50, right: 50 },
        bufferPages: true,
        info: {
          Title: title,
          Author: 'Vayrex Learning',
          Subject: `Study Summary - ${title}`,
          Creator: 'Vayrex Learning Platform'
        }
      });

      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // ===== TITLE PAGE =====
      doc.moveDown(5);
      doc.font(fonts.bold).fontSize(28).fillColor(COLORS.primary)
        .text(title, { align: 'center' });
      doc.moveDown(0.5);
      doc.font(fonts.normal).fontSize(14).fillColor(COLORS.accent)
        .text('AI-Generated Study Summary', { align: 'center' });
      doc.moveDown(2);

      const divY = doc.y;
      doc.moveTo(150, divY).lineTo(445, divY).strokeColor(COLORS.accent).lineWidth(2).stroke();
      doc.moveDown(2);

      doc.font(fonts.normal).fontSize(fontSize).fillColor(COLORS.secondary);
      if (userName) {
        doc.text(`Prepared for: ${userName}`, { align: 'center' });
        doc.moveDown(0.3);
      }
      doc.text(`Chapters: ${chapters.length}`, { align: 'center' });
      doc.moveDown(0.3);
      doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, { align: 'center' });
      doc.moveDown(3);

      doc.font(fonts.italic).fontSize(9).fillColor(COLORS.mediumGray)
        .text('Generated by Vayrex Learning Platform', { align: 'center' });

      // ===== TABLE OF CONTENTS =====
      if (chapters.length > 1) {
        doc.addPage();
        doc.font(fonts.bold).fontSize(22).fillColor(COLORS.primary)
          .text('Table of Contents', { align: 'center' });
        doc.moveDown(1.5);

        for (const chapter of chapters) {
          doc.font(fonts.bold).fontSize(fontSize).fillColor(COLORS.primary)
            .text(`Chapter ${chapter.id}: ${chapter.title}`, { indent: 0 });
          doc.moveDown(0.4);
          if (doc.y > doc.page.height - 100) doc.addPage();
        }
      }

      // ===== CHAPTER CONTENT =====
      for (const chapter of chapters) {
        doc.addPage();
        doc.moveDown(2);
        doc.font(fonts.bold).fontSize(14).fillColor(COLORS.accent)
          .text(`CHAPTER ${chapter.id}`, { align: 'center' });
        doc.moveDown(0.5);
        doc.font(fonts.bold).fontSize(22).fillColor(COLORS.primary)
          .text(chapter.title, { align: 'center' });
        doc.moveDown(1);
        const chDivY = doc.y;
        doc.moveTo(100, chDivY).lineTo(495, chDivY).strokeColor(COLORS.lightGray).lineWidth(1).stroke();
        doc.moveDown(1.5);

        // Hook / intro paragraph
        if (chapter.hook) {
          doc.font(fonts.italic).fontSize(fontSize).fillColor(COLORS.accent);
          renderMarkdownContent(doc, chapter.hook, fonts, fontSize);
          doc.moveDown(1);
        }

        // Core teaching sections
        if (chapter.coreTeaching?.length) {
          for (const section of chapter.coreTeaching) {
            if (doc.y > doc.page.height - 150) doc.addPage();

            if (section.sectionTitle) {
              doc.font(fonts.bold).fontSize(fontSize + 1).fillColor(COLORS.primary)
                .text(section.sectionTitle);
              doc.moveDown(0.4);
            }
            if (section.content) {
              renderMarkdownContent(doc, section.content, fonts, fontSize);
              doc.moveDown(0.8);
            }
          }
        }

        // Key takeaways
        if (chapter.keyTakeaways?.length) {
          if (doc.y > doc.page.height - 150) doc.addPage();
          doc.font(fonts.bold).fontSize(fontSize + 1).fillColor(COLORS.accent)
            .text('Key Takeaways');
          doc.moveDown(0.4);
          for (const takeaway of chapter.keyTakeaways) {
            renderInlineFormatting(doc, `  •  ${takeaway}`, fonts, fontSize - 0.5, 15);
            doc.moveDown(0.15);
          }
          doc.moveDown(0.8);
        }

        // User notes for this chapter
        if (chapter.notes) {
          if (doc.y > doc.page.height - 150) doc.addPage();
          doc.font(fonts.bold).fontSize(fontSize + 1).fillColor(COLORS.secondary)
            .text('Notes');
          doc.moveDown(0.4);
          renderMarkdownContent(doc, chapter.notes, fonts, fontSize);
          doc.moveDown(0.8);
        }

        // Embedded source images for this chapter
        const chImages = chapterImageMap[chapter.id] || [];
        if (chImages.length > 0) {
          if (doc.y > doc.page.height - 200) doc.addPage();
          doc.font(fonts.bold).fontSize(fontSize + 1).fillColor(COLORS.accent)
            .text('Figures');
          doc.moveDown(0.5);

          const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
          const maxImgHeight = 280;

          for (const img of chImages) {
            try {
              // Ensure enough space for the image; otherwise start a new page
              if (doc.y > doc.page.height - maxImgHeight - 60) doc.addPage();

              doc.image(img.buffer, {
                fit: [pageWidth, maxImgHeight],
                align: 'center',
                valign: 'center'
              });
              doc.moveDown(0.3);

              // Caption based on source format
              let caption = '';
              if (img.sourceFormat === 'pptx' && (img.slideNumber || img.position)) {
                caption = `Slide ${img.slideNumber || img.position}`;
              } else if (img.sourceFormat === 'pdf' && img.position) {
                caption = `Page ${img.position}`;
              } else if (img.name) {
                caption = img.name.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
              }
              if (caption) {
                doc.font(fonts.italic).fontSize(fontSize - 2).fillColor(COLORS.mediumGray)
                  .text(caption, { align: 'center' });
              }
              doc.moveDown(0.6);
            } catch (imgErr) {
              Logger.warn('Failed to embed image in summary PDF', { name: img.name, error: imgErr.message });
            }
          }
        }
      }

      // ===== WATERMARK ON ALL PAGES =====
      if (watermark) {
        const pages = doc.bufferedPageRange();
        for (let i = pages.start; i < pages.start + pages.count; i++) {
          doc.switchToPage(i);
          addWatermark(doc);
        }
      }

      // ===== PAGE NUMBERS =====
      const pageRange = doc.bufferedPageRange();
      for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
        doc.switchToPage(i);
        addFooter(doc, i + 1, pageRange.count, fonts);
      }

      doc.end();
    } catch (error) {
      Logger.error('Summary PDF generation error', { error: error.message });
      reject(error);
    }
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// ─── Puppeteer / KaTeX HTML-to-PDF Engine ────────────────────────────────────
// Renders math in proper textbook format using KaTeX, then converts to PDF via
// headless Chrome. Works for ALL content — math or plain text — so there's no
// need to decide which renderer to call.
// ═════════════════════════════════════════════════════════════════════════════



const katexForPdf = (() => {
  try { return require('katex'); } catch { return null; }
})();

// Read KaTeX CSS once from local node_modules so we never hit the network.
const katexCssForPdf = (() => {
  try {
    const path = require('path');
    const fs = require('fs');
    const cssPath = path.join(__dirname, '..', 'node_modules', 'katex', 'dist', 'katex.min.css');
    if (fs.existsSync(cssPath)) return fs.readFileSync(cssPath, 'utf8');
  } catch { /* ignore */ }
  return '';
})();

/**
 * Render a LaTeX string to an HTML span/div using server-side KaTeX.
 * Returns the original latex string (in a code tag) if katex is unavailable.
 */
function renderKatexSSR(latex, displayMode) {
  if (!katexForPdf) return `<code>${latex}</code>`;
  try {
    return katexForPdf.renderToString(latex.trim(), {
      displayMode,
      throwOnError: false,
      output: 'html',
    });
  } catch {
    return `<code>${latex}</code>`;
  }
}

/**
 * Shared HTML page wrapper. Embeds KaTeX CSS inline from local node_modules —
 * zero external network calls, so Puppeteer never needs to wait for the network.
 */
function buildHtmlPage(bodyHtml, { title = 'Vayrex Learning', watermark = true } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>${katexCssForPdf}</style>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 11pt; }
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      color: #1a202c;
      background: #ffffff;
      line-height: 1.7;
      padding: 0;
      margin: 0;
    }

    /* ── Page layout ── */
    .page {
      margin: 0 auto;
      padding: 4mm 0;
      page-break-after: always;
    }
    .page:last-child {
      page-break-after: auto;
    }
    @page {
      size: A4;
      margin: 18mm 18mm 22mm 18mm;
    }

    /* Prevent elements from being split across pages */
    h1, h2, h3, h4 {
      page-break-after: avoid;
      break-after: avoid;
    }
    p, li {
      orphans: 3;
      widows: 3;
    }
    .question-block, .key-takeaways, .notes-section, .katex-display-wrap, .math-block {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .chapter-header {
      page-break-inside: avoid;
      break-inside: avoid;
      page-break-after: avoid;
      break-after: avoid;
    }

    /* ── Watermark ── */
    .watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 80pt;
      font-weight: 700;
      color: rgba(0,0,0,0.04);
      letter-spacing: 0.15em;
      pointer-events: none;
      user-select: none;
      z-index: 0;
    }

    /* ── Typography ── */
    h1 { font-size: 2em; color: #1a365d; font-weight: 700; margin-bottom: 0.4em; line-height: 1.25; }
    h2 { font-size: 1.45em; color: #1a365d; font-weight: 600; margin: 1.4em 0 0.5em; border-bottom: 2px solid #3182ce; padding-bottom: 0.25em; }
    h3 { font-size: 1.15em; color: #2d3748; font-weight: 600; margin: 1.1em 0 0.35em; }
    h4 { font-size: 1em; color: #4a5568; font-weight: 600; margin: 0.9em 0 0.3em; }
    p  { margin: 0.55em 0; line-height: 1.75; }
    ul, ol { margin: 0.4em 0 0.6em 1.6em; }
    li { margin: 0.2em 0; }

    /* ── KaTeX display math ── */
    .katex-display, .katex-display-wrap {
      overflow-x: auto;
      overflow-y: hidden;
      margin: 1.1em 0;
      padding: 0.85em 1.2em;
      background: #f7fafc;
      border-left: 4px solid #3182ce;
      border-radius: 6px;
      page-break-inside: avoid;
    }
    .katex { font-size: 1.1em; }
    .katex-display > .katex { font-size: 1.25em; }
    .katex-inline-wrap { display: inline; }

    /* ── Math block (isolated formula on own line) ── */
    .math-block {
      text-align: center;
      margin: 1.2em auto;
      padding: 0.8em 1.5em;
      background: #f7fafc;
      border-radius: 6px;
      border-left: 4px solid #3182ce;
      overflow-x: auto;
    }

    /* ── Section / chapter structure ── */
    .chapter-header {
      text-align: center;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 1em;
      margin-bottom: 1.5em;
    }
    .chapter-label {
      font-size: 0.8em;
      font-weight: 600;
      color: #3182ce;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      margin-bottom: 0.4em;
    }
    .section-title { color: #3182ce; }
    .hook-text { color: #4a5568; font-style: italic; margin-bottom: 1em; }
    .key-takeaways { margin: 1em 0; padding: 0.85em 1.2em; background: #ebf8ff; border-radius: 6px; border-left: 4px solid #3182ce; }
    .key-takeaways h4 { color: #2b6cb0; margin-top: 0; }
    .notes-section { margin-top: 1em; padding: 0.85em 1.2em; background: #fefce8; border-radius: 6px; border-left: 4px solid #d69e2e; }

    /* ── Title page ── */
    .title-page { text-align: center; padding-top: 60mm; }
    .title-page h1 { font-size: 2.6em; }
    .title-page .subtitle { font-size: 1.1em; color: #3182ce; margin: 0.5em 0 2em; }
    .title-divider { border: none; border-top: 2px solid #3182ce; width: 60%; margin: 1.5em auto; }
    .title-meta { font-size: 0.9em; color: #718096; line-height: 2; }
    .disclaimer { margin-top: 2em; font-size: 0.78em; color: #a0aec0; max-width: 80%; margin-left: auto; margin-right: auto; }

    /* ── Questions PDF ── */
    .question-block { margin: 1.2em 0; padding-bottom: 1em; border-bottom: 1px solid #e2e8f0; page-break-inside: avoid; }
    .question-num { font-weight: 700; color: #1a365d; }
    .options { list-style: none; margin: 0.5em 0 0 1em; padding: 0; }
    .options li { margin: 0.3em 0; padding: 0.2em 0.4em; border-radius: 4px; }
    .options li.correct { background: #f0fff4; color: #276749; font-weight: 600; }
    .answer-line { border-bottom: 1px solid #718096; margin: 0.8em 0; min-width: 200px; display: inline-block; width: 70%; }
    .model-answer { margin-top: 0.5em; padding: 0.5em 0.8em; background: #f0fff4; border-radius: 4px; color: #276749; font-size: 0.9em; }
    .answer-key-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.25em 1em; margin: 1em 0; }
    .answer-key-item { font-size: 0.88em; }

    /* ── Footer ── */

    .footer {
      position: fixed;
      bottom: 10mm;
      left: 18mm;
      right: 18mm;
      font-size: 8pt;
      color: #a0aec0;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      padding-top: 4px;
    }

    /* ── Code blocks ── */
    pre, code { font-family: 'Courier New', monospace; font-size: 0.88em; }
    pre { background: #2d2d2d; color: #f8f8f2; padding: 1em; border-radius: 6px; overflow-x: auto; margin: 0.8em 0; }
    code { background: #edf2f7; padding: 0.15em 0.35em; border-radius: 3px; color: #c53030; }
    pre code { background: none; color: inherit; padding: 0; }

    strong { font-weight: 600; color: #1a202c; }
    em { font-style: italic; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 1.5em 0; }
  </style>
</head>
<body>
  ${watermark ? '<div class="watermark">VAYREX</div>' : ''}
  ${bodyHtml}
  <div class="footer">Vayrex Learning &nbsp;|&nbsp; ${new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
</body>
</html>`;
}

/**
 * Convert a markdown-lite + LaTeX string to an HTML string.
 * Math is pre-rendered server-side with KaTeX — no CDN JS needed in Puppeteer.
 * Handles: **bold**, *italic*, `code`, headings, bullet/numbered lists,
 *          \[...\], $$...$$, \(...\), $...$, bare \frac/{}{} etc.
 */
function mdToHtml(text = '') {
  if (!text) return '';

  // Escape HTML entities — only used for plain-text segments
  const escapeHtml = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ── Pre-render math delimiters via server-side KaTeX ──
  // We process the text before line-splitting so multi-line \[...\] blocks work.
  const mathBlocks = [];
  let processed = text;

  // 1. Display math: \[...\] and $$...$$
  processed = processed.replace(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g, (_, a, b) => {
    const latex = (a ?? b).trim();
    const html = renderKatexSSR(latex, true);
    const token = `__MATHBLOCK_${mathBlocks.length}__`;
    mathBlocks.push(`<div class="katex-display-wrap">${html}</div>`);
    return token;
  });

  // 2. Inline math: \(...\) and $...$
  processed = processed.replace(/\\\((.*?)\\\)|\$(?!\$)([^$\n]+?)\$/g, (_, a, b) => {
    const latex = (a ?? b).trim();
    const html = renderKatexSSR(latex, false);
    const token = `__MATHBLOCK_${mathBlocks.length}__`;
    mathBlocks.push(`<span class="katex-inline-wrap">${html}</span>`);
    return token;
  });

  // 3. Bare macros: \frac{}{}, \dfrac{}{}, \sqrt{} without delimiters
  processed = processed.replace(
    /(?<![`\w])\\(?:d|t|c)?frac\{(?:[^{}]|\{[^{}]*\})*\}\{(?:[^{}]|\{[^{}]*\})*\}|\\sqrt(?:\[[^\]]*\])?\{(?:[^{}]|\{[^{}]*\})*\}/g,
    (m) => {
      const html = renderKatexSSR(m, false);
      const token = `__MATHBLOCK_${mathBlocks.length}__`;
      mathBlocks.push(`<span class="katex-inline-wrap">${html}</span>`);
      return token;
    }
  );

  // ── Line-by-line markdown processing ──
  const lines = processed.split('\n');
  const out = [];
  let inList = null;
  let inPara = false;

  const closePara = () => { if (inPara) { out.push('</p>'); inPara = false; } };
  const closeList = () => { if (inList) { out.push(`</${inList}>`); inList = null; } };

  // Restore math tokens, then apply inline formatting
  const renderInlineMd = (s) => {
    // Restore math tokens first
    let restored = escapeHtml(s).replace(/&amp;amp;/g, '&amp;');
    // But don't escape tokens we injected
    restored = s.replace(/__MATHBLOCK_(\d+)__/g, (_, idx) => mathBlocks[+idx] || '');
    // Now escape and format the non-token parts
    return restored
      .replace(/(?<!__MATHBLOCK_\d+)([^_]+)(?!__)/g, (m) =>
        escapeHtml(m)
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
          .replace(/`([^`]+)`/g, '<code>$1</code>')
      );
  };

  // Simpler inline renderer — handles tokens + basic formatting
  const inlineRender = (s) => {
    const parts = s.split(/(__MATHBLOCK_\d+__)/);
    return parts.map(part => {
      const m = part.match(/^__MATHBLOCK_(\d+)__$/);
      if (m) return mathBlocks[+m[1]] || part;
      return escapeHtml(part)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
    }).join('');
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trim = line.trim();

    if (!trim) { closePara(); closeList(); continue; }

    const headMatch = trim.match(/^(#{1,4})\s+(.+)/);
    if (headMatch) {
      closePara(); closeList();
      const level = headMatch[1].length + 1;
      out.push(`<h${level}>${inlineRender(headMatch[2])}</h${level}>`);
      continue;
    }

    const bulletMatch = trim.match(/^[-•*▪▸►◦‣→]\s+(.+)/);
    if (bulletMatch) {
      closePara();
      if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul'; }
      out.push(`<li>${inlineRender(bulletMatch[1])}</li>`);
      continue;
    }

    const numMatch = trim.match(/^\d+[.)]\s+(.+)/);
    if (numMatch) {
      closePara();
      if (inList !== 'ol') { closeList(); out.push('<ol>'); inList = 'ol'; }
      out.push(`<li>${inlineRender(numMatch[1])}</li>`);
      continue;
    }

    closeList();
    if (!inPara) { out.push('<p>'); inPara = true; } else out.push(' ');
    out.push(inlineRender(trim));
  }

  closePara();
  closeList();
  return out.join('\n');
}

/**
 * Build the HTML body for a file-summary PDF.
 */
function buildSummaryHtmlBody(sessionData, { userName = '', includeImages = false } = {}) {
  const title = sessionData.title || 'Study Summary';
  const chapters = (sessionData.chapters || []).slice()
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

  const chapterCount = chapters.length;

  let body = `
<div class="page title-page">
  <h1>${title}</h1>
  <p class="subtitle">AI-Generated Study Summary</p>
  <hr class="title-divider" />
  <div class="title-meta">
    ${userName ? `<div>Prepared for: <strong>${userName}</strong></div>` : ''}
    <div>Chapters: <strong>${chapterCount}</strong></div>
    <div>Generated: <strong>${new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}</strong></div>
  </div>
  <p class="disclaimer">These notes are AI-generated from your uploaded material. Always cross-reference with your course content.</p>
</div>`;

  for (const chapter of chapters) {
    body += `\n<div class="page">`;
    body += `\n<div class="chapter-header">`;
    body += `\n<div class="chapter-label">Chapter ${chapter.id}</div>`;
    body += `\n<h1>${chapter.title || 'Untitled Chapter'}</h1>`;
    body += `\n</div>`;

    if (chapter.hook) {
      body += `\n<p class="hook-text">${mdToHtml(chapter.hook)}</p>`;
    }

    if (chapter.coreTeaching?.length) {
      for (const section of chapter.coreTeaching) {
        if (section.sectionTitle) {
          body += `\n<h3 class="section-title">${section.sectionTitle}</h3>`;
        }
        if (section.content) {
          body += `\n${mdToHtml(section.content)}`;
        }
      }
    }

    if (chapter.keyTakeaways?.length) {
      body += `\n<div class="key-takeaways"><h4>Key Takeaways</h4><ul>`;
      for (const tk of chapter.keyTakeaways) {
        body += `<li>${mdToHtml(tk)}</li>`;
      }
      body += `</ul></div>`;
    }

    if (chapter.notes) {
      body += `\n<div class="notes-section"><h4>Notes</h4>${mdToHtml(chapter.notes)}</div>`;
    }

    body += `\n</div>`;
  }

  return body;
}

/**
 * Build the HTML body for a course-outline notes PDF.
 */
function buildNotesHtmlBody(sessionData, { userName = '' } = {}) {
  const courseName = sessionData.courseName || sessionData.title || 'Course Notes';
  const chapters = sessionData.chapters || [];
  const depthTier = sessionData.depthTier || 'standard';

  let body = `
<div class="page title-page">
  <h1>${courseName}</h1>
  <p class="subtitle">AI-Generated Course Notes</p>
  <hr class="title-divider" />
  <div class="title-meta">
    ${userName ? `<div>Prepared for: <strong>${userName}</strong></div>` : ''}
    <div>Chapters: <strong>${chapters.length}</strong></div>
    <div>Depth: <strong>${depthTier}</strong></div>
    <div>Generated: <strong>${new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}</strong></div>
  </div>
  <p class="disclaimer">These notes are AI-generated from a course outline. Always cross-reference with your course material.</p>
</div>`;

  for (const chapter of chapters) {
    body += `\n<div class="page">`;
    body += `\n<div class="chapter-header">`;
    body += `\n<div class="chapter-label">Chapter ${chapter.id}</div>`;
    body += `\n<h1>${chapter.title || 'Untitled Chapter'}</h1>`;
    body += `\n</div>`;

    if (chapter.overview) {
      body += `\n<h3>Overview</h3>${mdToHtml(chapter.overview)}`;
    }

    if (chapter.subChapters?.length) {
      for (const sc of chapter.subChapters) {
        body += `\n<h3>${sc.number} &nbsp; ${sc.title}</h3>`;
        if (sc.status === 'failed') {
          body += `<p style="color:#c53030;font-style:italic;">This section could not be generated.</p>`;
        } else if (sc.content) {
          body += `\n${mdToHtml(sc.content)}`;
        }
      }
    }

    body += `\n</div>`;
  }

  return body;
}

/**
 * Build the HTML body for a quiz / question-bank PDF.
 */
function buildQuestionsHtmlBody(questions, { title = 'Question Bank', topic = '', userName = '', includeAnswers = true, difficulty = null } = {}) {
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];

  let body = `
<div class="page title-page">
  <h1>${title}</h1>
  ${topic ? `<p class="subtitle">${topic}</p>` : ''}
  <hr class="title-divider" />
  <div class="title-meta">
    ${userName ? `<div>Prepared for: <strong>${userName}</strong></div>` : ''}
    <div>Total Questions: <strong>${questions.length}</strong></div>
    ${difficulty ? `<div>Difficulty: <strong>${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}</strong></div>` : ''}
    <div>Generated: <strong>${new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}</strong></div>
  </div>
</div>

<div class="page">
  <h2>Questions</h2>`;

  questions.forEach((q, idx) => {
    const num = idx + 1;
    const qType = (q.questionType || '').toLowerCase();
    const isFill = qType === 'fill-in-blank' || qType === 'fill-in-gap';
    const isTheory = qType === 'theory' || qType === 'short-answer' || qType === 'essay';
    const qText = q.questionText || q.question || q.text || '';

    body += `\n<div class="question-block">`;
    body += `\n<p><span class="question-num">Q${num}.</span> ${mdToHtml(qText)}</p>`;

    if (q.options && q.options.length > 0) {
      body += `\n<ul class="options">`;
      q.options.forEach((opt, oi) => {
        const isCorrect = includeAnswers && (
          q.correctAnswer === oi || q.answer === labels[oi] || q.answer === opt
        );
        const cleanOpt = String(opt).replace(/^[A-Fa-f][.):\s]\s*/i, '');
        body += `<li ${isCorrect ? 'class="correct"' : ''}>${labels[oi]}. ${mdToHtml(cleanOpt)}</li>`;
      });
      body += `</ul>`;
    } else if (isFill) {
      body += `\n<div style="margin-top:0.5em;"><span class="answer-line"></span></div>`;
      if (includeAnswers && q.blankAnswer) {
        body += `<div class="model-answer">Answer: ${mdToHtml(q.blankAnswer)}</div>`;
      }
    } else if (isTheory) {
      body += `\n<p style="color:#718096;font-size:0.9em;font-style:italic;">[Written response required]</p>`;
      if (includeAnswers && q.modelAnswer) {
        body += `<div class="model-answer"><strong>Model Answer:</strong> ${mdToHtml(q.modelAnswer)}</div>`;
      }
    }

    body += `\n</div>`;
  });

  body += `\n</div>`;

  // Answer key
  if (includeAnswers && questions.some(q => q.correctAnswer != null || q.blankAnswer || q.answer)) {
    body += `\n<div class="page"><h2>Answer Key</h2><div class="answer-key-grid">`;
    questions.forEach((q, idx) => {
      const qType = (q.questionType || '').toLowerCase();
      const isFill = qType === 'fill-in-blank' || qType === 'fill-in-gap';
      let ans = '';
      if (isFill && q.blankAnswer) {
        const bl = q.blankAnswer;
        ans = bl.length > 18 ? bl.substring(0, 15) + '...' : bl;
      } else if (q.correctAnswer != null && q.options?.length) {
        ans = labels[q.correctAnswer] || String(q.correctAnswer);
      } else if (q.answer) {
        ans = q.answer;
      } else return;
      body += `<div class="answer-key-item">${idx + 1}. ${ans}</div>`;
    });
    body += `</div></div>`;
  }

  return body;
}

/**
 * Launch Puppeteer, render the HTML, and return a PDF Buffer.
 * All resources are inlined — no network calls needed inside the browser.
 */
async function htmlToPdfBuffer(htmlString, pdfTitle = 'Vayrex') {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    throw new Error('Puppeteer not installed. Run: cd backend && npm install puppeteer');
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--disable-web-security',
      '--font-render-hinting=none',
    ],
  });

  try {
    const page = await browser.newPage();

    // All math is pre-rendered server-side and CSS is inlined —
    // 'domcontentloaded' is instant and doesn't block on network requests.
    await page.setContent(htmlString, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '22mm', left: '18mm', right: '18mm' },
      displayHeaderFooter: false,
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

// ─── Overridden export functions — now use Puppeteer + KaTeX ─────────────────

/**
 * Generate a textbook-quality PDF for a file-summary session.
 * Drop-in replacement for the PDFKit version above.
 */
async function generateSummaryPDFv2(sessionData, options = {}) {
  try {
    const body = buildSummaryHtmlBody(sessionData, options);
    const html = buildHtmlPage(body, {
      title: sessionData.title || 'Study Summary',
      watermark: options.watermark !== false,
    });
    return await htmlToPdfBuffer(html, sessionData.title || 'Summary');
  } catch (err) {
    Logger.error('Puppeteer summary PDF failed, falling back to PDFKit', { error: err.message });
    return generateSummaryPDF(sessionData, options);
  }
}

/**
 * Generate a textbook-quality PDF for a course-outline notes session.
 */
async function generateNotesPDFv2(sessionData, options = {}) {
  try {
    const body = buildNotesHtmlBody(sessionData, options);
    const html = buildHtmlPage(body, {
      title: sessionData.courseName || sessionData.title || 'Course Notes',
      watermark: options.watermark !== false,
    });
    return await htmlToPdfBuffer(html, sessionData.courseName || 'Notes');
  } catch (err) {
    Logger.error('Puppeteer notes PDF failed, falling back to PDFKit', { error: err.message });
    return generateNotesPDF(sessionData, options);
  }
}

/**
 * Generate a textbook-quality question-bank PDF.
 */
async function generateQuestionsPDFv2(questions, options = {}) {
  try {
    const body = buildQuestionsHtmlBody(questions, options);
    const html = buildHtmlPage(body, {
      title: options.title || 'Question Bank',
      watermark: options.watermark !== false,
    });
    return await htmlToPdfBuffer(html, options.title || 'Quiz');
  } catch (err) {
    Logger.error('Puppeteer questions PDF failed, falling back to PDFKit', { error: err.message });
    return generateQuestionsPDF(questions, options);
  }
}

async function generateExamPDFv2(questions, options = {}) {
  return generateQuestionsPDFv2(questions, {
    ...options,
    includeAnswers: false,
    title: options.title || 'Examination Paper',
  });
}

module.exports = {
  // ── Puppeteer + KaTeX renderers (primary — textbook quality) ──
  generateQuestionsPDF: generateQuestionsPDFv2,
  generateExamPDF: generateExamPDFv2,
  generateNotesPDF: generateNotesPDFv2,
  generateSummaryPDF: generateSummaryPDFv2,
  AVAILABLE_FONTS: ['Helvetica', 'Times', 'Courier'],
  // ── Raw PDFKit renderers (kept for internal fallback only) ──
  _pdfkitQuestionsPDF: generateQuestionsPDF,
  _pdfkitNotesPDF: generateNotesPDF,
  _pdfkitSummaryPDF: generateSummaryPDF,
};
