import { useState, useRef, useEffect, useCallback } from 'react';

// Languages whose output the browser can render live inside an iframe.
const LIVE_LANGUAGES = new Set(['html', 'css', 'javascript', 'js', 'jsx', 'svg']);

// ── Syntax highlighting ──────────────────────────────────────────────────────

function normalizeLang(lang) {
  if (!lang) return '';
  const l = lang.toLowerCase().trim();
  if (['js', 'jsx', 'javascript'].includes(l)) return 'js';
  if (['py', 'python'].includes(l)) return 'python';
  if (['sh', 'shell', 'bash', 'zsh'].includes(l)) return 'bash';
  if (['ts', 'typescript'].includes(l)) return 'ts';
  return l;
}

const KEYWORDS = {
  php: ['echo','print','if','else','elseif','foreach','for','while','do','switch','case','break','continue',
        'return','function','class','interface','abstract','extends','implements','new','null','true','false',
        'public','private','protected','static','final','namespace','use','require','include','require_once',
        'include_once','isset','empty','unset','array','list','try','catch','finally','throw','die','exit','match'],
  js:  ['const','let','var','function','return','if','else','for','while','do','switch','case','break',
        'continue','class','new','this','super','import','export','default','from','async','await',
        'try','catch','finally','throw','typeof','instanceof','in','of','null','undefined','true','false',
        'delete','void','yield','get','set','static','extends'],
  ts:  ['const','let','var','function','return','if','else','for','while','do','switch','case','break',
        'continue','class','new','this','super','import','export','default','from','async','await',
        'try','catch','finally','throw','typeof','instanceof','in','of','null','undefined','true','false',
        'delete','void','yield','interface','type','enum','declare','abstract','implements','extends',
        'readonly','as','is','keyof','namespace','module'],
  python: ['def','class','if','elif','else','for','while','return','import','from','as','with','try',
           'except','finally','raise','pass','break','continue','True','False','None','and','or','not',
           'in','is','lambda','yield','global','nonlocal','del','print','len','range','self'],
  java: ['public','private','protected','static','final','abstract','class','interface','extends',
         'implements','new','return','if','else','for','while','do','switch','case','break','continue',
         'try','catch','finally','throw','throws','import','package','void','int','long','double',
         'float','boolean','char','null','true','false','this','super','instanceof','String'],
  bash: ['if','then','else','elif','fi','for','while','do','done','case','esac','function','return',
         'exit','echo','printf','read','local','export','source','test','let','declare','readonly'],
  sql:  ['SELECT','FROM','WHERE','AND','OR','NOT','INSERT','INTO','VALUES','UPDATE','SET','DELETE',
         'CREATE','TABLE','DROP','ALTER','JOIN','LEFT','RIGHT','INNER','OUTER','ON','GROUP','BY',
         'ORDER','HAVING','LIMIT','OFFSET','DISTINCT','AS','COUNT','SUM','AVG','MIN','MAX',
         'INDEX','PRIMARY','KEY','FOREIGN','REFERENCES','NULL','TRUE','FALSE','CASE','WHEN','THEN','END'],
  css:  ['important'],
};

const TK = {
  keyword:  '#569cd6',
  string:   '#ce9178',
  comment:  '#6a9955',
  number:   '#b5cea8',
  phpvar:   '#9cdcfe',
  tag:      '#4ec9b0',
  attr:     '#9cdcfe',
  punct:    '#cdd6f4',
};

