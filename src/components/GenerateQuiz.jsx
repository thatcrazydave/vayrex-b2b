import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import katex from 'katex';
import { FaUpload, FaFileAlt, FaSpinner, FaCheckCircle, FaExclamationTriangle, FaBookOpen, FaRobot, FaArrowLeft, FaVolumeUp, FaVolumeMute, FaStickyNote, FaPodcast, FaPaperPlane, FaTimes, FaChevronRight, FaChevronLeft, FaBars, FaList, FaStop, FaPause, FaPlay, FaHighlighter, FaPen, FaChevronDown, FaChevronUp, FaHistory, FaTrash, FaQuestionCircle, FaSlash, FaBolt, FaRedoAlt } from 'react-icons/fa';
import '../styles/generatequiz.css';
import { handleApiError } from '../utils/errorHandler';
import { useAuth } from '../contexts/AuthContext.jsx';
import API, { aiSummarize, aiSummarizeText, aiChat, aiSummarizeStart, getSummarySessions, getSummarySession, saveSummaryChat, saveSummaryPosition, saveAnnotations, getChatThreads, createChatThread, getChatThread, saveChatThreadMessages, renameChatThread, deleteChatThread, setActiveThread, deleteSummarySession, generateQuizFromSummary, quickCheck, parseCourseOutline, generateCourseOutlineNotes, subscribeToCourseOutlineStream, exportCourseOutlineNotes, exportSummaryPDF, retryCourseOutlineFailures } from '../services/api';
import { showToast } from '../utils/toast';
import { parseContentSegments } from '../utils/codeSegments';
import LiveCodeEditor from './common/LiveCodeEditor';

// ===== Map backend error codes to actionable user messages =====
function getErrorMessage(errorData, httpStatus) {
  const code = errorData?.error?.code;
  const retryAfter = errorData?.error?.retryAfter;
  const serverMessage = errorData?.error?.message;

  const CODE_MESSAGES = {
    // Auth errors — NEVER show as "Too many requests"
    NO_TOKEN: "Your session has expired. Please log in again.",
    INVALID_TOKEN: "Your session has expired. Please log in again.",
    TOKEN_EXPIRED: "Your session has expired. Please log in again.",
    NOT_AUTHENTICATED: "Please log in to use this feature.",
    // Plan / quota limits (403) — NOT rate limits
    UPLOAD_LIMIT_REACHED: "You've reached your monthly upload limit. Upgrade your plan to continue.",
    TOKEN_LIMIT_REACHED: "You've used all your AI tokens this month. Upgrade your plan for more.",
    TOKEN_REQUEST_LIMIT: "This request is too large for your current plan. Try fewer questions or upgrade.",
    FILE_TOO_LARGE: "Your file exceeds the size limit for your plan. Try a smaller file or upgrade.",
    STORAGE_LIMIT_REACHED: "You've run out of storage space. Delete old files or upgrade your plan.",
    // Queue / capacity limits (503) — NOT rate limits
    USER_JOB_LIMIT: serverMessage || "You already have an active job running. Please wait for it to finish.",
    QUEUE_OVERLOADED: "The system is busy right now. Please try again in a few minutes.",
    QUEUE_ERROR: "Failed to start processing. Please try again.",
    // Actual rate limits (429)
    RATE_LIMIT_EXCEEDED: retryAfter
      ? `Too many requests. Please wait ${Math.ceil(retryAfter / 60)} minute(s) before trying again.`
      : "Too many requests. Please wait a moment and try again.",
    RATE_LIMIT_BLOCKED: retryAfter
      ? `You've been temporarily blocked. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`
      : "Too many requests. You are temporarily blocked. Please wait and try again.",
    // Input errors
    INVALID_TOPIC: "Topic must be 3-80 characters. Letters, numbers, and spaces are all allowed.",
    INVALID_DIFFICULTY: "Difficulty must be one of: Easy, Medium, or Hard.",
    INVALID_QUESTION_COUNT: "Number of questions must be between 10 and 200.",
    INSUFFICIENT_CONTENT: "Not enough content detected. Please provide at least 100 characters of text.",
    NO_INPUT: "Please provide either a file or text content to generate questions from.",
    // Processing errors
    NO_QUESTIONS: "Could not generate questions from this content. Try a more detailed topic or different material.",
    NO_VALID_QUESTIONS: "Questions were generated but didn't pass quality checks. Please try different content.",
    NON_ACADEMIC_CONTENT: "The content doesn't appear to be academic material. Please upload study notes or textbooks.",
    IMAGE_PROCESSING_ERROR: "Failed to process the image. Please ensure it's a clear, readable image.",
    AI_ERROR: "AI processing failed. Please try again.",
    SERVER_ERROR: "Something went wrong on our end. Please try again.",
    // File errors
    INVALID_FILE_TYPE: "This file type is not supported. Please use PDF, DOCX, TXT, PNG, JPG, or PPTX.",
    FILE_TYPE_MISMATCH: "The file content doesn't match its extension. Please check the file is not corrupted.",
    EMPTY_FILE: "The uploaded file is empty. Please select a valid file.",
    UNSUPPORTED_FILE: "Unsupported file type. Please use PDF, DOCX, TXT, PNG, JPG, JPEG, WEBP, or PPTX.",
    INVALID_CSRF_TOKEN: "Security token expired. Please refresh the page and try again.",
  };

  // If we have a specific code mapping, always use it (never fall through to generic 429 message)
  if (code && CODE_MESSAGES[code]) {
    return CODE_MESSAGES[code];
  }

  // Only show "Too many requests" for ACTUAL 429 with no known code
  if (httpStatus === 429) {
    return retryAfter
      ? `Too many requests. Please wait ${Math.ceil(retryAfter / 60)} minute(s) before trying again.`
      : "Too many requests. Please wait a moment and try again.";
  }

  // For 401, always show session expired — never a generic error
  if (httpStatus === 401) {
    return "Your session has expired. Please log in again.";
  }

  // For 503, always show system busy — never a generic error
  if (httpStatus === 503) {
    return serverMessage || "The system is temporarily unavailable. Please try again in a moment.";
  }

  // Fall through to server message or generic
  return serverMessage
    || errorData?.message
    || "Something went wrong. Please try again.";
}

// ─────────────────────────────────────────────────────────────────────────────
// renderTutorMarkdown — converts AI markdown to React elements.
// Handles: headers, bullet lists, numbered lists, bold, italic, code, line tips,
// display math (\[…\] or $$…$$) and inline math (\(…\) or $…$).
// ─────────────────────────────────────────────────────────────────────────────

// Render a KaTeX string safely; returns an HTML string or null.
function renderKatex(latex, displayMode) {
  try {
    return katex.renderToString(latex.trim(), { displayMode, throwOnError: false, output: 'html' });
  } catch {
    return null;
  }
}