// Tokenise code into [{type, value}] tokens.
function tokenize(code, rawLang) {
  const lang = normalizeLang(rawLang);
  const kwSet = new Set(KEYWORDS[lang] || []);
  const tokens = [];
  let i = 0;
  const n = code.length;

  const pushPlain = (text) => {
    if (!text) return;
    // Split around keywords for languages that need it
    if (kwSet.size === 0) { tokens.push({ type: 'text', value: text }); return; }
    const isSql = lang === 'sql';
    const kwArr = [...kwSet];
    const kwRe = new RegExp(`\\b(${kwArr.map(k => k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})\\b`, isSql ? 'gi' : 'g');
    let last = 0, m;
    while ((m = kwRe.exec(text)) !== null) {
      if (m.index > last) tokens.push({ type: 'text', value: text.slice(last, m.index) });
      tokens.push({ type: 'keyword', value: isSql ? m[0].toUpperCase() : m[0] });
      last = m.index + m[0].length;
    }
    if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) });
  };

  while (i < n) {
    const ch = code[i];
    const ch2 = code[i + 1];

    // Single-line comments
    if ((lang === 'js' || lang === 'ts' || lang === 'php' || lang === 'java') && ch === '/' && ch2 === '/') {
      const end = code.indexOf('\n', i); const e = end === -1 ? n : end;
      tokens.push({ type: 'comment', value: code.slice(i, e) }); i = e; continue;
    }
    if ((lang === 'python' || lang === 'bash') && ch === '#') {
      const end = code.indexOf('\n', i); const e = end === -1 ? n : end;
      tokens.push({ type: 'comment', value: code.slice(i, e) }); i = e; continue;
    }
    if (lang === 'sql' && ch === '-' && ch2 === '-') {
      const end = code.indexOf('\n', i); const e = end === -1 ? n : end;
      tokens.push({ type: 'comment', value: code.slice(i, e) }); i = e; continue;
    }
    // Block comments
    if ((lang === 'js' || lang === 'ts' || lang === 'php' || lang === 'java' || lang === 'css') && ch === '/' && ch2 === '*') {
      const end = code.indexOf('*/', i + 2); const e = end === -1 ? n : end + 2;
      tokens.push({ type: 'comment', value: code.slice(i, e) }); i = e; continue;
    }
    // PHP docblock / HTML comment
    if (lang === 'html' && ch === '<' && code.slice(i, i + 4) === '<!--') {
      const end = code.indexOf('-->', i + 4); const e = end === -1 ? n : end + 3;
      tokens.push({ type: 'comment', value: code.slice(i, e) }); i = e; continue;
    }
    // Double-quoted string
    if (ch === '"') {
      let j = i + 1;
      while (j < n && code[j] !== '"') { if (code[j] === '\\') j++; j++; }
      j = Math.min(j + 1, n);
      tokens.push({ type: 'string', value: code.slice(i, j) }); i = j; continue;
    }
    // Single-quoted string
    if (ch === "'") {
      let j = i + 1;
      while (j < n && code[j] !== "'") { if (code[j] === '\\') j++; j++; }
      j = Math.min(j + 1, n);
      tokens.push({ type: 'string', value: code.slice(i, j) }); i = j; continue;
    }
    // Template literal
    if (ch === '`') {
      let j = i + 1;
      while (j < n && code[j] !== '`') { if (code[j] === '\\') j++; j++; }
      j = Math.min(j + 1, n);
      tokens.push({ type: 'string', value: code.slice(i, j) }); i = j; continue;
    }
    // Python triple-quoted strings
    if (lang === 'python' && (code.slice(i, i + 3) === '"""' || code.slice(i, i + 3) === "'''")) {
      const delim = code.slice(i, i + 3);
      const end = code.indexOf(delim, i + 3); const e = end === -1 ? n : end + 3;
      tokens.push({ type: 'string', value: code.slice(i, e) }); i = e; continue;
    }
    // PHP variable
    if (lang === 'php' && ch === '$') {
      let j = i + 1;
      while (j < n && /\w/.test(code[j])) j++;
      tokens.push({ type: 'phpvar', value: code.slice(i, j) }); i = j; continue;
    }
    // HTML / SVG / JSX tags
    if ((lang === 'html' || lang === 'svg') && ch === '<') {
      let j = i + 1;
      while (j < n && code[j] !== '>') j++;
      j = Math.min(j + 1, n);
      tokens.push({ type: 'tag', value: code.slice(i, j) }); i = j; continue;
    }
    // Number (not inside a word)
    if (/\d/.test(ch) && (i === 0 || !/\w/.test(code[i - 1]))) {
      let j = i;
      while (j < n && /[\d.xXa-fA-F]/.test(code[j])) j++;
      tokens.push({ type: 'number', value: code.slice(i, j) }); i = j; continue;
    }
    // Plain text — collect until the next special character
    let j = i;
    while (j < n) {
      const c = code[j];
      if (c === '"' || c === "'" || c === '`') break;
      if (lang === 'php' && c === '$') break;
      if ((lang === 'html' || lang === 'svg') && c === '<') break;
      if ((lang === 'js' || lang === 'ts' || lang === 'php' || lang === 'java' || lang === 'css') && c === '/' && (code[j+1] === '/' || code[j+1] === '*')) break;
      if ((lang === 'python' || lang === 'bash') && c === '#') break;
      if (lang === 'sql' && c === '-' && code[j+1] === '-') break;
      if (lang === 'html' && c === '<' && code.slice(j, j+4) === '<!--') break;
      if (/\d/.test(c) && (j === 0 || !/\w/.test(code[j-1]))) break;
      j++;
    }
    if (j > i) { pushPlain(code.slice(i, j)); i = j; } else { pushPlain(ch); i++; }
  }

  return tokens;
}

function HighlightedCode({ code, lang }) {
  const tokens = tokenize(code, lang);
  return (
    <>
      {tokens.map((tok, idx) => {
        const color = TK[tok.type];
        return color
          ? <span key={idx} style={{ color }}>{tok.value}</span>
          : tok.value;
      })}
    </>
  );
}

function LineNumbers({ code }) {
  const count = (code.match(/\n/g) || []).length + 1;
  return (
    <div className="lce-line-numbers" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i}>{i + 1}</span>
      ))}
    </div>
  );
}

/**
 * Returns a full HTML document string suitable for use as iframe srcdoc,
 * wrapping the code for the given language.
 */
function buildSrcdoc(code, language) {
  switch (language) {
    case 'html':
      // Return as-is — trust the user's markup
      return code;
    case 'css':
      return `<!DOCTYPE html><html><head><style>
body { font-family: sans-serif; padding: 12px; }
${code}
</style></head><body>
<p style="color:#aaa;font-size:11px;margin:0 0 8px">
  CSS preview — add HTML elements below to see styles applied.
</p>
<div id="preview-root"></div>
</body></html>`;
    case 'javascript':
    case 'js':
    case 'jsx':
      return `<!DOCTYPE html><html><body>
<div id="root"></div>
<pre id="output" style="font-family:monospace;font-size:13px;padding:8px;background:#f8f8f8;border-radius:4px;white-space:pre-wrap;word-break:break-word"></pre>
<script>
// Intercept console.log output into the #output element
const _out = document.getElementById('output');
const _orig = console.log.bind(console);
console.log = function(...args) {
  _orig(...args);
  _out.textContent += args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ') + '\\n';
};
try {
${code}
} catch(e) {
  _out.textContent += '\\u274c Error: ' + e.message;
}
</script>
</body></html>`;
    case 'svg':
      return `<!DOCTYPE html><html><body style="margin:0;background:#fff">${code}</body></html>`;
    default:
      return code;
  }
}

/**
 * LiveCodeEditor
 *
 * Props:
 *   code     — initial code string
 *   language — fenced-block language tag, e.g. 'html', 'python'
 *
 * For browser-renderable languages (html/css/js/jsx/svg) shows a side-by-side
 * editable textarea + live iframe preview.
 *
 * For all other languages (Python, SQL, bash, Java…) shows a styled
 * read-only block with a copy button.
 */
export default function LiveCodeEditor({ code = '', language = '' }) {
  const lang = (language || '').toLowerCase().trim();
  const isLive = LIVE_LANGUAGES.has(lang);

  const [editedCode, setEditedCode] = useState(code);
  const [copied, setCopied] = useState(false);
  // Tab state: 'editor' | 'preview' — only relevant for live blocks
  const [activeTab, setActiveTab] = useState('editor');

  const iframeRef = useRef(null);
  const textareaRef = useRef(null);
  const pendingCursorRef = useRef(null);

  // Update iframe whenever code or active tab changes
  useEffect(() => {
    if (!isLive || !iframeRef.current) return;
    // Only update if preview tab is visible (avoids unnecessary render)
    const timer = setTimeout(() => {
      if (iframeRef.current) {
        iframeRef.current.srcdoc = buildSrcdoc(editedCode, lang);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [editedCode, isLive, lang, activeTab]);

  // Restore cursor after Tab-key insertion
  useEffect(() => {
    if (pendingCursorRef.current !== null && textareaRef.current) {
      const pos = pendingCursorRef.current;
      textareaRef.current.selectionStart = pos;
      textareaRef.current.selectionEnd = pos;
      pendingCursorRef.current = null;
    }
  });

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = editedCode.substring(0, start) + '  ' + editedCode.substring(end);
      pendingCursorRef.current = start + 2;
      setEditedCode(next);
    }
  }, [editedCode]);

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(editedCode)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  }, [editedCode]);

  // ── Read-only block (Python, SQL, bash, Java, PHP…) ──────────────────────
  if (!isLive) {
    return (
      <div className="lce-block lce-readonly">
        <div className="lce-header">
          <span className="lce-lang-badge">{lang || 'code'}</span>
          <button className="lce-copy-btn" onClick={handleCopy} type="button">
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <div className="lce-code-body">
          <LineNumbers code={editedCode} />
          <pre className="lce-pre"><code><HighlightedCode code={editedCode} lang={lang} /></code></pre>
        </div>
      </div>
    );
  }

  // ── Live editor + preview (tab-based) ────────────────────────────────────
  return (
    <div className="lce-block lce-live">
      <div className="lce-header">
        <span className="lce-lang-badge">{lang}</span>
        <span className="lce-live-badge">Live</span>
        <div className="lce-tab-bar">
          <button
            className={`lce-tab-btn ${activeTab === 'editor' ? 'active' : ''}`}
            onClick={() => setActiveTab('editor')}
            type="button"
          >Editor</button>
          <button
            className={`lce-tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
            onClick={() => setActiveTab('preview')}
            type="button"
          >Preview</button>
        </div>
        <button className="lce-copy-btn" onClick={handleCopy} type="button">
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      {/* Editor tab */}
      <div className="lce-tab-content" style={{ display: activeTab === 'editor' ? 'flex' : 'none' }}>
        <div className="lce-editor-inner">
          <LineNumbers code={editedCode} />
          <textarea
            ref={textareaRef}
            className="lce-textarea"
            value={editedCode}
            onChange={e => setEditedCode(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
          />
        </div>
      </div>

      {/* Preview tab */}
      <div className="lce-tab-content" style={{ display: activeTab === 'preview' ? 'flex' : 'none' }}>
        <iframe
          ref={iframeRef}
          className="lce-iframe"
          sandbox="allow-scripts"
          title={`${lang} live preview`}
          srcDoc={buildSrcdoc(editedCode, lang)}
        />
      </div>
    </div>
  );
}