function renderTutorMarkdown(text) {
  if (!text) return null;

  // Render inline tokens: inline math, **bold**, *italic*, `code`
  const renderInline = (str) => {
    if (!str) return null;
    // Split on inline math \(...\) or $...$ (non-greedy, no newlines)
    const parts = str.split(/(\\\\?\([^)]*?\\\\?\)|\\\\?\[[^\]]*?\\\\?\]|\$(?!\$)[^$\n]+?\$|\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/);
    return parts.map((part, i) => {
      // \( ... \)
      if (/^\\\([\s\S]*?\\\)$/.test(part)) {
        const html = renderKatex(part.slice(2, -2), false);
        if (html) return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      }
      // $ ... $ (single dollar, inline)
      if (/^\$(?!\$)[^$\n]+\$$/.test(part)) {
        const html = renderKatex(part.slice(1, -1), false);
        if (html) return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      }
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('`') && part.endsWith('`'))
        return <code key={i} className="tutor-code">{part.slice(1, -1)}</code>;
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
        return <em key={i}>{part.slice(1, -1)}</em>;
      return part || null;
    });
  };

  // ── Pre-pass: replace display math blocks (\[…\] and $…$) with unique tokens
  // so they survive the line-splitting logic as atomic units.
  const mathBlocks = [];

  let textWithTokens = text.replace(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g, (_, a, b) => {
    const latex = (a ?? b).trim();
    const token = `\n__DISPLAYMATH_${mathBlocks.length}__\n`;
    mathBlocks.push(latex);
    return token;
  });

  // ── Secondary pre-pass: catch bare LaTeX macros without delimiters.
  // The AI sometimes writes \frac{...}{...} or \sqrt{...} directly in text.
  // We detect common patterns and wrap them as display math tokens so KaTeX renders them.
  textWithTokens = textWithTokens.replace(
    /(?<![`\w])\\(?:d|t|c)?frac\{(?:[^{}]|\{[^{}]*\})*\}\{(?:[^{}]|\{[^{}]*\})*\}|\\sqrt(?:\[[^\]]*\])?\{(?:[^{}]|\{[^{}]*\})*\}/g,
    (m) => {
      if (m.indexOf('__DISPLAYMATH_') !== -1) return m;
      const token = `\n__DISPLAYMATH_${mathBlocks.length}__\n`;
      mathBlocks.push(m.trim());
      return token;
    }
  );


  // Split the whole text into logical blocks:
  // consecutive list lines stay together; blank lines separate blocks.
  const rawLines = textWithTokens.split('\n');
  const blocks = [];
  let currentBlock = [];

  const flushBlock = () => {
    if (currentBlock.length) { blocks.push([...currentBlock]); currentBlock = []; }
  };

  rawLines.forEach(line => {
    if (line.trim() === '') {
      flushBlock();
    } else {
      currentBlock.push(line);
    }
  });
  flushBlock();

  return blocks.map((lines, bi) => {
    // ── Display math ──
    if (lines.length === 1) {
      const m = lines[0].trim().match(/^__DISPLAYMATH_(\d+)__$/);
      if (m) {
        const latex = mathBlocks[+m[1]];
        const html = renderKatex(latex, true);
        if (html) return <div key={bi} className="tutor-math-display" dangerouslySetInnerHTML={{ __html: html }} />;
        return <pre key={bi} className="tutor-code-block">{latex}</pre>;
      }
    }
    // ── Heading (## or ###) ──
    if (lines.length === 1 && /^#{1,4}\s/.test(lines[0])) {
      const headText = lines[0].replace(/^#{1,4}\s+/, '');
      return <p key={bi} className="tutor-heading">{renderInline(headText)}</p>;
    }

    // ── Bullet list block ──
    const isBulletList = lines.every(l => /^\s*[-•*]\s/.test(l));
    if (isBulletList) {
      return (
        <ul key={bi} className="tutor-list">
          {lines.map((l, li) => (
            <li key={li}>{renderInline(l.replace(/^\s*[-•*]\s+/, ''))}</li>
          ))}
        </ul>
      );
    }

    // ── Numbered list block ──
    const isNumberedList = lines.every(l => /^\s*\d+[.):]\s/.test(l));
    if (isNumberedList) {
      const firstNumMatch = lines[0].match(/^\s*(\d+)/);
      const startNum = firstNumMatch ? parseInt(firstNumMatch[1], 10) : 1;
      return (
        <ol key={bi} className="tutor-list tutor-list-ordered" start={startNum}>
          {lines.map((l, li) => (
            <li key={li}>{renderInline(l.replace(/^\s*\d+[.):]+\s+/, ''))}</li>
          ))}
        </ol>
      );
    }

    // ── Tip line (💡 or 📌 at the start of any line in the block) ──
    const tipCharRegex = /^[\u{1f4a1}\u{1f4cc}\u{26a0}\u{2705}\u{274c}\u{23f3}]/u;
    const allTip = lines.every(l => tipCharRegex.test(l.trim()));
    if (allTip) {
      return (
        <div key={bi} className="tutor-tip">
          {lines.map((l, li) => (
            <p key={li}>{renderInline(l.trim())}</p>
          ))}
        </div>
      );
    }

    // ── Mixed block: some lines are tips, some are regular ──
    // Or regular paragraph — render each line, joined with <br /> within.
    const isEmpty = lines.every(l => !l.trim());
    if (isEmpty) return null;

    return (
      <p key={bi} className="tutor-para">
        {lines.map((line, li) => {
          const trimmed = line.trim();
          const isTipLine = tipCharRegex.test(trimmed);
          return (
            <span key={li} className={isTipLine ? 'tutor-tip-inline' : undefined}>
              {renderInline(line)}
              {li < lines.length - 1 && <br />}
            </span>
          );
        })}
      </p>
    );
  });
}

function GenerateQuiz() {
  const navigate = useNavigate();
  const { user, hasReachedLimit, getRemainingQuota, limits, isFreeUser, refreshUserData } = useAuth();

  // Refresh limits from the server on mount so we always use the live
  // PricingConfig values, not whatever is stale in sessionStorage.
  useEffect(() => {
    refreshUserData().catch(() => {/* non-fatal */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [activeTool, setActiveTool] = useState('quiz'); // 'quiz' or 'summary'
  const [loading, setLoading] = useState(false);
  const [inputMethod, setInputMethod] = useState('file');
  const [formData, setFormData] = useState({
    topic: '',
    numberOfQuestions: 10,
    text: '',
    files: []  // array — supports multi-file for higher tiers
  });
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [progress, setProgress] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [partialQuestions, setPartialQuestions] = useState([]);
  const [summaryResult, setSummaryResult] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(null);

  // ── Course view state (Note Summary result) ──
  const [courseData, setCourseData] = useState(null);       // { title, chapters }
  const [currentChapterIdx, setCurrentChapterIdx] = useState(0);
  const [courseTab, setCourseTab] = useState('lesson');     // 'lesson' | 'notes' | 'podcast'
  const [userNotes, setUserNotes] = useState({});           // { [chapterIdx]: string }
  const [tutorMessages, setTutorMessages] = useState([]);   // [{role, content}]
  const [tutorInput, setTutorInput] = useState('');
  const [tutorLoading, setTutorLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth > 700);
  const [isTutorOpen, setIsTutorOpen] = useState(true);
  const tutorEndRef = useRef(null);
  const tutorInputRef = useRef(null);

  // ── Resizable tutor panel ──
  const [tutorWidth, setTutorWidth] = useState(320);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(320);

  // ── Text-to-Speech ──
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [availableVoices, setAvailableVoices] = useState([]);
  const speechSynthRef = useRef(window.speechSynthesis);

  // ── Highlighting ──
  const [highlights, setHighlights] = useState({});  // { [chapterIdx]: [{id, text, color}] }
  const [selectionPopup, setSelectionPopup] = useState(null); // {x, y, text}
  // Custom colours the user has picked via the colour-wheel button
  const [customHighlightColors, setCustomHighlightColors] = useState([]);

  // ── Chat Threads ──
  const [chatThreads, setChatThreads] = useState([]);       // thread metadata list (no messages)
  const [activeChatThreadId, setActiveChatThreadId] = useState(null);
  const [chatThreadsLoading, setChatThreadsLoading] = useState(false);
  const [showThreadList, setShowThreadList] = useState(false);
  const [renamingThreadId, setRenamingThreadId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  // Keep a ref so handleSendTutor always reads the latest value in its async closure
  const activeChatThreadIdRef = useRef(null);
  useEffect(() => { activeChatThreadIdRef.current = activeChatThreadId; }, [activeChatThreadId]);

  // ── Session persistence ──
  const [sessionId, setSessionId] = useState(null);             // current MongoDB session id
  const [sessionHistory, setSessionHistory] = useState([]);     // list of past sessions
  const [sessionHistoryLoading, setSessionHistoryLoading] = useState(false);
  const [showSessionHistory, setShowSessionHistory] = useState(false);

  // ── Slash commands ──
  const [showSlashPalette, setShowSlashPalette] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');

  // ── Quiz / test from summary ──
  const [quizFromSummaryLoading, setQuizFromSummaryLoading] = useState(false);
  const [quickCheckData, setQuickCheckData] = useState(null);   // { questions: [...] }
  const [quickCheckLoading, setQuickCheckLoading] = useState(false);
  const [quickCheckAnswers, setQuickCheckAnswers] = useState({}); // { [qIdx]: selectedOption }
  const [quickCheckRevealed, setQuickCheckRevealed] = useState(false);

  // ── Dedup modal ──
  const [dedupSession, setDedupSession] = useState(null); // session returned on dedup hit

  // ── Course Outline Detection State ──
  const [outlineDetection, setOutlineDetection] = useState(null);        // parse result from backend
  const [outlineConfirmNeeded, setOutlineConfirmNeeded] = useState(false); // show inline confirmation
  const [outlineCourseNameInput, setOutlineCourseNameInput] = useState('');
  const [outlineDepthAcknowledged, setOutlineDepthAcknowledged] = useState(false);
  const [outlineStreamProgress, setOutlineStreamProgress] = useState([]); // live chapter progress
  const [outlineStreamController, setOutlineStreamController] = useState(null); // AbortController for SSE
  // Cleanup SSE AbortController on unmount
  useEffect(() => {
    return () => { if (outlineStreamController) outlineStreamController.abort(); };
  }, [outlineStreamController]);
  const [outlinePdfExporting, setOutlinePdfExporting] = useState(false);
  const [summaryPdfExporting, setSummaryPdfExporting] = useState(false);
  const [outlineParsing, setOutlineParsing] = useState(false);           // pre-flight loading
  const [activeSubChapterIdx, setActiveSubChapterIdx] = useState(-1);     // -1 = overview, 0+ = sub-chapter index
  const [outlineRetrying, setOutlineRetrying] = useState(false);           // retry-failed loading state
  const lessonContentRef = useRef(null);
  const HIGHLIGHT_COLORS = [
    { name: 'Blue', value: '#93c5fd', defaultLabel: 'Key Terms' },
    { name: 'Yellow', value: '#fde68a', defaultLabel: 'Re-touch' },
    { name: 'Green', value: '#86efac', defaultLabel: 'Got It' },
    { name: 'Pink', value: '#fda4af', defaultLabel: 'Important' },
    { name: 'Purple', value: '#c4b5fd', defaultLabel: 'Review Later' },
  ];
  const [highlightGroupLabels, setHighlightGroupLabels] = useState(
    () => Object.fromEntries(HIGHLIGHT_COLORS.map(c => [c.value, c.defaultLabel]))
  );

  // ── Unified Side Panel ──
  const [activeSidePanel, setActiveSidePanel] = useState(() => window.innerWidth > 700 ? 'tutor' : null); // 'tutor' | 'notes' | 'highlights' | null
  const [isFabMenuOpen, setIsFabMenuOpen] = useState(false);

  // Cache CSRF token to avoid fetching on every request
  const csrfTokenRef = useRef(null);

  // ── Proactive limit check ── computed from user's live quota
  // Returns {blocked: true, reason: string, upgradeRequired: bool} or null
  const limitBlock = (() => {
    if (!user) return null;

    const tokensRemaining = getRemainingQuota('tokens');
    const perRequest = limits?.tokensPerRequest ?? 1000;

    // 1. Monthly token quota exhausted
    if (hasReachedLimit('tokens')) {
      return {
        blocked: true,
        reason: `You've used all your AI tokens for this month.`,
        upgradeRequired: isFreeUser
      };
    }

    // 2. Not enough tokens left to fund even one request
    if (tokensRemaining !== 'unlimited' && tokensRemaining < perRequest) {
      return {
        blocked: true,
        reason: `You only have ${tokensRemaining} tokens left, but this feature needs ${perRequest}. Your quota resets next month.`,
        upgradeRequired: isFreeUser
      };
    }

    // 3. Monthly upload limit reached
    if (hasReachedLimit('uploads')) {
      return {
        blocked: true,
        reason: `You've reached your monthly upload limit.`,
        upgradeRequired: isFreeUser
      };
    }

    return null;
  })();

  // ── Parse JSON summary result into course chapters ──
  useEffect(() => {
    if (!summaryResult?.content) return;
    try {
      const jsonMatch = summaryResult.content.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : summaryResult.content);
      if (parsed?.chapters?.length) {
        setCourseData(parsed);
        setCurrentChapterIdx(0);
        setCourseTab('lesson');
        setTutorMessages([{
          role: 'assistant',
          content: `Hey ${user?.name?.split(' ')[0] || 'there'}, what do you need clarity on?`
        }]);
      }
    } catch {
      // Non-JSON fallback — keep old plain-text display
    }
  }, [summaryResult]);

  // ── Scroll AI tutor to bottom ──
  useEffect(() => {
    tutorEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [tutorMessages]);

  // ── Load available TTS voices ──
  useEffect(() => {
    const synth = speechSynthRef.current;
    if (!synth) return;
    const loadVoices = () => {
      const voices = synth.getVoices().filter(v => v.lang.startsWith('en'));
      setAvailableVoices(voices);
      if (!selectedVoice && voices.length > 0) {
        const preferred = voices.find(v => v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Daniel'));
        setSelectedVoice(preferred || voices[0]);
      }
    };
    loadVoices();
    synth.onvoiceschanged = loadVoices;
    return () => { synth.onvoiceschanged = null; };
  }, []);

  // ── Highlight: detect text selection (document-level so backwards drag works) ──
  useEffect(() => {
    const handleMouseUp = () => {
      const sel = window.getSelection();
      const text = sel?.toString()?.trim();
      if (!text || text.length < 2) {
        setSelectionPopup(null);
        return;
      }
      // Only trigger if the selection is inside the lesson content area
      let range;
      try { range = sel.getRangeAt(0); } catch { setSelectionPopup(null); return; }
      const container = lessonContentRef.current;
      if (!container || !container.contains(range.commonAncestorContainer)) return;

      // getBoundingClientRect on backwards selections can return zero in some browsers;
      // fall back to the first client rect of the range.
      let rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) {
        const rects = range.getClientRects();
        if (rects.length) rect = rects[rects.length - 1];
      }

      // Compute which occurrence of this text was selected (0-indexed).
      // We walk ONLY text nodes that are inside elements processed by
      // renderInlineMarkdown — excluding headings (h2/h3/h4), code block
      // chrome (.lce-block, .lce-panel-label), nav/tab/audio UI — so that
      // the count matches what the renderer sees.
      let occurrenceIndex = 0;
      try {
        const EXCLUDED_TAGS = new Set(['H2', 'H3', 'H4', 'BUTTON', 'SELECT', 'OPTION', 'IFRAME']);
        const EXCLUDED_CLASSES = [
          'lce-block', 'lce-panel-label', 'lce-lang-badge', 'lce-live-badge',
          'course-chapter-nav', 'course-tabs', 'course-audio-controls',
          'course-section-title', 'course-lesson-heading', 'course-teaching-subtitle',
          'course-hook-title', 'subchapter-item-text', 'chapter-item-text',
        ];
        const isExcluded = (node) => {
          let el = node.nodeType === 1 ? node : node.parentElement;
          while (el && el !== container) {
            if (EXCLUDED_TAGS.has(el.tagName)) return true;
            for (const cls of EXCLUDED_CLASSES) {
              if (el.classList?.contains(cls)) return true;
            }
            el = el.parentElement;
          }
          return false;
        };

        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => isExcluded(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
        });

        const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped, 'gi');
        let filteredBefore = '';
        let node;
        while ((node = walker.nextNode())) {
          if (node === range.startContainer) {
            filteredBefore += node.textContent.slice(0, range.startOffset);
            break;
          }
          filteredBefore += node.textContent;
        }
        occurrenceIndex = (filteredBefore.match(re) || []).length;
      } catch { /* fall back to 0 */ }

      setSelectionPopup({
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
        text,
        occurrenceIndex
      });
    };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const addHighlight = useCallback((color) => {
    if (!selectionPopup?.text) return;
    const id = Date.now();
    setHighlights(prev => ({
      ...prev,
      [currentChapterIdx]: [
        ...(prev[currentChapterIdx] || []),
        { id, text: selectionPopup.text, color, occurrenceIndex: selectionPopup.occurrenceIndex ?? 0 }
      ]
    }));
    window.getSelection()?.removeAllRanges();
    setSelectionPopup(null);
  }, [selectionPopup, currentChapterIdx]);

  const addSelectionToNotes = useCallback(() => {
    if (!selectionPopup?.text) return;
    setUserNotes(prev => ({
      ...prev,
      [currentChapterIdx]: (prev[currentChapterIdx] || '') + (prev[currentChapterIdx] ? '\n' : '') + '• ' + selectionPopup.text
    }));
    setActiveSidePanel('notes');
    window.getSelection()?.removeAllRanges();
    setSelectionPopup(null);
    showToast.success('Added to notes');
  }, [selectionPopup, currentChapterIdx]);

  // Compute all highlights grouped by color across all chapters
  const allHighlightsGrouped = useCallback(() => {
    const groups = {};
    HIGHLIGHT_COLORS.forEach(c => { groups[c.value] = []; });
    Object.entries(highlights).forEach(([chIdx, items]) => {
      items.forEach(h => {
        if (!groups[h.color]) groups[h.color] = [];
        groups[h.color].push({ ...h, chapterIdx: Number(chIdx) });
      });
    });
    return groups;
  }, [highlights]);

  const removeHighlight = useCallback((highlightId) => {
    setHighlights(prev => ({
      ...prev,
      [currentChapterIdx]: (prev[currentChapterIdx] || []).filter(h => h.id !== highlightId)
    }));
  }, [currentChapterIdx]);

  // Close selection popup on click outside
  useEffect(() => {
    const handler = (e) => {
      if (!e.target.closest('.highlight-popup')) {
        // Small delay so click on popup buttons works
        setTimeout(() => {
          const sel = window.getSelection();
          if (!sel?.toString()?.trim()) setSelectionPopup(null);
        }, 150);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ══════════════════════════════════════════════════════
  // SESSION PERSISTENCE — load history, auto-save chat & position
  // ══════════════════════════════════════════════════════

  // Load session history when summary tool is selected
  // Guard: wait for user to be authenticated before making the request to
  // avoid a race where the effect fires before initializeAuth() has stored
  // a valid access token, which would cause a spurious 401.
  useEffect(() => {
    if (activeTool !== 'summary') return;
    if (!user) return; // not authenticated yet
    let cancelled = false;
    const load = async () => {
      setSessionHistoryLoading(true);
      try {
        const res = await getSummarySessions();
        if (!cancelled && res?.sessions) setSessionHistory(res.sessions);
      } catch { /* non-fatal */ }
      if (!cancelled) setSessionHistoryLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [activeTool, user]);

  // Auto-save position on chapter / tab / sub-chapter change
  useEffect(() => {
    if (!sessionId) return;
    const timer = setTimeout(() => {
      saveSummaryPosition(sessionId, {
        lastChapterIdx: currentChapterIdx,
        lastTab: courseTab,
        lastSubChapterNum: activeSubChapterIdx
      }).catch(() => { });
    }, 500); // debounce 500ms
    return () => clearTimeout(timer);
  }, [sessionId, currentChapterIdx, courseTab, activeSubChapterIdx]);

  // ── Slash command definitions ──
  const SLASH_COMMANDS = [
    { cmd: '/quiz', args: '[count]', desc: 'Generate a full quiz from the source file', icon: <FaQuestionCircle size={13} /> },
    { cmd: '/test', args: '', desc: 'Quick 5-question comprehension check', icon: <FaBolt size={13} /> },
    { cmd: '/recap', args: '', desc: 'Recap the current chapter', icon: <FaRedoAlt size={13} /> },
    { cmd: '/explain', args: '<term>', desc: 'Deep-dive explanation of a concept', icon: <FaBookOpen size={13} /> },
    { cmd: '/flashcards', args: '[count]', desc: 'Generate flashcard-style Q&A pairs', icon: <FaList size={13} /> },
  ];

  // ── Resume a previous session ──
  const handleResumeSession = useCallback(async (sess) => {
    try {
      setSummaryLoading(true);
      const res = await getSummarySession(sess._id);
      if (!res?.session) throw new Error('Session not found');
      const s = res.session;
      setSessionId(s._id);
      setCourseData({
        title: s.title || s.sourceFileName || 'Untitled Session',
        chapters: s.chapters || [],
        isStreaming: s.status === 'streaming',
        sessionType: s.sessionType || 'file_summary'
      });
      setCurrentChapterIdx(s.lastChapterIdx || 0);
      setCourseTab(s.lastTab || 'lesson');
      setActiveSubChapterIdx(s.lastSubChapterNum != null ? s.lastSubChapterNum : -1);
      setHighlights(s.highlights && typeof s.highlights === 'object' ? s.highlights : {});
      setUserNotes(s.userNotes && typeof s.userNotes === 'object' ? s.userNotes : {});

      // ── Load chat threads ──
      setChatThreads([]);
      setActiveChatThreadId(null);
      try {
        const threadsRes = await getChatThreads(s._id);
        if (threadsRes?.success && threadsRes.threads?.length) {
          setChatThreads(threadsRes.threads);
          // Try to restore the active thread
          const targetId = threadsRes.activeChatThreadId || threadsRes.threads[0]?._id;
          if (targetId) {
            const tRes = await getChatThread(s._id, targetId);
            if (tRes?.thread) {
              setActiveChatThreadId(targetId);
              setTutorMessages(tRes.thread.messages?.length ? tRes.thread.messages : [{
                role: 'assistant',
                content: `Welcome back${user?.name ? ', ' + user.name.split(' ')[0] : ''}! Where did we leave off?`
              }]);
            }
          }
        } else {
          // No threads yet — fallback to legacy chatHistory on the session
          setTutorMessages(s.chatHistory?.length ? s.chatHistory : [{
            role: 'assistant',
            content: `Welcome back${user?.name ? ', ' + user.name.split(' ')[0] : ''}! Where did we leave off?`
          }]);
        }
      } catch {
        setTutorMessages([{ role: 'assistant', content: `Welcome back! Where did we leave off?` }]);
      }

      setShowSessionHistory(false);
      showToast.success('Session resumed');
    } catch (err) {
      showToast.error('Failed to load session');
    } finally {
      setSummaryLoading(false);
    }
  }, [user]);

  // ── Delete a session from history ──
  const handleDeleteSession = useCallback(async (sessId, e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!confirm('Delete this session permanently?')) return;
    try {
      await deleteSummarySession(sessId);
      // Use string coercion to handle both ObjectId objects and string IDs
      setSessionHistory(prev => prev.filter(s => String(s._id) !== String(sessId)));
      showToast.success('Session deleted');
    } catch (err) {
      console.error('Delete session error:', err?.response?.data || err?.message);
      const msg = err?.response?.data?.error?.message || 'Failed to delete session';
      showToast.error(msg);
    }
  }, []);

  // ── Auto-save chat helper (called after each tutor exchange) ──
  const autoSaveChat = useCallback(async (msgs, threadId) => {
    if (!sessionId || !msgs.length) return;
    try {
      const toSave = msgs.slice(-2);
      if (threadId) {
        // Thread-based save — also updates title when it changes
        const res = await saveChatThreadMessages(sessionId, threadId, toSave);
        if (res?.title) {
          setChatThreads(prev => prev.map(t => t._id === threadId ? { ...t, title: res.title } : t));
        }
      } else {
        // Legacy fallback (session-level) — only reached if thread creation failed
        await saveSummaryChat(sessionId, toSave);
      }
    } catch { /* non-fatal */ }
  }, [sessionId]);

  // ── Chat thread helpers ──

  /** Switch to an existing thread and load its messages */
  const switchToThread = useCallback(async (thread) => {
    if (!sessionId) return;
    try {
      const res = await getChatThread(sessionId, thread._id);
      if (res?.thread) {
        setActiveChatThreadId(res.thread._id);
        setTutorMessages(res.thread.messages?.length ? res.thread.messages : [{
          role: 'assistant', content: 'New chat — what would you like to explore?'
        }]);
        setShowThreadList(false);
        setActiveThread(sessionId, res.thread._id).catch(() => { });
        setChatThreads(prev => prev.map(t => t._id === res.thread._id ? { ...t, title: res.thread.title } : t));
      }
    } catch { showToast.error('Failed to load chat'); }
  }, [sessionId]);

  /** Create a brand-new thread and switch to it */
  const handleNewThread = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await createChatThread(sessionId);
      if (res?.thread) {
        setChatThreads(prev => [res.thread, ...prev]);
        setActiveChatThreadId(res.thread._id);
        setTutorMessages([{ role: 'assistant', content: `New chat — what's on your mind?` }]);
        setShowThreadList(false);
        showToast.success('New chat created');
      }
    } catch (err) {
      showToast.error(err?.response?.data?.error?.message || 'Failed to create chat');
    }
  }, [sessionId]);

  /** Delete a thread; if it was active, switch to next available */
  const handleDeleteThread = useCallback(async (threadId, e) => {
    e.stopPropagation();
    if (!confirm('Delete this chat?')) return;
    try {
      await deleteChatThread(sessionId, threadId);
      const remaining = chatThreads.filter(t => t._id !== threadId);
      setChatThreads(remaining);
      if (activeChatThreadId === threadId) {
        if (remaining.length > 0) {
          switchToThread(remaining[0]);
        } else {
          setActiveChatThreadId(null);
          setTutorMessages([{ role: 'assistant', content: `Hey ${user?.name?.split(' ')[0] || 'there'}, what do you need clarity on?` }]);
        }
      }
      showToast.success('Chat deleted');
    } catch { showToast.error('Failed to delete chat'); }
  }, [sessionId, chatThreads, activeChatThreadId, switchToThread, user]);

  /** Commit an inline rename */
  const commitRename = useCallback(async (threadId) => {
    const title = renameValue.trim();
    if (!title) { setRenamingThreadId(null); setRenameValue(''); return; }
    try {
      await renameChatThread(sessionId, threadId, title);
      setChatThreads(prev => prev.map(t => t._id === threadId ? { ...t, title } : t));
    } catch { showToast.error('Failed to rename'); }
    setRenamingThreadId(null);
    setRenameValue('');
  }, [sessionId, renameValue]);

  // ── Auto-save annotations (highlights + notes) with 1s debounce ──
  const autoSaveAnnotations = useCallback(async (hl, notes) => {
    if (!sessionId) return;
    try {
      await saveAnnotations(sessionId, { highlights: hl, userNotes: notes });
    } catch { /* non-fatal */ }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const timer = setTimeout(() => {
      autoSaveAnnotations(highlights, userNotes);
    }, 1000);
    return () => clearTimeout(timer);
  }, [sessionId, highlights, userNotes, autoSaveAnnotations]);

  // ── Handle slash commands ──
  // Alias map — lets users type common variants without getting "Unknown command"
  const SLASH_ALIASES = {
    '/flashcard': '/flashcards',
    '/flash': '/flashcards',
    '/fc': '/flashcards',
    '/q': '/quiz',
    '/t': '/test',
    '/r': '/recap',
    '/e': '/explain',
    '/ex': '/explain',
  };

  const handleSlashCommand = useCallback(async (text) => {
    const parts = text.trim().split(/\s+/);
    let cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ').trim();

    // Resolve aliases
    if (SLASH_ALIASES[cmd]) cmd = SLASH_ALIASES[cmd];

    if (cmd === '/quiz') {
      if (!sessionId) {
        setTutorMessages(prev => [...prev, { role: 'assistant', content: 'No active session — please generate a summary first.' }]);
        return true;
      }
      const count = parseInt(arg) || 15;
      setTutorMessages(prev => [...prev, { role: 'assistant', content: `⏳ Generating ${count}-question quiz from your source file…` }]);
      setTutorLoading(true);
      try {
        const res = await generateQuizFromSummary(sessionId, { count });
        const qCount = res?.questions?.length || count;
        const splitInfo = res?.split ? ` (${res.split.mcq} MCQ, ${res.split.fillInGap} Fill-in-Gap, ${res.split.theory} Theory)` : '';
        setTutorMessages(prev => [...prev, { role: 'assistant', content: `✅ Quiz generated! **${qCount} questions**${splitInfo} added to your dashboard. Go to Dashboard → take the quiz!` }]);
      } catch (err) {
        setTutorMessages(prev => [...prev, { role: 'assistant', content: '❌ Failed to generate quiz. Please try again.' }]);
      } finally {
        setTutorLoading(false);
      }
      return true;
    }

    if (cmd === '/test') {
      if (!sessionId) {
        setTutorMessages(prev => [...prev, { role: 'assistant', content: 'No active session — please generate a summary first.' }]);
        return true;
      }
      setTutorMessages(prev => [...prev, { role: 'assistant', content: '⏳ Preparing quick comprehension check…' }]);
      setTutorLoading(true);
      try {
        const res = await quickCheck(sessionId, { chapterIdx: currentChapterIdx });
        if (res?.questions?.length) {
          setQuickCheckData(res);
          setQuickCheckAnswers({});
          setQuickCheckRevealed(false);
          setTutorMessages(prev => [...prev, { role: 'assistant', content: `✅ **Quick Check** ready! ${res.questions.length} questions — scroll down in the lesson area to test yourself.` }]);
        }
      } catch {
        setTutorMessages(prev => [...prev, { role: 'assistant', content: '❌ Failed to generate quick check. Try again.' }]);
      } finally {
        setTutorLoading(false);
      }
      return true;
    }

    if (cmd === '/recap') {
      // Inject a recap request into the normal tutor flow
      const chapter = courseData?.chapters?.[currentChapterIdx];
      const recapPrompt = chapter
        ? `Give me a concise recap of Chapter ${currentChapterIdx + 1}: "${chapter.title}". Summarize the main points in 5 bullet points.`
        : 'Give me a recap of what we have covered so far.';
      // Replace the slash command with the natural prompt — will be processed by normal handleSendTutor
      return recapPrompt; // signal: re-send with this text
    }

    if (cmd === '/explain') {
      if (!arg) {
        setTutorMessages(prev => [...prev, { role: 'assistant', content: 'Usage: `/explain <term>` — e.g. `/explain photosynthesis`' }]);
        return true;
      }
      return `Explain "${arg}" in detail. Use examples from the document if available, and supplement with broader knowledge.`;
    }

    if (cmd === '/flashcards') {
      const n = parseInt(arg) || 5;
      return `Generate ${n} flashcard-style Q&A pairs from the current chapter. Format each as:\n**Q:** [question]\n**A:** [answer]`;
    }

    // Unknown slash command
    setTutorMessages(prev => [...prev, {
      role: 'assistant',
      content: `Unknown command \`${cmd}\`. Available commands:\n${SLASH_COMMANDS.map(c => `• \`${c.cmd} ${c.args}\` — ${c.desc}`).join('\n')}`
    }]);
    return true;
  }, [sessionId, currentChapterIdx, courseData]);

  // ── Resize drag handlers ──
  const handleResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = tutorWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev) => {
      if (!isResizing.current) return;
      const delta = startX.current - ev.clientX; // dragging left = wider
      const newWidth = Math.min(600, Math.max(220, startWidth.current + delta));
      setTutorWidth(newWidth);
    };
    const onMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [tutorWidth]);

  // ── TTS: build chapter text ──
  const getChapterText = useCallback((ch) => {
    if (!ch) return '';
    const parts = [];
    parts.push(ch.title);
    if (ch.hook) parts.push(ch.hook);
    if (ch.coreTeaching) {
      ch.coreTeaching.forEach(s => {
        parts.push(s.sectionTitle);
        // Strip bold markdown for speech
        parts.push((s.content || '').replace(/\*\*/g, ''));
      });
    }
    if (ch.keyTakeaways?.length) {
      parts.push('Key Takeaways');
      ch.keyTakeaways.forEach(t => parts.push(t.replace(/\*\*/g, '')));
    }
    if (ch.notes) parts.push('Study Notes. ' + ch.notes.replace(/\*\*/g, ''));
    return parts.join('. ');
  }, []);

  const handleTTSPlay = useCallback(() => {
    const synth = speechSynthRef.current;
    if (!synth) return;

    if (isPaused && synth.paused) {
      synth.resume();
      setIsPaused(false);
      setIsSpeaking(true);
      return;
    }

    // Cancel any existing speech
    synth.cancel();

    const chapter = courseData?.chapters?.[currentChapterIdx];
    const text = getChapterText(chapter);
    if (!text) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.lang = 'en-US';

    // Use selected voice
    if (selectedVoice) utterance.voice = selectedVoice;

    utterance.onstart = () => { setIsSpeaking(true); setIsPaused(false); };
    utterance.onend = () => { setIsSpeaking(false); setIsPaused(false); };
    utterance.onerror = () => { setIsSpeaking(false); setIsPaused(false); };

    synth.speak(utterance);
  }, [courseData, currentChapterIdx, isPaused, getChapterText]);

  const handleTTSPause = useCallback(() => {
    const synth = speechSynthRef.current;
    if (synth?.speaking && !synth.paused) {
      synth.pause();
      setIsPaused(true);
      setIsSpeaking(false);
    }
  }, []);

  const handleTTSStop = useCallback(() => {
    const synth = speechSynthRef.current;
    synth?.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  // Stop TTS when chapter changes
  useEffect(() => {
    handleTTSStop();
  }, [currentChapterIdx, handleTTSStop]);

  // ── AI Tutor send message (with slash command interception + auto-save) ──
  const handleSendTutor = useCallback(async (overrideText) => {
    let text = (overrideText || tutorInput).trim();
    if (!text || tutorLoading) return;

    // Track whether the user message was already added to the chat
    let messageAlreadyAdded = false;

    // ── Slash command interception ──
    if (text.startsWith('/')) {
      setShowSlashPalette(false);
      const newUserMsg = { role: 'user', content: text };
      setTutorMessages(prev => [...prev, newUserMsg]);
      setTutorInput('');
      messageAlreadyAdded = true;
      const result = await handleSlashCommand(text);
      if (result === true) {
        // Command handled entirely (e.g. /quiz, /test)
        return;
      }
      if (typeof result === 'string') {
        // Command returned a rewritten prompt — use it as the actual question
        text = result;
        // Update the displayed user message to show what's actually being asked
        setTutorMessages(prev => {
          const msgs = [...prev];
          msgs[msgs.length - 1] = { role: 'user', content: text };
          return msgs;
        });
      }
    }

    // ── Build full document context from every chapter ──
    const allChapters = courseData?.chapters || [];
    const fullDocContext = allChapters.map((ch, i) => {
      const sections = ch.coreTeaching?.map(s => `  [${s.sectionTitle}]\n  ${s.content}`).join('\n') || '';
      const takeaways = ch.keyTakeaways?.length ? `  Key Takeaways: ${ch.keyTakeaways.join(' | ')}` : '';
      const notes = ch.notes ? `  Notes: ${ch.notes}` : '';
      return `=== Chapter ${i + 1}: ${ch.title} ===\n${sections}\n${takeaways}\n${notes}`;
    }).join('\n\n');

    const activeChapter = allChapters[currentChapterIdx];
    const activeChapterLabel = activeChapter ? ` The student is currently on Chapter ${currentChapterIdx + 1}: "${activeChapter.title}".` : '';

    const systemCtx = [
      `You are APOLLO, Vayrex's built-in study assistant, helping a student study "${courseData?.title || 'this document'}". This is your only identity. IDENTITY RULES (non-negotiable): If asked who you are, what model you are, what technology powers you, how you work, or who made you — answer ONLY: "I'm Apollo, Vayrex's study assistant. How can I help you learn?" Do NOT say you are ChatGPT, GPT, GPT-4, GPT-5, OpenAI, a language model, a large language model, an AI model, or describe yourself using terms like "language processing", "natural language processing", "neural network", "transformer", "trained on data", or any phrase like "I'm not a specific model" or "I use advanced AI". You are simply Apollo — an enthusiastic, expert tutor whose only purpose is helping students learn.`,
      ``,
      `════ FILE-FIRST HIERARCHY (strict 4-tier decision tree) ════`,
      `For every question, work through these tiers IN ORDER:`,
      ``,
      `TIER 1 — ANSWER FROM THE FILE: If the document below contains relevant information (any chapter, any section), answer DIRECTLY from it. Quote specific facts, names, dates, formulas. This is your PRIMARY source.`,
      `TIER 2 — SUPPLEMENT: If the document mentions the topic but lacks depth, give the document's answer first, then enrich with your own deep knowledge. Start the enrichment with "Going deeper…" or "To expand on this…".`,
      `TIER 3 — CORRECT: If the document contains a factual error, provide the correct answer. Flag the correction ONCE with "⚠️ Note: the document states X, but the accurate answer is Y because…" — then move on.`,
      `TIER 4 — GENERAL KNOWLEDGE: Only if the concept is NOT mentioned in the document at all, draw on your own expertise. Do NOT apologise for the document not covering it — just answer confidently.`,
      ``,
      `════ RESPONSE FORMAT ════`,
      `• 150–350 words for most questions; go longer only for complex multi-part questions.`,
      `• Use plain numbered lists or short paragraphs — NO walls of text.`,
      `• **Bold** key terms on first use.`,
      `• NEVER say "the material notes", "the document says", "according to the notes" — just state the facts directly as a knowledgeable tutor.`,
      `• End every answer with one short "💡 Quick Tip:" or "📌 Remember:" line that helps retention.`,
      activeChapterLabel,
      ``,
      `════ STUDENT'S FULL DOCUMENT ════`,
      fullDocContext || '(document content is still generating — use your general knowledge for now and note that you will reference the document once available)'
    ].join('\n');

    // Only add user message if not already added by slash command flow
    if (!messageAlreadyAdded) {
      const newUserMsg = { role: 'user', content: text };
      setTutorMessages(prev => [...prev, newUserMsg]);
      setTutorInput('');
    }
    setTutorLoading(true);
    setShowSlashPalette(false);

    try {
      const latestMessages = [...tutorMessages.slice(-8), { role: 'user', content: text }];
      const res = await aiChat(
        [
          { role: 'system', content: systemCtx },
          ...latestMessages.filter(m => m.role !== 'system')
        ],
        'academic',
        'gpt-5-nano'
      );
      // res is already the response data (aiChat returns res.data from axios)
      const assistantContent = (typeof res?.content === 'string' && res.content.length > 0)
        ? res.content
        : (res?.data?.content || 'I could not generate a response. Please try again.');
      setTutorMessages(prev => {
        const updated = [...prev, { role: 'assistant', content: assistantContent }];
        // Auto-save chat (fire & forget)
        // ── Lazy thread creation: ensure we have a thread before saving ──
        const currentThreadId = activeChatThreadIdRef.current;
        if (sessionId && !currentThreadId) {
          createChatThread(sessionId)
            .then(res => {
              if (res?.thread) {
                const tid = res.thread._id;
                setActiveChatThreadId(tid);
                setChatThreads(prev2 => [res.thread, ...prev2]);
                autoSaveChat(updated, tid);
              }
            })
            .catch(() => autoSaveChat(updated, null));
        } else {
          autoSaveChat(updated, currentThreadId);
        }
        return updated;
      });
    } catch {
      setTutorMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I had trouble connecting. Please try again.' }]);
    } finally {
      setTutorLoading(false);
    }
  }, [tutorInput, tutorLoading, tutorMessages, courseData, currentChapterIdx, handleSlashCommand, autoSaveChat]);

  const handleToolChange = (tool) => {
    setActiveTool(tool);
    setError(null);
    setSuccess(null);
    setSummaryError(null);
    setSummaryResult(null);
    setCourseData(null);
    setTutorMessages([]);
    setPartialQuestions([]);
    setProgress('');
    setSessionId(null);
    setQuickCheckData(null);
    setDedupSession(null);
    setShowSlashPalette(false);
    setHighlights({});
    setUserNotes({});
    setChatThreads([]);
    setActiveChatThreadId(null);
    setShowThreadList(false);
    setOutlineDetection(null);
    setOutlineConfirmNeeded(false);
    setOutlineCourseNameInput('');
    setOutlineDepthAcknowledged(false);
    setOutlineStreamProgress([]);
    setOutlineParsing(false);
    setActiveSubChapterIdx(-1);
    if (outlineStreamController) { outlineStreamController.abort(); setOutlineStreamController(null); }
  };

  const handleFileChange = (e) => {
    const maxFiles = limits?.filesPerUpload ?? 1;
    const selected = Array.from(e.target.files);

    // Enforce tier limit client-side
    if (selected.length > maxFiles) {
      const msg = `Your plan allows ${maxFiles} file${maxFiles > 1 ? 's' : ''} per upload. Please select up to ${maxFiles}.`;
      setError(msg);
      showToast.error(msg);
      e.target.value = '';
      return;
    }

    const maxSizeMB = limits?.maxFileSizeMB ?? 50;
    const oversized = selected.find(f => f.size > maxSizeMB * 1024 * 1024);
    if (oversized) {
      const msg = `"${oversized.name}" exceeds the ${maxSizeMB}MB limit for your plan.`;
      setError(msg);
      showToast.error(msg);
      e.target.value = '';
      return;
    }

    setFormData(prev => ({ ...prev, files: selected }));
    setError(null);
    setSummaryError(null);

    // Preview for single image selection
    if (selected.length === 1 && selected[0].type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => setPreview(reader.result);
      reader.readAsDataURL(selected[0]);
    } else {
      setPreview(null);
    }
  };

  const handleSummarize = async (e) => {
    e.preventDefault();
    setSummaryError(null);
    setSummaryResult(null);
    setCourseData(null);
    setTutorMessages([]);
    setSessionId(null);
    setQuickCheckData(null);
    setSummaryLoading(true);
    setHighlights({});
    setUserNotes({});
    setChatThreads([]);
    setActiveChatThreadId(null);
    setShowThreadList(false);
    setOutlineDetection(null);
    setOutlineConfirmNeeded(false);
    setOutlineDepthAcknowledged(false);
    setOutlineStreamProgress([]);

    try {
      // ── validate input ──
      if (inputMethod === 'file') {
        if (!formData.files || formData.files.length === 0) {
          const msg = 'Please select a file to summarize.';
          setSummaryError(msg); showToast.error(msg); setSummaryLoading(false); return;
        }
      } else {
        if (!formData.text || formData.text.trim().length < 50) {
          const msg = 'Please provide at least 50 characters of text.';
          setSummaryError(msg); showToast.error(msg); setSummaryLoading(false); return;
        }
      }

      // ── Step 1: Run pre-flight detection (course outline or regular doc?) ──
      // Send ALL files for outline detection — the backend combines text and uses
      // the first filename for filename-aware detection scoring.
      const allFiles = inputMethod === 'file' ? formData.files : null;
      const parsePayload = inputMethod === 'file'
        ? (allFiles.length > 1 ? [...allFiles] : allFiles[0])
        : formData.text.trim();
      const summaryPayload = inputMethod === 'file'
        ? (formData.files.length > 1 ? formData.files : formData.files[0])
        : formData.text.trim();
      setOutlineParsing(true);

      let parseResult;
      try {
        parseResult = await parseCourseOutline(parsePayload);
        setOutlineParsing(false);
      } catch (parseErr) {
        // If parse fails (e.g. unsupported file for outline detection), fall through to regular summary
        setOutlineParsing(false);
        await handleRegularSummary(summaryPayload);
        return;
      }

      // ── Handle dedup for course outline ──
      if (parseResult.deduplicated && parseResult.existingSessionId) {
        setSummaryLoading(false);
        setDedupSession({ sessionId: parseResult.existingSessionId, deduplicated: true });
        return;
      }

      // ── Step 2: Route based on detection ──
      if (parseResult.isOutline && parseResult.chapters?.length >= 2) {
        // High confidence → auto-route to course outline generation
        setOutlineDetection(parseResult);
        setOutlineCourseNameInput(parseResult.autoCourseName || parseResult.courseName || '');
        // Show depth tier confirmation before generating
        setSummaryLoading(false);
        return; // UI now shows the outline confirmation panel
      }

      if (parseResult.confirmationNeeded && parseResult.chapters?.length >= 2) {
        // Ambiguous → ask user to confirm
        setOutlineDetection(parseResult);
        setOutlineCourseNameInput(parseResult.autoCourseName || parseResult.courseName || '');
        setOutlineConfirmNeeded(true);
        setSummaryLoading(false);
        return; // UI now shows the inline question
      }

      // ── Not a course outline → regular file summary flow ──
      await handleRegularSummary(summaryPayload);

    } catch (err) {
      setSummaryLoading(false);
      setOutlineParsing(false);
      const errorMessage = handleApiError(err) || 'Failed to summarize notes.';
      setSummaryError(errorMessage);
      showToast.error(errorMessage);
      setCourseData(null);
    }
  };

  /** Handle the regular file summary flow (original logic, extracted) */
  const handleRegularSummary = async (payload) => {
    try {
      const startRes = await aiSummarizeStart(payload);

      // Handle dedup
      if (startRes.deduplicated && startRes.sessionId) {
        setSummaryLoading(false);
        setDedupSession(startRes);
        return;
      }

      const { jobId, sessionId: newSessionId } = startRes;
      if (newSessionId) setSessionId(newSessionId);

      setCourseData({ title: 'Generating your course…', chapters: [], isStreaming: true });
      setCurrentChapterIdx(0);
      setCourseTab('lesson');
      setTutorMessages([{
        role: 'assistant',
        content: `Hey ${user?.name?.split(' ')[0] || 'there'}, what do you need clarity on? Type \`/\` to see available commands.`
      }]);

      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:5002/api';
      const token = sessionStorage.getItem('authToken');
      const streamResp = await fetch(
        `${apiBase}/ai/summarize-stream/${encodeURIComponent(jobId)}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'ngrok-skip-browser-warning': 'true',
            'Bypass-Tunnel-Reminder': 'true'
          },
          credentials: 'include'
        }
      );

      if (!streamResp.ok || !streamResp.body) {
        throw new Error(`Stream connection failed (${streamResp.status})`);
      }

      const reader = streamResp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed);
            if (event.type === 'title') {
              setCourseData(prev => prev ? { ...prev, title: event.title } : prev);
            } else if (event.type === 'chapter') {
              setCourseData(prev => {
                if (!prev) return prev;
                const next = [...prev.chapters, event.chapter]
                  .sort((a, b) => (a.id || 0) - (b.id || 0));
                return { ...prev, chapters: next };
              });
            } else if (event.type === 'complete') {
              setCourseData(prev => prev ? { ...prev, isStreaming: false } : prev);
              setSummaryLoading(false);
            } else if (event.type === 'error') {
              const msg = event.message || 'Summary generation failed.';
              setSummaryError(msg);
              showToast.error(msg);
              setCourseData(null);
              setSummaryLoading(false);
            }
          } catch { /* ignore malformed ndjson lines */ }
        }
      }

      setCourseData(prev => prev ? { ...prev, isStreaming: false } : prev);
      setSummaryLoading(false);

    } catch (err) {
      setSummaryLoading(false);
      const errorMessage = handleApiError(err) || 'Failed to summarize notes.';
      setSummaryError(errorMessage);
      showToast.error(errorMessage);
      setCourseData(null);
    }
  };

  /** Start course outline generation after user confirms */
  const handleOutlineGenerate = async () => {
    if (!outlineDetection) return;
    setSummaryLoading(true);
    setSummaryError(null);

    try {
      const courseName = outlineCourseNameInput.trim() || outlineDetection.courseName || 'Course Notes';
      const genRes = await generateCourseOutlineNotes({
        chapters: outlineDetection.chapters,
        courseName,
        depthTier: outlineDetection.depthTier,
        contentHash: outlineDetection.contentHash,
        sourceFileSize: outlineDetection.sourceFileSize || 0
      });

      // Handle dedup from generate endpoint
      if (genRes.deduplicated && genRes.sessionId) {
        setSummaryLoading(false);
        setOutlineDetection(null);
        await handleResumeSession({ _id: genRes.sessionId });
        return;
      }

      const { jobId, sessionId: newSessionId } = genRes;
      if (newSessionId) setSessionId(newSessionId);

      // Set course data skeleton with chapter titles
      const skeletonChapters = outlineDetection.chapters.map((ch, i) => ({
        id: ch.weekNumber || (i + 1),
        title: ch.chapterTitle || ch.title || `Chapter ${ch.weekNumber || (i + 1)}`,
        overview: '',
        subChapters: (ch.subTopics || []).map((st, si) => ({
          number: `${ch.weekNumber || (i + 1)}.${si + 1}`,
          title: st,
          content: '',
          status: 'generating'
        })),
        coreTeaching: [],
        keyTakeaways: [],
        hook: '',
        notes: ''
      }));

      setCourseData({
        title: courseName,
        chapters: skeletonChapters,
        isStreaming: true,
        sessionType: 'course_outline'
      });
      setCurrentChapterIdx(0);
      setCourseTab('lesson');
      setOutlineDetection(null);
      setOutlineDepthAcknowledged(false);
      setTutorMessages([{
        role: 'assistant',
        content: `Hey ${user?.name?.split(' ')[0] || 'there'}, your notes for "${courseName}" are being generated. Ask me anything while you wait!`
      }]);

      // Subscribe to stream
      const controller = subscribeToCourseOutlineStream(jobId, {
        onTitle: (title) => {
          setCourseData(prev => prev ? { ...prev, title } : prev);
        },
        onChapterOverview: (event) => {
          setCourseData(prev => {
            if (!prev) return prev;
            const chapters = prev.chapters.map(ch =>
              ch.id === event.chapterNumber ? { ...ch, overview: event.overview } : ch
            );
            return { ...prev, chapters };
          });
        },
        onSubChapter: (event) => {
          setCourseData(prev => {
            if (!prev) return prev;
            const chapters = prev.chapters.map(ch => {
              if (ch.id !== event.chapterNumber) return ch;
              const subChapters = ch.subChapters.map(sc =>
                sc.number === `${event.chapterNumber}.${event.subChapterNumber}`
                  ? { ...sc, status: event.success ? 'complete' : 'failed' }
                  : sc
              );
              return { ...ch, subChapters };
            });
            return { ...prev, chapters };
          });
          setOutlineStreamProgress(prev => [...prev, {
            chapterNumber: event.chapterNumber,
            subChapterNumber: event.subChapterNumber,
            success: event.success
          }]);
        },
        onChapter: (chapter) => {
          // Full chapter data from DB — replace skeleton
          setCourseData(prev => {
            if (!prev) return prev;
            const chapters = prev.chapters.map(ch =>
              ch.id === chapter.id ? { ...ch, ...chapter } : ch
            );
            return { ...prev, chapters };
          });
        },
        onComplete: () => {
          setCourseData(prev => prev ? { ...prev, isStreaming: false } : prev);
          setSummaryLoading(false);
          showToast.success('Course notes generated successfully!');
        },
        onError: (message) => {
          setSummaryError(message || 'Course outline generation failed.');
          showToast.error(message || 'Generation failed.');
          setSummaryLoading(false);
          setCourseData(prev => prev ? { ...prev, isStreaming: false } : prev);
        }
      });
      setOutlineStreamController(controller);

    } catch (err) {
      setSummaryLoading(false);
      const errorMessage = handleApiError(err) || 'Failed to generate course notes.';
      setSummaryError(errorMessage);
      showToast.error(errorMessage);
    }
  };

  /** Handle PDF export for course outline sessions */
  const handleOutlinePdfExport = async () => {
    if (!sessionId || outlinePdfExporting) return;
    setOutlinePdfExporting(true);
    try {
      const filename = (courseData?.title || 'course-notes').replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_') + '.pdf';
      await exportCourseOutlineNotes(sessionId, { filename });
      showToast.success('PDF downloaded!');
    } catch (err) {
      showToast.error('PDF export failed. Please try again.');
    } finally {
      setOutlinePdfExporting(false);
    }
  };

  /** Handle PDF export for file summary sessions */
  const handleSummaryPdfExport = async () => {
    if (!sessionId || summaryPdfExporting) return;
    setSummaryPdfExporting(true);
    try {
      const filename = (courseData?.title || 'study-summary').replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_') + '.pdf';
      await exportSummaryPDF(sessionId, { filename });
      showToast.success('PDF downloaded!');
    } catch (err) {
      showToast.error('PDF export failed. Please try again.');
    } finally {
      setSummaryPdfExporting(false);
    }
  };

  /** Retry only failed sub-chapters */
  const handleRetryFailed = async () => {
    if (!sessionId || outlineRetrying) return;
    setOutlineRetrying(true);
    try {
      const retryRes = await retryCourseOutlineFailures(sessionId);
      if (!retryRes.success) {
        showToast.error(retryRes?.error?.message || 'Retry failed.');
        setOutlineRetrying(false);
        return;
      }

      // Mark courseData as streaming while retries happen
      setCourseData(prev => prev ? { ...prev, isStreaming: true } : prev);

      const controller = subscribeToCourseOutlineStream(retryRes.jobId, {
        onSubChapter: (event) => {
          setCourseData(prev => {
            if (!prev) return prev;
            const chapters = prev.chapters.map(ch => {
              if (ch.id !== event.chapterNumber) return ch;
              const subChapters = ch.subChapters.map(sc =>
                sc.number === `${event.chapterNumber}.${event.subChapterNumber}`
                  ? { ...sc, status: event.success ? 'complete' : 'failed' }
                  : sc
              );
              return { ...ch, subChapters };
            });
            return { ...prev, chapters };
          });
        },
        onChapter: (chapter) => {
          setCourseData(prev => {
            if (!prev) return prev;
            const chapters = prev.chapters.map(ch =>
              ch.id === chapter.id ? { ...ch, ...chapter } : ch
            );
            return { ...prev, chapters };
          });
        },
        onComplete: () => {
          setCourseData(prev => prev ? { ...prev, isStreaming: false } : prev);
          setOutlineRetrying(false);
          showToast.success('Failed sections regenerated successfully!');
        },
        onError: (message) => {
          setCourseData(prev => prev ? { ...prev, isStreaming: false } : prev);
          setOutlineRetrying(false);
          showToast.error(message || 'Retry failed.');
        }
      });
      setOutlineStreamController(controller);

    } catch (err) {
      setOutlineRetrying(false);
      showToast.error('Failed to retry. Please try again.');
    }
  };

  // ── Handle dedup modal actions ──
  const handleDedupResume = useCallback(async () => {
    if (!dedupSession?.sessionId) return;
    await handleResumeSession({ _id: dedupSession.sessionId });
    setDedupSession(null);
  }, [dedupSession, handleResumeSession]);

  const handleDedupRegenerate = useCallback(async () => {
    setDedupSession(null);
    // Delete the existing session so a fresh one is created
    if (dedupSession?.sessionId) {
      try { await deleteSummarySession(dedupSession.sessionId); } catch { /* non-fatal */ }
    }
    // Re-run submit — handleSummarize will create a new session since hash won't match anymore
    // Simply trigger the form submit programmatically
    const form = document.querySelector('.generate-form');
    if (form) form.requestSubmit();
  }, [dedupSession]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Belt-and-suspenders: block if the user lacks tokens (should already be caught by disabled button)
    if (limitBlock?.blocked) {
      setError(limitBlock.reason);
      return;
    }

    setError(null);
    setSuccess(null);
    setLoading(true);
    setProgress('Preparing upload...');
    setProgressPercent(0);
    setPartialQuestions([]);

    // Simulate progress updates with time-aware messages for long jobs
    const submitStartTime = Date.now();
    const progressInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - submitStartTime) / 1000);
      setProgressPercent(prev => {
        if (prev >= 90) return 90; // Cap at 90% until actual completion
        return prev + Math.random() * 10;
      });

      // Time-aware UX messages to keep users informed on long jobs
      if (elapsed >= 120) {
        setProgress('Almost there — finalizing your quiz... ⏳');
      } else if (elapsed >= 60) {
        setProgress('Processing large content — this may take another minute...');
      } else if (elapsed >= 30) {
        setProgress('Still working — multi-file or large uploads take a bit longer...');
      } else if (elapsed >= 15) {
        setProgress('Analyzing your notes with AI — please wait...');
      }
    }, 2000);

    try {
      const token = sessionStorage.getItem('authToken');
      if (!token) {
        const msg = 'Please log in to use this feature';
        setError(msg);
        showToast.error(msg);
        setLoading(false);
        setTimeout(() => navigate('/login'), 2000);
        return;
      }

      if (!formData.topic.trim()) {
        const msg = 'Please enter a topic';
        setError(msg);
        showToast.error(msg);
        setLoading(false);
        return;
      }

      // ── Shared job update handler ──
      const handleJobUpdate = (jobData) => {
        if (!jobData) return false;

        if (jobData.status === 'completed') {
          clearInterval(progressInterval);
          setProgressPercent(100);
          setProgress('');
          const questionsCount = jobData.result?.questionsCount || jobData.result?.totalQuestions;
          const isMulti = jobData.result?.isMultiFile;
          const fileCount = jobData.result?.fileCount;
          const coherenceMsg = jobData.result?.coherence?.message;

          let baseMessage = questionsCount
            ? `Successfully generated ${questionsCount} questions!`
            : 'Quiz generation completed!';
          if (isMulti && fileCount) {
            baseMessage = `Generated ${questionsCount || ''} questions from ${fileCount} files!`;
          }
          let successMsg = `${baseMessage} You can now generate more or go to dashboard.`;
          if (coherenceMsg) {
            successMsg += `\n📊 ${coherenceMsg}`;
          }
          setSuccess(successMsg);
          setFormData(prev => ({ ...prev, files: [], text: '' }));
          setPreview(null);
          setPartialQuestions([]);
          setLoading(false);
          return true;
        }

        if (jobData.status === 'failed') {
          clearInterval(progressInterval);
          setProgressPercent(0);
          setProgress('');
          const failMsg = jobData.failedReason || jobData.result?.error || 'Processing failed. Please try again.';
          setError(failMsg);
          showToast.error(failMsg);
          setLoading(false);
          return true;
        }

        if (jobData.progress) {
          setProgressPercent(jobData.progress);
          setProgress(`Processing... ${Math.round(jobData.progress)}%`);
        }
        if (jobData.partialQuestions) {
          setPartialQuestions(jobData.partialQuestions);
        }
        return false;
      };

      const streamJobStatus = async (authToken, jId) => {
        clearInterval(progressInterval);
        const streamResponse = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:5002/api'}/ai/job-status/stream/${encodeURIComponent(jId)}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'ngrok-skip-browser-warning': 'true',
              'Bypass-Tunnel-Reminder': 'true'
            },
            credentials: 'include'
          }
        );

        if (!streamResponse.ok || !streamResponse.body) {
          throw new Error(`Streaming failed: ${streamResponse.status}`);
        }

        const reader = streamResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finished = false;

        while (!finished) {
          let value, done;
          try {
            ({ value, done } = await reader.read());
          } catch (readErr) {
            console.error('SSE stream read error:', readErr);
            break;
          }
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const payload = JSON.parse(trimmed);
              finished = handleJobUpdate(payload);
              if (finished) break;
            } catch { /* skip malformed line */ }
          }
        }

        return finished;
      };

      const pollWithBackoff = async (jId) => {
        clearInterval(progressInterval);
        let consecutiveErrors = 0;
        let delayMs = 2000;

        while (true) {
          try {
            const statusResponse = await API.get(`/ai/job-status/${encodeURIComponent(jId)}`);
            const jobData = statusResponse?.data;
            consecutiveErrors = 0;
            const finished = handleJobUpdate(jobData);
            if (finished) break;
          } catch (err) {
            consecutiveErrors += 1;
            if (consecutiveErrors > 10) {
              const msg = 'Connection lost while generating. Please refresh or check your dashboard later.';
              setError(msg);
              showToast.error(msg);
              setProgressPercent(0);
              setProgress('');
              break;
            }
          }
          await new Promise(resolve => setTimeout(resolve, delayMs));
          delayMs = Math.min(delayMs + 1000, 8000);
        }

        setLoading(false);
        setProgress('');
      };

      // ── Helper: submit + stream a job ──
      const submitAndStream = async (formDataPayload, progressLabel) => {
        // Fetch / refresh CSRF token
        if (!csrfTokenRef.current) {
          const csrfResponse = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5002/api'}/csrf-token`, {
            credentials: 'include',
            headers: { 'ngrok-skip-browser-warning': 'true', 'Bypass-Tunnel-Reminder': 'true' }
          });
          const { csrfToken } = await csrfResponse.json();
          csrfTokenRef.current = csrfToken;
        }

        setProgress(progressLabel);
        setProgressPercent(20);

        const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5002/api'}/ai/generate-from-notes`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-CSRF-Token': csrfTokenRef.current,
            'ngrok-skip-browser-warning': 'true',
            'Bypass-Tunnel-Reminder': 'true'
          },
          credentials: 'include',
          body: formDataPayload
        });

        if (!response.ok) {
          clearInterval(progressInterval);
          setLoading(false);
          setProgressPercent(0);
          setProgress('');
          let errorData = {};
          try { errorData = await response.json(); } catch { /* non-fatal – response may have no body */ }
          const errorMessage = getErrorMessage(errorData, response.status);
          setError(errorMessage);
          showToast.error(errorMessage);
          if (errorData?.error?.code === 'INVALID_CSRF_TOKEN') csrfTokenRef.current = null;
          if (response.status === 401) { setTimeout(() => navigate('/login'), 2500); }
          return;
        }

        const { jobId } = await response.json();
        setProgress('Queued for processing...');
        setProgressPercent(25);

        try {
          const finished = await streamJobStatus(token, jobId);
          if (finished) {
            clearInterval(progressInterval);
            setLoading(false);
            setProgress('');
          }
        } catch (streamErr) {
          console.warn('Streaming failed, falling back to polling:', streamErr.message);
          await pollWithBackoff(jobId);
        }
      };

      // ── Determine path and submit ──
      if (inputMethod === 'file' && formData.files.length > 0) {
        const fileData = new FormData();
        fileData.append('topic', formData.topic.trim());
        fileData.append('numberOfQuestions', formData.numberOfQuestions);
        for (const fileObj of formData.files) {
          fileData.append('file', fileObj);
        }

        const label = formData.files.length > 1
          ? `Uploading ${formData.files.length} files...`
          : `Uploading ${formData.files[0].name}...`;

        await submitAndStream(fileData, label);
      } else if (inputMethod === 'text' && formData.text) {
        if (formData.text.length < 100) {
          clearInterval(progressInterval);
          const msg = 'Please provide at least 100 characters of text';
          setError(msg);
          showToast.error(msg);
          setLoading(false);
          setProgressPercent(0);
          return;
        }
        const textData = new FormData();
        textData.append('topic', formData.topic.trim());
        textData.append('numberOfQuestions', formData.numberOfQuestions);
        textData.append('text', formData.text);

        await submitAndStream(textData, 'Processing text...');
      } else {
        clearInterval(progressInterval);
        const msg = 'Please provide notes content';
        setError(msg);
        showToast.error(msg);
        setLoading(false);
        setProgressPercent(0);
        return;
      }

    } catch (err) {
      clearInterval(progressInterval);
      setProgressPercent(0);
      setProgress('');
      setLoading(false);
      const errorMessage = err.message || 'An unexpected error occurred. Please try again.';
      setError(errorMessage);
      showToast.error(errorMessage);
    }
  };

  // ── Full-screen course view (rendered when Note Summary is ready) ──
  if (activeTool === 'summary' && courseData) {
    const totalChapters = courseData.chapters.length;
    // clamp index so we never access an undefined chapter
    const safeIdx = Math.min(currentChapterIdx, Math.max(0, totalChapters - 1));
    const chapter = courseData.chapters[safeIdx];

    // Sort sub-chapters by number (parallel workers may complete out of order)
    const sortedSubChapters = (chapter?.subChapters || []).slice().sort((a, b) => {
      const aParts = (a.number || '').split('.').map(Number);
      const bParts = (b.number || '').split('.').map(Number);
      return (aParts[0] || 0) - (bParts[0] || 0) || (aParts[1] || 0) - (bParts[1] || 0);
    });

    // ── Full-screen loading skeleton while first chapter is still generating ──
    if (!chapter) {
      return (
        <div className="course-view">
          <div className="course-loading-state">
            <FaSpinner size={38} className="spin" />
            <p className="course-loading-title">{courseData.title}</p>
            <p className="course-loading-subtitle">Generating your course — first chapter coming shortly…</p>
          </div>
        </div>
      );
    }

    // Render bold text (**term**) and highlighted sections
    const chapterHighlights = highlights[safeIdx] || [];

    // Tracks how many times each highlight's text has been encountered
    // across all renderInlineMarkdown calls in this render pass.
    // Declared here (not in state) so it resets each render and accumulates
    // synchronously across all the sequential JSX evaluation calls.
    const hlMatchCounts = {};

    const renderInlineMarkdown = (text = '') => {
      if (!text) return null;

      // ── 0. Math pre-pass: split on math delimiters and render KaTeX ──
      // Patterns: \[...\], $$...$$, \(...\), $...$, bare \frac{}{}, \sqrt{}
      const MATH_RE = /\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$|\\\(([\s\S]*?)\\\)|\$(?!\$)([^$\n]+?)\$|(?<![\w`])\\(?:d|t|c)?frac\{(?:[^{}]|\{[^{}]*\})*\}\{(?:[^{}]|\{[^{}]*\})*\}|\\sqrt(?:\[[^\]]*\])?\{(?:[^{}]|\{[^{}]*\})*\}/g;
      if (MATH_RE.test(text)) {
        MATH_RE.lastIndex = 0;
        const mathParts = [];
        let lastMathIdx = 0;
        let mMatch;
        while ((mMatch = MATH_RE.exec(text)) !== null) {
          if (mMatch.index > lastMathIdx) {
            mathParts.push({ type: 'text', value: text.slice(lastMathIdx, mMatch.index) });
          }
          const raw = mMatch[0];
          const isDisplay = raw.startsWith('\\[') || raw.startsWith('$$');
          let latex;
          if (raw.startsWith('\\[')) latex = mMatch[1];
          else if (raw.startsWith('$$')) latex = mMatch[2];
          else if (raw.startsWith('\\(')) latex = mMatch[3];
          else if (raw.startsWith('$')) latex = mMatch[4];
          else latex = raw; // bare macro: \frac, \sqrt, etc.
          mathParts.push({ type: 'math', latex: (latex || raw).trim(), display: isDisplay });
          lastMathIdx = mMatch.index + raw.length;
        }
        if (lastMathIdx < text.length) {
          mathParts.push({ type: 'text', value: text.slice(lastMathIdx) });
        }
        if (mathParts.some(p => p.type === 'math')) {
          return mathParts.map((part, pi) => {
            if (part.type === 'math') {
              let html;
              try { html = katex.renderToString(part.latex, { displayMode: part.display, throwOnError: false, output: 'html' }); } catch { html = null; }
              if (!html) return <span key={pi}>{part.latex}</span>;
              return part.display
                ? <div key={pi} className="course-katex-display" dangerouslySetInnerHTML={{ __html: html }} />
                : <span key={pi} className="course-katex-inline" dangerouslySetInnerHTML={{ __html: html }} />;
            }
            // Plain text segment: pass through bold/highlight rendering
            return <span key={pi}>{renderInlineMarkdown(part.value)}</span>;
          });
        }
      }

      // 1. Build an array of characters with formatting
      // We first strip `**` but keep track of which chars are bold
      const chars = [];
      let isBold = false;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '*' && text[i + 1] === '*') {
          isBold = !isBold;
          i++; // skip second *
          continue;
        }
        chars.push({ char: text[i], bold: isBold, highlightColor: null, highlightId: null });
      }

      // the plain text without **
      const plainText = chars.map(c => c.char).join('');

      // 2. Apply highlights — only mark the exact occurrence that was selected
      const sortedHl = [...chapterHighlights].sort((a, b) => b.text.length - a.text.length);
      sortedHl.forEach(h => {
        if (!h.text) return;
        let regex;
        try {
          regex = new RegExp(h.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        } catch (e) { return; }

        const targetIdx = h.occurrenceIndex ?? 0;
        let match;
        while ((match = regex.exec(plainText)) !== null) {
          const globalCount = hlMatchCounts[h.id] ?? 0;
          hlMatchCounts[h.id] = globalCount + 1;
          // Only colour the exact occurrence that the user selected
          if (globalCount === targetIdx) {
            const start = match.index;
            const end = start + h.text.length;
            for (let i = start; i < end; i++) {
              if (!chars[i].highlightColor) {
                chars[i].highlightColor = h.color;
                chars[i].highlightId = h.id;
              }
            }
          }
        }
      });

      // 3. Group consecutive characters with identical formatting into chunks
      const chunks = [];
      let currentChunk = null;

      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        if (!currentChunk) {
          currentChunk = { text: c.char, bold: c.bold, color: c.highlightColor, id: c.highlightId };
        } else if (currentChunk.bold === c.bold && currentChunk.color === c.highlightColor) {
          currentChunk.text += c.char;
        } else {
          chunks.push(currentChunk);
          currentChunk = { text: c.char, bold: c.bold, color: c.highlightColor, id: c.highlightId };
        }
      }
      if (currentChunk) chunks.push(currentChunk);

      // 4. Render chunks
      return chunks.map((chunk, i) => {
        let node = chunk.text;
        if (chunk.bold) node = <strong key={`b-${i}`}>{node}</strong>;

        if (chunk.color) {
          node = (
            <mark
              key={`m-${i}`}
              className="course-highlight"
              style={{ backgroundColor: chunk.color }}
              title="Click to remove highlight"
              onClick={() => removeHighlight(Number(chunk.id))}
            >
              {node}
            </mark>
          );
        } else if (!chunk.bold) {
          node = <span key={`s-${i}`}>{node}</span>;
        }
        return node;
      });
    };

    /**
     * Renders a content string that may contain markdown code fences.
     * Splits into text and code segments — text uses renderInlineMarkdown,
     * code blocks use LiveCodeEditor.
     */
    const renderContentWithCode = (text, baseKey = '') => {
      if (!text) return null;
      const segments = parseContentSegments(text);
      return segments.flatMap((seg, idx) => {
        if (seg.type === 'code') {
          return [
            <LiveCodeEditor
              key={`${baseKey}-code-${idx}`}
              code={seg.content}
              language={seg.language}
            />
          ];
        }

        // Extract display math blocks BEFORE line splitting
        const MATH_BLOCK_RE = /(\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$)/g;
        const mathSegments = seg.content.split(MATH_BLOCK_RE);

        return mathSegments.flatMap((mSeg, mIdx) => {
          if (!mSeg) return [];

          if (mSeg.startsWith('\\[') || mSeg.startsWith('$$')) {
             let latex = mSeg.startsWith('\\[') ? mSeg.slice(2, -2) : mSeg.slice(2, -2);
             latex = latex.trim();
             let html;
             try { html = katex.renderToString(latex, { displayMode: true, throwOnError: false, output: 'html' }); } catch { html = null; }
             if (html) {
                 return [<div key={`${baseKey}-math-${idx}-${mIdx}`} className="course-katex-display" dangerouslySetInnerHTML={{ __html: html }} />];
             } else {
                 return [<div key={`${baseKey}-math-${idx}-${mIdx}`} className="course-katex-display">{mSeg}</div>];
             }
          }

          // Normal text
          const lines = mSeg.split('\n');
          // Clean up boundary newlines created by the match splitting
          if (lines.length > 0 && lines[0] === '') lines.shift();
          if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

          return lines.flatMap((line, li) => {
            if (!line.trim()) return [<br key={`${baseKey}-br-${idx}-${mIdx}-${li}`} />];
            return [
              <p key={`${baseKey}-p-${idx}-${mIdx}-${li}`} className="course-teaching-text">
                {renderInlineMarkdown(line)}
              </p>
            ];
          });
        });
      });
    };

    return (
      <div className="course-view">
        {/* Mobile backdrop — closes open drawers when tapped */}
        {(isSidebarOpen || activeSidePanel) && (
          <div
            className="course-mobile-backdrop"
            onClick={() => { setIsSidebarOpen(false); setActiveSidePanel(null); }}
          />
        )}
        {/* ── Left Sidebar ── */}
        <aside className={`course-sidebar ${isSidebarOpen ? 'open' : 'closed'}`}>
          <div className="course-sidebar-header">
          <div className="course-sidebar-header-top">
              <button
                className="course-back-btn"
                onClick={() => { setCourseData(null); setSummaryResult(null); setSessionId(null); setQuickCheckData(null); }}
                title="Back to form"
              >
                <FaArrowLeft size={14} />
              </button>
              {sessionId && (
                <button
                  type="button"
                  className="course-back-btn"
                  title="Delete this session"
                  style={{ color: '#e53e3e', marginLeft: 'auto' }}
                  onClick={async () => {
                    if (!confirm('Delete this session permanently? This cannot be undone.')) return;
                    try {
                      await deleteSummarySession(sessionId);
                      setSessionHistory(prev => prev.filter(s => String(s._id) !== String(sessionId)));
                      setCourseData(null);
                      setSummaryResult(null);
                      setSessionId(null);
                      setQuickCheckData(null);
                      showToast.success('Session deleted');
                    } catch (err) {
                      console.error('Delete session error:', err?.response?.data || err?.message);
                      const msg = err?.response?.data?.error?.message || 'Failed to delete session';
                      showToast.error(msg);
                    }
                  }}
                >
                  <FaTrash size={13} />
                </button>
              )}
              <button
                className="course-sidebar-toggle-btn close"
                onClick={() => setIsSidebarOpen(false)}
                title="Collapse Sidebar"
              >
                <FaChevronLeft size={14} />
              </button>
            </div>
            <h3 className="course-sidebar-title">{courseData.title}</h3>
          </div>

          <div className="course-chapter-list">
            {courseData.chapters.map((ch, idx) => (
              <div key={ch.id} className="course-chapter-group">
                <button
                  className={`course-chapter-item ${idx === safeIdx ? 'active' : ''}`}
                  onClick={() => { setCurrentChapterIdx(idx); setActiveSubChapterIdx(-1); setCourseTab('lesson'); }}
                >
                  <span className="chapter-item-text">{ch.title}</span>
                  {idx === safeIdx && <FaChevronRight size={10} className="chapter-item-arrow" />}
                </button>
                {/* Sub-chapter list for outline sessions */}
                {courseData.sessionType === 'course_outline' && idx === safeIdx && sortedSubChapters.length > 0 && (
                  <div className="course-subchapter-list">
                    <button
                      className={`course-subchapter-item ${activeSubChapterIdx === -1 ? 'active' : ''}`}
                      onClick={() => setActiveSubChapterIdx(-1)}
                    >
                      <span className="subchapter-item-text">Overview</span>
                    </button>
                    {sortedSubChapters.map((sc, scIdx) => (
                      <button
                        key={sc.number}
                        className={`course-subchapter-item ${activeSubChapterIdx === scIdx ? 'active' : ''} ${sc.status === 'generating' ? 'generating' : ''} ${sc.status === 'failed' ? 'failed' : ''}`}
                        onClick={() => setActiveSubChapterIdx(scIdx)}
                        disabled={sc.status === 'generating'}
                      >
                        <span className="subchapter-item-number">{sc.number}</span>
                        <span className="subchapter-item-text">{sc.title}</span>
                        {sc.status === 'generating' && <FaSpinner size={9} className="spin" />}
                        {sc.status === 'failed' && <FaExclamationTriangle size={9} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {courseData.isStreaming && (
              <div className="course-chapter-item chapter-generating" aria-label="Generating more chapters">
                <FaSpinner size={10} className="spin" />
                <span className="chapter-item-text">Generating…</span>
              </div>
            )}
          </div>
        </aside>

        {/* ── Main Content ── */}
        <main className="course-main">
          {!isSidebarOpen && (
            <button
              className="course-sidebar-toggle-btn open"
              onClick={() => setIsSidebarOpen(true)}
              title="Expand Sidebar"
            >
              <FaBars size={18} />
            </button>
          )}
          <div className="course-main-inner">
            {/* AI Disclaimer for outline sessions */}
            {courseData.sessionType === 'course_outline' && (
              <div className="outline-ai-disclaimer">
                <FaRobot size={14} />
                <span>AI-generated content. Always verify with your course materials.</span>
              </div>
            )}

            {/* Chapter header */}
            <div className="course-chapter-header">
              <h1 className="course-chapter-title">{chapter.title}</h1>
              <div className="course-chapter-header-row">
                <p className="course-chapter-subtitle">Chapter {safeIdx + 1} of {totalChapters}{courseData.isStreaming ? '…' : ''}</p>
                {/* PDF export button for outline sessions */}
                {courseData.sessionType === 'course_outline' && !courseData.isStreaming && (
                  <button
                    className="outline-pdf-export-btn"
                    onClick={handleOutlinePdfExport}
                    disabled={outlinePdfExporting}
                    title="Export notes as PDF"
                  >
                    {outlinePdfExporting ? <FaSpinner className="spin" size={12} /> : <FaFileAlt size={12} />}
                    <span>{outlinePdfExporting ? 'Exporting…' : 'Export PDF'}</span>
                  </button>
                )}
                {/* PDF export button for file summary sessions */}
                {courseData.sessionType !== 'course_outline' && !courseData.isStreaming && sessionId && (
                  <button
                    className="outline-pdf-export-btn"
                    onClick={handleSummaryPdfExport}
                    disabled={summaryPdfExporting}
                    title="Download summary as PDF"
                  >
                    {summaryPdfExporting ? <FaSpinner className="spin" size={12} /> : <FaFileAlt size={12} />}
                    <span>{summaryPdfExporting ? 'Exporting…' : 'Export PDF'}</span>
                  </button>
                )}
                {/* Retry failed sub-chapters button */}
                {courseData.sessionType === 'course_outline' && !courseData.isStreaming &&
                  courseData.chapters.some(ch => ch.subChapters?.some(sc => sc.status === 'failed')) && (
                  <button
                    className="outline-retry-btn"
                    onClick={handleRetryFailed}
                    disabled={outlineRetrying}
                    title="Retry failed sections"
                  >
                    {outlineRetrying ? <FaSpinner className="spin" size={12} /> : <FaRedoAlt size={12} />}
                    <span>{outlineRetrying ? 'Retrying…' : 'Retry Failed'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Tabs + audio + voice */}
            <div className="course-tabs-row">
              <div className="course-tabs">
                {[
                  { id: 'lesson', icon: <FaBookOpen size={13} />, label: 'Lesson' },
                  { id: 'podcast', icon: <FaPodcast size={13} />, label: 'Podcast' },
                ].map(tab => (
                  <button
                    key={tab.id}
                    className={`course-tab ${courseTab === tab.id ? 'active' : ''}`}
                    onClick={() => setCourseTab(tab.id)}
                  >
                    {tab.icon} {tab.label}
                  </button>
                ))}
              </div>
              <div className="course-audio-controls">
                {/* Voice selector */}
                {availableVoices.length > 0 && (
                  <select
                    className="course-voice-select"
                    value={selectedVoice?.name || ''}
                    onChange={(e) => {
                      const v = availableVoices.find(voice => voice.name === e.target.value);
                      if (v) setSelectedVoice(v);
                    }}
                    title="Select voice"
                  >
                    {availableVoices.map(v => (
                      <option key={v.name} value={v.name}>
                        {v.name.replace(/^(Google |Microsoft |Apple )/, '').substring(0, 20)}
                      </option>
                    ))}
                  </select>
                )}
                {!isSpeaking && !isPaused && (
                  <button className="course-audio-btn" title="Listen to chapter" onClick={handleTTSPlay}>
                    <FaVolumeUp size={16} />
                  </button>
                )}
                {isSpeaking && (
                  <button className="course-audio-btn active" title="Pause" onClick={handleTTSPause}>
                    <FaPause size={14} />
                  </button>
                )}
                {isPaused && (
                  <button className="course-audio-btn" title="Resume" onClick={handleTTSPlay}>
                    <FaPlay size={14} />
                  </button>
                )}
                {(isSpeaking || isPaused) && (
                  <button className="course-audio-btn stop" title="Stop" onClick={handleTTSStop}>
                    <FaStop size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Lesson content — highlightable */}
            {courseTab === 'lesson' && (
              <div
                className="course-lesson-content"
                ref={lessonContentRef}
              >
                <h2 className="course-lesson-heading">{chapter.title}</h2>

                {/* ── Course Outline Session: Overview + Sub-chapters ── */}
                {courseData.sessionType === 'course_outline' ? (
                  <>
                    {/* Overview (activeSubChapterIdx === -1) or Sub-chapter content */}
                    {activeSubChapterIdx === -1 ? (
                      <div className="course-section outline-overview-section">
                        <h3 className="course-section-title">Chapter Overview</h3>
                        {chapter.overview ? (
                          <div className="outline-overview-content">
                            {renderContentWithCode(chapter.overview, `overview-${currentChapterIdx}`)}
                          </div>
                        ) : (
                          <div className="outline-generating-placeholder">
                            <FaSpinner className="spin" size={14} />
                            <span>Generating overview…</span>
                          </div>
                        )}

                        {/* Sub-chapter cards grid */}
                        {sortedSubChapters.length > 0 && (
                          <div className="outline-subchapter-cards">
                            <h4 className="outline-cards-heading">Sub-topics in this chapter</h4>
                            <div className="outline-cards-grid">
                              {sortedSubChapters.map((sc, scIdx) => (
                                <button
                                  key={sc.number}
                                  className={`outline-card ${sc.status}`}
                                  onClick={() => setActiveSubChapterIdx(scIdx)}
                                  disabled={sc.status === 'generating'}
                                >
                                  <span className="outline-card-number">{sc.number}</span>
                                  <span className="outline-card-title">{sc.title}</span>
                                  {sc.status === 'generating' && <FaSpinner className="spin" size={10} />}
                                  {sc.status === 'complete' && <FaCheckCircle size={10} className="outline-card-check" />}
                                  {sc.status === 'failed' && <FaExclamationTriangle size={10} className="outline-card-fail" />}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="course-section outline-subchapter-section">
                        {(() => {
                          const sc = sortedSubChapters[activeSubChapterIdx];
                          if (!sc) return null;
                          return (
                            <>
                              <div className="outline-subchapter-header">
                                <button className="outline-back-to-overview" onClick={() => setActiveSubChapterIdx(-1)}>
                                  <FaArrowLeft size={11} /> Back to Overview
                                </button>
                                <h3 className="course-section-title">{sc.number} — {sc.title}</h3>
                              </div>
                              {sc.status === 'generating' ? (
                                <div className="outline-generating-placeholder">
                                  <FaSpinner className="spin" size={14} />
                                  <span>Generating this section…</span>
                                </div>
                              ) : sc.content ? (
                                <div className="outline-subchapter-content">
                                  {renderContentWithCode(sc.content, `sc-${sc.number}`)}
                                </div>
                              ) : (
                                <p className="outline-empty-content">No content available for this section.</p>
                              )}

                              {/* Sub-chapter navigation */}
                              <div className="course-chapter-nav outline-sc-nav">
                                <button
                                  className="course-nav-btn"
                                  disabled={activeSubChapterIdx <= 0}
                                  onClick={() => setActiveSubChapterIdx(i => i - 1)}
                                >
                                  ← Previous
                                </button>
                                <span className="course-nav-progress">{activeSubChapterIdx + 1} / {sortedSubChapters.length}</span>
                                <button
                                  className="course-nav-btn"
                                  disabled={activeSubChapterIdx >= sortedSubChapters.length - 1}
                                  onClick={() => setActiveSubChapterIdx(i => i + 1)}
                                >
                                  Next →
                                </button>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}

                    {/* Chapter navigation (between chapters) */}
                    {activeSubChapterIdx === -1 && (
                      <div className="course-chapter-nav">
                        <button
                          className="course-nav-btn"
                          disabled={currentChapterIdx === 0}
                          onClick={() => { setCurrentChapterIdx(i => i - 1); setActiveSubChapterIdx(-1); setCourseTab('lesson'); }}
                        >
                          ← Previous Chapter
                        </button>
                        <span className="course-nav-progress">{currentChapterIdx + 1} / {totalChapters}</span>
                        <button
                          className="course-nav-btn"
                          disabled={currentChapterIdx === totalChapters - 1}
                          onClick={() => { setCurrentChapterIdx(i => i + 1); setActiveSubChapterIdx(-1); setCourseTab('lesson'); }}
                        >
                          Next Chapter →
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* ── Regular File Summary Session: Hook + Core Teaching + Takeaways ── */}
                    {/* Hook */}
                    <div className="course-section hook-section">
                      <h3 className="course-section-title">Hook: {chapter.coreTeaching?.[0]?.sectionTitle || 'Introduction'}</h3>
                      <p className="course-hook-text">{renderInlineMarkdown(chapter.hook)}</p>
                    </div>

                    {/* Core Teaching */}
                    <div className="course-section">
                      <h3 className="course-section-title">Core Teaching</h3>
                      {chapter.coreTeaching?.map((section, si) => (
                        <div key={si} className="course-teaching-block">
                          <h4 className="course-teaching-subtitle">{section.sectionTitle}</h4>
                          {renderContentWithCode(section.content, `section-${si}`)}
                        </div>
                      ))}
                    </div>

                    {/* Key Takeaways */}
                    {chapter.keyTakeaways?.length > 0 && (
                      <div className="course-section">
                        <h3 className="course-section-title">Key Takeaways</h3>
                        <ul className="course-takeaways">
                          {chapter.keyTakeaways.map((tk, ti) => (
                            <li key={ti}>{renderInlineMarkdown(tk)}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Chapter navigation */}
                    <div className="course-chapter-nav">
                      <button
                        className="course-nav-btn"
                        disabled={currentChapterIdx === 0}
                        onClick={() => { setCurrentChapterIdx(i => i - 1); setCourseTab('lesson'); }}
                      >
                        ← Previous
                      </button>
                      <span className="course-nav-progress">{currentChapterIdx + 1} / {totalChapters}</span>
                      <button
                        className="course-nav-btn"
                        disabled={currentChapterIdx === totalChapters - 1}
                        onClick={() => { setCurrentChapterIdx(i => i + 1); setCourseTab('lesson'); }}
                      >
                        Next →
                      </button>
                    </div>
                  </>
                )}

                {/* ── Action buttons: Quiz + Quick Check ── */}
                {/* {!courseData.isStreaming && (
                  <div className="course-action-buttons">
                    <button
                      className="course-action-btn quiz-btn"
                      disabled={quizFromSummaryLoading || !sessionId}
                      onClick={async () => {
                        if (!sessionId) return showToast.error('No active session');
                        setQuizFromSummaryLoading(true);
                        try {
                          const res = await generateQuizFromSummary(sessionId, { count: 15 });
                          const n = res?.questions?.length || 15;
                          showToast.success(`${n} quiz questions generated! Check your dashboard.`);
                        } catch { showToast.error('Failed to generate quiz'); }
                        setQuizFromSummaryLoading(false);
                      }}
                    >
                      {quizFromSummaryLoading ? <><FaSpinner className="spin" /> Generating Quiz…</> : <><FaQuestionCircle /> Generate Quiz</>}
                    </button>
                    <button
                      className="course-action-btn test-btn"
                      disabled={quickCheckLoading || !sessionId}
                      onClick={async () => {
                        if (!sessionId) return showToast.error('No active session');
                        setQuickCheckLoading(true);
                        try {
                          const res = await quickCheck(sessionId, { chapterIdx: currentChapterIdx });
                          if (res?.questions?.length) {
                            setQuickCheckData(res);
                            setQuickCheckAnswers({});
                            setQuickCheckRevealed(false);
                          }
                        } catch { showToast.error('Failed to generate quick check'); }
                        setQuickCheckLoading(false);
                      }}
                    >
                      {quickCheckLoading ? <><FaSpinner className="spin" /> Loading…</> : <><FaBolt /> Test Yourself</>}
                    </button>
                  </div>
                )} */}

                {/* ── Inline Quick Check ── */}
                {quickCheckData?.questions?.length > 0 && (
                  <div className="quick-check-section">
                    <div className="quick-check-header">
                      <h3><FaBolt /> Quick Comprehension Check</h3>
                      <button className="quick-check-close" onClick={() => setQuickCheckData(null)}><FaTimes size={14} /></button>
                    </div>
                    <div className="quick-check-questions">
                      {quickCheckData.questions.map((q, qi) => (
                        <div key={qi} className={`quick-check-q ${quickCheckRevealed ? (quickCheckAnswers[qi] === q.correctAnswer ? 'correct' : 'incorrect') : ''}`}>
                          <p className="quick-check-text"><strong>Q{qi + 1}.</strong> {q.questionText}</p>
                          <div className="quick-check-options">
                            {q.options?.map((opt, oi) => (
                              <button
                                key={oi}
                                className={`quick-check-option ${quickCheckAnswers[qi] === oi ? 'selected' : ''} ${quickCheckRevealed && oi === q.correctAnswer ? 'correct-answer' : ''}`}
                                onClick={() => { if (!quickCheckRevealed) setQuickCheckAnswers(prev => ({ ...prev, [qi]: oi })); }}
                                disabled={quickCheckRevealed}
                              >
                                <span className="option-letter">{String.fromCharCode(65 + oi)}</span>
                                {opt.replace(/^[A-Da-d][.):\s]\s*/,'')}
                              </button>
                            ))}
                          </div>
                          {quickCheckRevealed && q.explanation && (
                            <p className="quick-check-explanation">💡 {q.explanation}</p>
                          )}
                        </div>
                      ))}
                    </div>
                    {!quickCheckRevealed ? (
                      <button
                        className="quick-check-submit"
                        disabled={Object.keys(quickCheckAnswers).length < quickCheckData.questions.length}
                        onClick={() => setQuickCheckRevealed(true)}
                      >
                        Check Answers ({Object.keys(quickCheckAnswers).length}/{quickCheckData.questions.length})
                      </button>
                    ) : (
                      <div className="quick-check-score">
                        <strong>Score: {quickCheckData.questions.filter((q, i) => quickCheckAnswers[i] === q.correctAnswer).length}/{quickCheckData.questions.length}</strong>
                        <button className="quick-check-retry" onClick={() => { setQuickCheckAnswers({}); setQuickCheckRevealed(false); }}>
                          <FaRedoAlt size={12} /> Retry
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Selection popup for highlighting */}
            {selectionPopup && courseTab === 'lesson' && (
              <div
                className="highlight-popup"
                style={{
                  position: 'fixed',
                  left: `${Math.min(selectionPopup.x, window.innerWidth - 220)}px`,
                  top: `${Math.max(selectionPopup.y - 48, 8)}px`,
                }}
              >
                <div className="highlight-popup-colors">
                  {HIGHLIGHT_COLORS.map(c => (
                    <button
                      key={c.name}
                      className="highlight-color-btn"
                      style={{ backgroundColor: c.value }}
                      title={`Highlight ${c.name}`}
                      onClick={() => addHighlight(c.value)}
                    />
                  ))}
                  {customHighlightColors.map((c, i) => (
                    <button
                      key={`custom-${i}`}
                      className="highlight-color-btn"
                      style={{ backgroundColor: c }}
                      title="Custom highlight"
                      onClick={() => addHighlight(c)}
                    />
                  ))}
                  <label className="highlight-custom-btn" title="Pick custom colour">
                    +
                    <input
                      type="color"
                      className="highlight-color-input"
                      defaultValue="#a78bfa"
                      onClick={e => e.stopPropagation()}
                      onChange={e => {
                        const col = e.target.value;
                        setCustomHighlightColors(prev =>
                          prev.includes(col) ? prev : [...prev.slice(-4), col]
                        );
                        addHighlight(col);
                      }}
                    />
                  </label>
                </div>
                <button className="highlight-add-notes-btn" onClick={addSelectionToNotes}>
                  <FaPen size={10} /> Notes
                </button>
              </div>
            )}

            {/* Podcast tab */}
            {courseTab === 'podcast' && (
              <div className="course-podcast-content">
                <div className="course-podcast-card">
                  <FaPodcast size={48} className="course-podcast-icon" />
                  <h3>Coming Soon</h3>
                  <p>Audio podcast generation for this chapter will be available in a future update.</p>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* ── Resize handle ── */}
        <div
          className="course-resize-handle"
          onMouseDown={handleResizeMouseDown}
          title="Drag to resize"
        />

        {/* ── Unified Side Panel (Tutor, Notes, Highlights) ── */}
        <aside
          className={`course-side-panel ${activeSidePanel ? 'open' : 'closed'}`}
          style={activeSidePanel ? { width: `${tutorWidth}px` } : undefined}
        >
          <div className="course-side-panel-header">
            <div className="course-side-panel-header-left">
              {activeSidePanel === 'tutor' && <><FaRobot size={16} /> <h3 className="course-side-panel-title">APOLLO</h3></>}
              {activeSidePanel === 'notes' && <><FaPen size={15} /> <h3 className="course-side-panel-title">My Notes</h3></>}
              {activeSidePanel === 'highlights' && <><FaHighlighter size={15} /> <h3 className="course-side-panel-title">Highlights</h3></>}
            </div>
            <div className="course-side-panel-header-right">
              {/* Thread controls — only shown in tutor panel */}
              {activeSidePanel === 'tutor' && (
                <>
                  <button
                    className="thread-ctrl-btn"
                    title="New Chat"
                    onClick={handleNewThread}
                    disabled={!sessionId}
                  >
                    <FaSlash size={9} style={{ transform: 'rotate(90deg)' }} />
                    <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>New</span>
                  </button>
                  <button
                    className={`thread-ctrl-btn ${showThreadList ? 'active' : ''}`}
                    title={showThreadList ? 'Hide chats' : 'Show chats'}
                    onClick={() => setShowThreadList(p => !p)}
                    disabled={!sessionId}
                  >
                    <FaList size={12} />
                    {chatThreads.length > 0 && (
                      <span className="thread-count-badge">{chatThreads.length}</span>
                    )}
                  </button>
                </>
              )}
              <button
                className="course-side-panel-close"
                onClick={() => setActiveSidePanel(null)}
                title="Close panel"
              >
                <FaTimes size={14} />
              </button>
            </div>
          </div>

          <div className="course-side-panel-content" style={{ display: 'flex', flexDirection: 'column', position: 'relative', height: '100%', overflow: 'hidden' }}>
            {/* 1. AI Tutor View */}
            {activeSidePanel === 'tutor' && (
              <>
                {/* ── Thread List (slides in when showThreadList = true) ── */}
                {showThreadList && (
                  <div className="thread-list-panel">
                    <div className="thread-list-header">
                      <span>Chats ({chatThreads.length}/20)</span>
                      <button className="thread-list-new-btn" onClick={handleNewThread} disabled={!sessionId || chatThreads.length >= 20}>
                        + New Chat
                      </button>
                    </div>

                    {chatThreadsLoading ? (
                      <div className="thread-list-loading"><FaSpinner className="spin" size={14} /></div>
                    ) : chatThreads.length === 0 ? (
                      <p className="thread-list-empty">No chats yet. Send a message to start one.</p>
                    ) : (
                      <ul className="thread-list">
                        {chatThreads.map(thread => (
                          <li
                            key={thread._id}
                            className={`thread-list-item ${thread._id === activeChatThreadId ? 'active' : ''}`}
                            onClick={() => { if (renamingThreadId !== thread._id) switchToThread(thread); }}
                          >
                            {renamingThreadId === thread._id ? (
                              <input
                                className="thread-rename-input"
                                value={renameValue}
                                autoFocus
                                onChange={e => setRenameValue(e.target.value)}
                                onBlur={() => commitRename(thread._id)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') commitRename(thread._id);
                                  if (e.key === 'Escape') { setRenamingThreadId(null); setRenameValue(''); }
                                }}
                                onClick={e => e.stopPropagation()}
                              />
                            ) : (
                              <>
                                <span className="thread-list-title">{thread.title || 'New Chat'}</span>
                                <div className="thread-list-actions">
                                  <button
                                    className="thread-action-btn"
                                    title="Rename"
                                    onClick={e => { e.stopPropagation(); setRenamingThreadId(thread._id); setRenameValue(thread.title || ''); }}
                                  >
                                    <FaPen size={10} />
                                  </button>
                                  <button
                                    className="thread-action-btn danger"
                                    title="Delete chat"
                                    onClick={e => handleDeleteThread(thread._id, e)}
                                  >
                                    <FaTimes size={10} />
                                  </button>
                                </div>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Active thread label */}
                {activeChatThreadId && !showThreadList && (() => {
                  const t = chatThreads.find(x => x._id === activeChatThreadId);
                  return t ? (
                    <div className="active-thread-label" onClick={() => setShowThreadList(true)} title="Switch chat">
                      <FaList size={9} />
                      <span>{t.title}</span>
                      <FaChevronDown size={9} />
                    </div>
                  ) : null;
                })()}
                <div className="course-tutor-messages">
                  {tutorMessages.map((msg, i) => (
                    <div key={i} className={`tutor-msg ${msg.role}`}>
                      {msg.role === 'assistant'
                        ? renderTutorMarkdown(msg.content)
                        : msg.content}
                    </div>
                  ))}
                  {tutorLoading && (
                    <div className="tutor-msg assistant tutor-typing">
                      <span /><span /><span />
                    </div>
                  )}
                  <div ref={tutorEndRef} />
                </div>

                <div className="course-tutor-input-row">
                  {showSlashPalette && (
                    <div className="slash-palette">
                      {SLASH_COMMANDS
                        .filter(c => !slashFilter || c.cmd.includes(slashFilter) || c.desc.toLowerCase().includes(slashFilter.toLowerCase()))
                        .map(c => (
                          <button
                            key={c.cmd}
                            className="slash-palette-item"
                            onClick={() => {
                              setTutorInput(c.cmd + ' ');
                              setShowSlashPalette(false);
                              tutorInputRef.current?.focus();
                            }}
                          >
                            <span className="slash-palette-icon">{c.icon}</span>
                            <span className="slash-palette-cmd">{c.cmd}</span>
                            {c.args && <span className="slash-palette-args">{c.args}</span>}
                            <span className="slash-palette-desc">{c.desc}</span>
                          </button>
                        ))
                      }
                    </div>
                  )}
                  <input
                    ref={tutorInputRef}
                    className="course-tutor-input"
                    placeholder={`Ask anything or type / for commands…`}
                    value={tutorInput}
                    onChange={e => {
                      const val = e.target.value;
                      setTutorInput(val);
                      if (val === '/') {
                        setShowSlashPalette(true);
                        setSlashFilter('');
                      } else if (val.startsWith('/')) {
                        setShowSlashPalette(true);
                        setSlashFilter(val.split(/\s/)[0]);
                      } else {
                        setShowSlashPalette(false);
                      }
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendTutor();
                      }
                      if (e.key === 'Escape') setShowSlashPalette(false);
                    }}
                    disabled={tutorLoading}
                  />
                  <button
                    className="course-tutor-send"
                    onClick={() => handleSendTutor()}
                    disabled={tutorLoading || !tutorInput.trim()}
                  >
                    <FaPaperPlane size={14} />
                  </button>
                </div>
              </>
            )}

            {/* 2. My Notes View (Rich Text Editor) */}
            {activeSidePanel === 'notes' && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--background)' }}>
                {/* Rich Text Toolbar */}
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '8px', background: 'var(--background-light)', flexWrap: 'wrap' }}>
                  <button onClick={() => document.execCommand('bold', false, null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold' }}>B</button>
                  <button onClick={() => document.execCommand('italic', false, null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', fontStyle: 'italic' }}>I</button>
                  <button onClick={() => document.execCommand('underline', false, null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', textDecoration: 'underline' }}>U</button>
                  <div style={{ width: '1px', background: 'var(--border-color)', margin: '0 4px' }} />
                  <button onClick={() => document.execCommand('fontSize', false, '3')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px' }}>A-</button>
                  <button onClick={() => document.execCommand('fontSize', false, '5')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', fontSize: '1.2em', fontWeight: 'bold' }}>A+</button>
                  <div style={{ width: '1px', background: 'var(--border-color)', margin: '0 4px' }} />
                  <button onClick={() => document.execCommand('insertUnorderedList', false, null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center' }} title="Bullet List"><FaList size={12} /></button>
                </div>

                <textarea
                  className="course-notes-editor"
                  style={{
                    flex: 1,
                    padding: '1rem',
                    outline: 'none',
                    border: 'none',
                    resize: 'none',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    fontFamily: 'inherit',
                    fontSize: '0.95rem',
                    lineHeight: '1.6'
                  }}
                  value={userNotes[currentChapterIdx] || ''}
                  onChange={e => setUserNotes(prev => ({ ...prev, [currentChapterIdx]: e.target.value }))}
                  placeholder="Write your notes here… or highlight text and click 'Add to Notes'"
                />
              </div>
            )}

            {/* 3. Highlights View */}
            {activeSidePanel === 'highlights' && (() => {
              const grouped = allHighlightsGrouped();
              const totalHL = Object.values(grouped).flat().length;
              return (
                <div style={{ padding: '1rem', height: '100%', overflowY: 'auto' }}>
                  {totalHL === 0 ? (
                    <p className="highlights-empty" style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '2rem' }}>
                      No highlights yet. Select text in the lesson and pick a color to start.
                    </p>
                  ) : (
                    HIGHLIGHT_COLORS.map(c => {
                      const items = grouped[c.value] || [];
                      if (items.length === 0) return null;
                      return (
                        <div key={c.value} className="highlight-group" style={{ marginBottom: '1.5rem' }}>
                          <div className="highlight-group-header" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
                            <span className="highlight-group-dot" style={{ backgroundColor: c.value, width: '12px', height: '12px', borderRadius: '50%' }} />
                            <input
                              className="highlight-group-label"
                              value={highlightGroupLabels[c.value] || c.defaultLabel}
                              onChange={e => setHighlightGroupLabels(prev => ({ ...prev, [c.value]: e.target.value }))}
                              title="Click to rename this group"
                              style={{ border: 'none', background: 'transparent', fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-primary)', outline: 'none', flex: 1 }}
                            />
                            <span className="highlight-group-count" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'var(--background-light)', padding: '2px 6px', borderRadius: '12px' }}>{items.length}</span>
                          </div>
                          <div className="highlight-group-items" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {items.map(h => (
                              <div
                                key={h.id}
                                className="highlight-group-item"
                                onClick={() => {
                                  setCurrentChapterIdx(h.chapterIdx);
                                  setCourseTab('lesson');
                                }}
                                style={{ padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer', position: 'relative', transition: 'all 0.2s', background: 'var(--background-light)' }}
                              >
                                <mark style={{ backgroundColor: c.value, padding: '2px 4px', borderRadius: '3px', display: 'block', fontSize: '0.85rem', lineHeight: '1.4', marginBottom: '8px' }}>
                                  {h.text.length > 80 ? h.text.substring(0, 80) + '…' : h.text}
                                </mark>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span className="highlight-group-chapter" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                    Chapter {h.chapterIdx + 1}
                                  </span>
                                  <button
                                    className="highlight-group-remove"
                                    onClick={(e) => { e.stopPropagation(); removeHighlight(h.id); }}
                                    title="Remove highlight"
                                    style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px' }}
                                  >
                                    <FaTimes size={12} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })()}
          </div>
        </aside>

        {/* ── Expandable Floating Action Buttons (bottom-right) ── */}
        {/* Hide the FAB entirely while the tutor panel is open — it has its own full UI */}
        {activeSidePanel !== 'tutor' && (
        <div
          className="course-fab-wrapper"
          onMouseEnter={() => setIsFabMenuOpen(true)}
          onMouseLeave={() => setIsFabMenuOpen(false)}
        >
          <div className={`course-fab-menu ${isFabMenuOpen ? 'open' : ''}`}>
            {/* Highlights panel button */}
            <button
              className={`course-fab-btn ${activeSidePanel === 'highlights' ? 'active' : ''}`}
              onClick={() => setActiveSidePanel(p => p === 'highlights' ? null : 'highlights')}
              title="Highlights"
            >
              <FaHighlighter size={16} />
              <span className="fab-tooltip">Highlights</span>
              {Object.values(highlights).flat().length > 0 && (
                <span className="fab-badge">{Object.values(highlights).flat().length}</span>
              )}
            </button>

            {/* Notes panel button */}
            <button
              className={`course-fab-btn ${activeSidePanel === 'notes' ? 'active' : ''}`}
              onClick={() => setActiveSidePanel(p => p === 'notes' ? null : 'notes')}
              title="My Notes"
            >
              <FaPen size={15} />
              <span className="fab-tooltip">Notes</span>
              {userNotes[currentChapterIdx] && (
                <span className="fab-badge">•</span>
              )}
            </button>

            {/* AI Tutor Sub-Button (when menu open) */}
            <button
              className={`course-fab-btn ${activeSidePanel === 'tutor' ? 'active' : ''}`}
              onClick={() => setActiveSidePanel(p => p === 'tutor' ? null : 'tutor')}
              title="Open AI Tutor"
            >
              <FaRobot size={15} />
              <span className="fab-tooltip">APOLLO</span>
            </button>
          </div>

          <button
            className={`course-fab-main ${isFabMenuOpen ? 'open' : ''}`}
            onClick={() => setIsFabMenuOpen(!isFabMenuOpen)}
          >
            {isFabMenuOpen ? <FaTimes size={20} /> : <FaBolt size={20} />}
            {!isFabMenuOpen && Object.values(highlights).flat().length > 0 && (
              <span className="fab-main-badge">{Object.values(highlights).flat().length}</span>
            )}
          </button>
        </div>
        )}
      </div>
    );
  }

  return (
    <div className="generate-quiz-page">
      <div className="generate-quiz-container">
        <div className="generate-quiz-header">
          <h1>Generate Quiz</h1>
          <p className="subtitle">Generate custom quizzes or summarize your study notes instantly</p>
        </div>

        <div className="tool-selector">
          <button
            type="button"
            className={activeTool === 'quiz' ? 'active' : ''}
            onClick={() => handleToolChange('quiz')}
            disabled={loading || summaryLoading}
          >
            Generate Quiz
          </button>
          {user?.limits?.noteSummary && (
            <button
              type="button"
              className={activeTool === 'summary' ? 'active' : ''}
              onClick={() => handleToolChange('summary')}
              disabled={loading || summaryLoading}
            >
              Note Summary
            </button>
          )}
        </div>

        {/* ── Session History (shown when summary tool is active, before upload form) ── */}
        {activeTool === 'summary' && !courseData && (
          <div className="session-history-section">
            <button
              className="session-history-toggle"
              onClick={() => setShowSessionHistory(o => !o)}
            >
              <FaHistory size={14} />
              <span>Recent Sessions ({sessionHistory.length})</span>
              {showSessionHistory ? <FaChevronUp size={12} /> : <FaChevronDown size={12} />}
            </button>
            {showSessionHistory && (
              <div className="session-history-list">
                {sessionHistoryLoading ? (
                  <div className="session-history-loading"><FaSpinner className="spin" /> Loading…</div>
                ) : sessionHistory.length === 0 ? (
                  <p className="session-history-empty">No previous sessions. Upload a file to get started!</p>
                ) : (
                  sessionHistory.map(sess => (
                    <div
                      key={sess._id}
                      className="session-history-item"
                      onClick={() => handleResumeSession(sess)}
                    >
                      <div className="session-item-info">
                        <span className="session-item-title">
                          {sess.title || sess.sourceFileName || 'Untitled'}
                          {sess.sessionType === 'course_outline' && (
                            <span className="session-type-badge outline">Outline</span>
                          )}
                        </span>
                        <span className="session-item-meta">
                          {sess.chapters?.length || 0} chapters · {new Date(sess.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="session-item-actions">
                        <span className={`session-item-status ${sess.status}`}>{sess.status}</span>
                        <button
                          type="button"
                          className="session-item-delete"
                          onClick={(e) => handleDeleteSession(sess._id, e)}
                          title="Delete session"
                        >
                          <FaTrash size={12} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Dedup Modal — file already summarized ── */}
        {dedupSession && (
          <div className="dedup-modal-overlay" onClick={() => setDedupSession(null)}>
            <div className="dedup-modal" onClick={e => e.stopPropagation()}>
              <h3>File Already Summarized</h3>
              <p>This file has been summarized before. Would you like to resume your previous session or generate a fresh summary?</p>
              <div className="dedup-modal-actions">
                <button className="dedup-btn resume" onClick={handleDedupResume}>
                  <FaHistory size={14} /> Resume Previous
                </button>
                <button className="dedup-btn regenerate" onClick={handleDedupRegenerate}>
                  <FaRedoAlt size={14} /> Generate New
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Proactive limit banner ── shown BEFORE user tries to submit */}
        {limitBlock?.blocked && activeTool === 'quiz' && (
          <div className="alert alert-limit" style={{
            background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
            border: '1px solid #94630e',
            borderLeft: '4px solid #94630e',
            borderRadius: '8px',
            padding: '1rem 1.2rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.8rem',
            marginBottom: '0'
          }}>
            <FaExclamationTriangle style={{ color: '#d97706', flexShrink: 0, marginTop: '2px' }} />
            <div style={{ flex: 1 }}>
              <strong style={{ color: '#92400e', display: 'block', marginBottom: '0.3rem' }}>
                {limitBlock.upgradeRequired ? 'Upgrade required' : 'Limit reached'}
              </strong>
              <span style={{ color: '#78350f', fontSize: '0.9rem' }}>{limitBlock.reason}</span>
              {limitBlock.upgradeRequired && (
                <button
                  onClick={() => navigate('/pricing')}
                  style={{
                    display: 'inline-block',
                    marginTop: '0.6rem',
                    padding: '6px 14px',
                    background: '#f59e0b',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '0.85rem'
                  }}
                >
                  Upgrade Plan →
                </button>
              )}
            </div>
          </div>
        )}

        {error && activeTool === 'quiz' && (
          <div className="alert alert-error">
            <FaExclamationTriangle /> {error}
          </div>
        )}

        {success && activeTool === 'quiz' && (
          <div className="alert alert-success">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <FaCheckCircle />
              <span style={{ flex: 1 }}>{success}</span>
              <button
                onClick={() => navigate(-1)}
                style={{
                  padding: '8px 16px',
                  background: '#fff',
                  color: '#10b981',
                  border: '2px solid #10b981',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  whiteSpace: 'nowrap'
                }}
              >
                Go to Dashboard →
              </button>
            </div>
          </div>
        )}

        {progress && (
          <div className="progress-indicator">
            <div className="progress-header">
              <FaSpinner className="spin" /> {progress}
              <span className="progress-percentage">{Math.round(progressPercent)}%</span>
            </div>
            <div className="progress-bar-container">
              <div
                className="progress-bar-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        <div className="input-method-selector">
          <div className="method-buttons">
            <button
              type="button"
              className={`method-btn ${inputMethod === 'file' ? 'active' : ''}`}
              onClick={() => setInputMethod('file')}
              disabled={loading || summaryLoading}
            >
              <FaUpload />
              <span>Upload File</span>
            </button>
            <button
              type="button"
              className={`method-btn ${inputMethod === 'text' ? 'active' : ''}`}
              onClick={() => setInputMethod('text')}
              disabled={loading || summaryLoading}
            >
              <FaFileAlt />
              <span>Paste Text</span>
            </button>
          </div>
        </div>

        <form onSubmit={activeTool === 'quiz' ? handleSubmit : handleSummarize} className="generate-form" noValidate autoComplete="off">

          {activeTool === 'quiz' && (
            <div className="form-row">
              <div className="form-group">
                <label>Topic/Subject *</label>
                <input
                  type="text"
                  value={formData.topic}
                  onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                  placeholder="e.g., Biology 101, World History"
                  required
                  disabled={loading}
                  pattern="[A-Za-z0-9 _,.'()\-]{3,80}"
                />
                <small>Use letters, numbers, spaces, and hyphens</small>
              </div>

              <div className="form-group">
                <label>Questions *</label>
                <div className="range-slider-container">
                  <input
                    type="range"
                    min="10"
                    max="200"
                    step="5"
                    value={formData.numberOfQuestions}
                    onChange={(e) => setFormData({ ...formData, numberOfQuestions: parseInt(e.target.value) || 10 })}
                    disabled={loading}
                  />
                  <div className="range-slider-value">{formData.numberOfQuestions}</div>
                </div>
                <small>Difficulty is set in your profile</small>
              </div>
            </div>
          )}

          {inputMethod === 'file' && (
            <div className="upload-area">
              <label htmlFor="file-input" className="file-upload-label">
                {formData.files.length > 0 ? (
                  <>
                    <FaCheckCircle size={40} />
                    {formData.files.length === 1 ? (
                      <>
                        <p>{formData.files[0].name}</p>
                        <span>{(formData.files[0].size / 1024 / 1024).toFixed(2)} MB</span>
                      </>
                    ) : (
                      <>
                        <p>{formData.files.length} files selected</p>
                        <ul style={{ listStyle: 'none', padding: 0, margin: '0.4rem 0 0', fontSize: '0.82rem', textAlign: 'left' }}>
                          {formData.files.map((f, i) => (
                            <li key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>• {f.name}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <FaUpload size={40} />
                    <p>Click to upload or drag and drop</p>
                    <span>
                      PDF, DOCX, TXT, JPG, PNG, PPTX (max {limits?.maxFileSizeMB ?? 50}MB)
                      {(limits?.filesPerUpload ?? 1) > 1 && ` · up to ${limits.filesPerUpload} files`}
                    </span>
                  </>
                )}
              </label>
              <input
                id="file-input"
                type="file"
                onChange={handleFileChange}
                accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp,.pptx,.ppt,.heic,.heif"
                multiple
                disabled={loading || summaryLoading}
                hidden
              />

              {preview && (
                <div className="image-preview">
                  <p>Preview:</p>
                  <img src={preview} alt="Preview" />
                </div>
              )}
            </div>
          )}

          {inputMethod === 'text' && (
            <div className="form-group">
              <label>Paste Your Notes *</label>
              <textarea
                value={formData.text}
                onChange={(e) => setFormData({ ...formData, text: e.target.value })}
                placeholder="Paste your study notes here..."
                rows="8"
                required
                disabled={loading || summaryLoading}
              />
              <div className="char-count">
                <span className={formData.text.length < (activeTool === 'quiz' ? 100 : 50) ? 'text-error' : 'text-success'}>
                  {formData.text.length} characters
                  {formData.text.length < (activeTool === 'quiz' ? 100 : 50) && ` (${(activeTool === 'quiz' ? 100 : 50) - formData.text.length} more needed)`}
                </span>
              </div>
            </div>
          )}

          {/* {summaryError && activeTool === 'summary' && (
            <div className="alert alert-error">
              <FaExclamationTriangle /> {summaryError}
            </div>
          )} */}

          <button
            type="submit"
            className="btn-generate"
            disabled={
              loading || summaryLoading || outlineParsing ||
              (activeTool === 'quiz' && !!limitBlock?.blocked) ||
              (activeTool === 'quiz' && !formData.topic.trim()) ||
              (activeTool === 'summary' && inputMethod === 'file' && formData.files.length === 0) ||
              (activeTool === 'summary' && inputMethod === 'text' && formData.text.trim().length < 50)
            }
            title={
              activeTool === 'quiz' && limitBlock?.blocked ? limitBlock.reason :
              activeTool === 'quiz' && !formData.topic.trim() ? 'Please enter a topic to generate a quiz' :
              activeTool === 'summary' && inputMethod === 'file' && formData.files.length === 0 ? 'Please select a file to summarize' :
              activeTool === 'summary' && inputMethod === 'text' && formData.text.trim().length < 50 ? 'Please enter at least 50 characters of text' :
              undefined
            }
            style={activeTool === 'quiz' && limitBlock?.blocked ? {
              opacity: 0.45,
              cursor: 'not-allowed',
              filter: 'grayscale(0.4)'
            } : {}}
          >
            {loading || summaryLoading || outlineParsing ? (
              <>
                <FaSpinner className="spin" />
                {outlineParsing ? 'Analyzing Content...' : activeTool === 'quiz' ? `Generating ${formData.numberOfQuestions} Questions...` : 'Summarizing Notes...'}
              </>
            ) : activeTool === 'quiz' && limitBlock?.blocked ? (
              <>
                <FaExclamationTriangle />
                {limitBlock.upgradeRequired ? 'Upgrade to Generate' : 'Limit Reached'}
              </>
            ) : (
              <>
                {activeTool === 'quiz' ? 'Generate Quiz' : 'Generate Summary'}
              </>
            )}
          </button>
        </form>

        {/* ── Outline Parsing Indicator ── */}
        {activeTool === 'summary' && outlineParsing && (
          <div className="outline-parsing-indicator">
            <FaSpinner className="spin" />
            <span>Analyzing your content…</span>
          </div>
        )}

        {/* ── Outline Detection Confirmation Panel ── */}
        {activeTool === 'summary' && outlineDetection && !courseData && (
          <div className="outline-detection-panel">
            {outlineConfirmNeeded && (
              <div className="outline-confirm-question">
                <FaQuestionCircle size={18} />
                <div>
                  <p className="outline-confirm-text">This looks like it might be a <strong>course outline</strong> ({outlineDetection.chapters?.length} chapters detected). Would you like to generate structured notes from it?</p>
                  <div className="outline-confirm-actions">
                    <button className="outline-confirm-btn yes" onClick={() => setOutlineConfirmNeeded(false)}>
                      Yes, generate notes
                    </button>
                    <button className="outline-confirm-btn no" onClick={() => { setOutlineDetection(null); setOutlineConfirmNeeded(false); handleRegularSummary(inputMethod === 'file' ? (formData.files.length > 1 ? formData.files : formData.files[0]) : formData.text.trim()); }}>
                      No, just summarize
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!outlineConfirmNeeded && (
              <div className="outline-setup-panel">
                <div className="outline-setup-header">
                  <FaBookOpen size={18} />
                  <h3>Course Outline Detected</h3>
                </div>
                <p className="outline-setup-summary">
                  {outlineDetection.chapters?.length} chapters · {outlineDetection.totalSubTopics || 0} sub-topics · Depth: <strong>{outlineDetection.depthTier || 'standard'}</strong>
                </p>

                {/* Depth tier warning for condensed */}
                {outlineDetection.depthTier === 'condensed' && (
                  <div className="outline-depth-warning">
                    <FaExclamationTriangle size={14} />
                    <span>Large outline detected ({outlineDetection.totalSubTopics}+ sub-topics). Content will be condensed to keep generation feasible.</span>
                  </div>
                )}

                {/* Course name input */}
                <div className="outline-course-name-field">
                  <label htmlFor="outline-course-name">Course Name</label>
                  <input
                    id="outline-course-name"
                    type="text"
                    value={outlineCourseNameInput}
                    onChange={(e) => setOutlineCourseNameInput(e.target.value)}
                    placeholder="e.g. Introduction to Psychology"
                    maxLength={120}
                  />
                </div>

                {/* Generate button */}
                <div className="outline-setup-actions">
                  <button
                    className="btn-generate outline-generate-btn"
                    disabled={summaryLoading || !outlineCourseNameInput.trim()}
                    onClick={() => {
                      handleOutlineGenerate();
                    }}
                  >
                    {summaryLoading ? (
                      <><FaSpinner className="spin" /> Generating Notes…</>
                    ) : (
                      <><FaBolt size={14} /> Generate Course Notes</>
                    )}
                  </button>
                  <button
                    className="outline-cancel-btn"
                    onClick={() => { setOutlineDetection(null); setOutlineCourseNameInput(''); }}
                    disabled={summaryLoading}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTool === 'summary' && summaryResult && !courseData && (
          <div className="summary-result" style={{ marginTop: '2rem', padding: '1.5rem', background: 'var(--background)', border: '1px solid var(--border-color)', borderRadius: '12px', boxShadow: 'var(--shadow-md)' }}>
            <h3 style={{ marginBottom: '1rem', fontSize: '1.2rem', color: 'var(--text-primary)' }}>Note Summary</h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>
              {summaryResult.content}
            </p>
          </div>
        )}

        {activeTool === 'quiz' && partialQuestions.length > 0 && (
          <div className="partial-results-preview" style={{ marginTop: '2rem', padding: '1.5rem', background: 'var(--background)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
            <h3 style={{ marginBottom: '1rem', fontSize: '1.2rem', color: 'var(--primary-color)', display: 'flex', alignItems: 'center' }}>
              <FaCheckCircle style={{ marginRight: '8px' }} />
              Drafting Questions... ({partialQuestions.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {partialQuestions.slice(-3).map((q, idx) => (
                <div key={idx} style={{ padding: '1rem', background: 'var(--background-light)', borderRadius: '8px', borderLeft: '4px solid var(--primary-color)' }}>
                  <p style={{ fontWeight: 600, margin: '0 0 0.8rem 0', color: 'var(--text-primary)' }}>{q.questionText}</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    {q.options?.map((opt, i) => (
                      <div key={i} style={{ padding: '0.4rem', background: 'var(--background)', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                        {String.fromCharCode(65 + i)}. {opt.replace(/^[A-Da-d][.):\s]\s*/,'')}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {partialQuestions.length > 3 && (
              <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-light)' }}>
                Showing the latest 3 of {partialQuestions.length} generated questions...
              </p>
            )}
          </div>
        )}

      </div >
    </div >
  );
}

export default GenerateQuiz;
