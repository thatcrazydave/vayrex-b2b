/**
 * Frontend XSS Sanitizer using DOMPurify
 * 
 * CRITICAL: Since we use pure tab isolation with sessionStorage tokens,
 * XSS protection is ESSENTIAL to prevent token theft via script injection.
 * 
 * This utility provides comprehensive XSS sanitization for all user-generated
 * content before rendering in the UI.
 */

import DOMPurify from 'dompurify';

// ===== STRICT CONFIGURATION =====
// This config removes ALL executable code while preserving basic formatting
const STRICT_CONFIG = {
  ALLOWED_TAGS: [
    'b', 'i', 'em', 'strong', 'u', 'p', 'br', 'span', 'div',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'a', 'pre', 'code', 'blockquote'
  ],
  ALLOWED_ATTR: ['href', 'title', 'class', 'id'],
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  SAFE_FOR_TEMPLATES: true,
  WHOLE_DOCUMENT: false,
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
  RETURN_DOM_IMPORT: false,
  FORCE_BODY: true,
  SANITIZE_DOM: true,
  KEEP_CONTENT: true,
  // Remove all event handlers
  FORBID_ATTR: [
    'onclick', 'ondblclick', 'onmousedown', 'onmouseup', 'onmouseover',
    'onmousemove', 'onmouseout', 'onmouseenter', 'onmouseleave',
    'onload', 'onunload', 'onchange', 'onsubmit', 'onreset',
    'onselect', 'onblur', 'onfocus', 'onkeydown', 'onkeypress',
    'onkeyup', 'onerror', 'onabort', 'onresize', 'onscroll',
    'style', 'xmlns', 'formaction', 'action', 'poster', 'background'
  ],
  // Forbid dangerous tags
  FORBID_TAGS: [
    'script', 'iframe', 'embed', 'object', 'applet', 'meta', 'link',
    'style', 'base', 'form', 'input', 'button', 'select', 'textarea',
    'svg', 'math', 'xml', 'xsl'
  ]
};

// ===== PLAIN TEXT CONFIGURATION =====
// Strips ALL HTML tags, leaving only plain text
const PLAIN_TEXT_CONFIG = {
  ALLOWED_TAGS: [],
  ALLOWED_ATTR: [],
  KEEP_CONTENT: true,
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false
};

/**
 * Sanitize HTML content with strict rules
 * Allows basic formatting but removes all executable code
 * 
 * @param {string} dirtyHtml - Unsanitized HTML content
 * @returns {string} - Sanitized HTML safe for rendering
 * 
 * @example
 * const userInput = '<script>alert("XSS")</script><p>Hello</p>';
 * const safe = sanitizeHtml(userInput); // Returns: '<p>Hello</p>'
 */
export function sanitizeHtml(dirtyHtml) {
  if (!dirtyHtml || typeof dirtyHtml !== 'string') {
    return '';
  }

  return DOMPurify.sanitize(dirtyHtml, STRICT_CONFIG);
}

/**
 * Sanitize to plain text only (strip ALL HTML)
 * Use for text that should never contain any formatting
 * 
 * @param {string} input - Unsanitized input
 * @returns {string} - Plain text only
 * 
 * @example
 * const userInput = '<b>Bold</b> text';
 * const safe = sanitizeText(userInput); // Returns: 'Bold text'
 */
export function sanitizeText(input) {
  if (!input || typeof input !== 'string') {
    return '';
  }

  return DOMPurify.sanitize(input, PLAIN_TEXT_CONFIG);
}

/**
 * Sanitize URL to prevent javascript: protocol XSS
 * Only allows http, https, and mailto protocols
 * 
 * @param {string} url - URL to sanitize
 * @returns {string} - Safe URL or empty string if dangerous
 * 
 * @example
 * sanitizeUrl('javascript:alert(1)'); // Returns: ''
 * sanitizeUrl('https://example.com'); // Returns: 'https://example.com'
 */
export function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') {
    return '';
  }

  // Remove whitespace and control characters
  // eslint-disable-next-line no-control-regex
const cleaned = url.trim().replace(/[\u0000-\u001F\u007F]/g, '');

  // Check for dangerous protocols
  const dangerousProtocols = [
    'javascript:', 'data:', 'vbscript:', 'file:', 'about:',
    'livescript:', 'mocha:', 'feed:', 'jar:'
  ];

  const lowerUrl = cleaned.toLowerCase();
  for (const protocol of dangerousProtocols) {
    if (lowerUrl.includes(protocol)) {
      console.warn('[XSS] Dangerous URL blocked:', url);
      return '';
    }
  }

  // Only allow http, https, mailto
  if (!/^(https?|mailto):/.test(lowerUrl) && !/^\//.test(cleaned)) {
    console.warn('[XSS] Invalid protocol in URL:', url);
    return '';
  }

  return cleaned;
}

/**
 * Sanitize object properties recursively
 * Useful for sanitizing entire API responses or form data
 * 
 * @param {any} obj - Object to sanitize
 * @param {number} depth - Current recursion depth
 * @returns {any} - Sanitized object
 */
export function sanitizeObject(obj, depth = 0) {
  // Prevent infinite recursion
  if (depth > 10) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizeText(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, depth + 1));
  }

  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      // Sanitize keys too
      const safeKey = sanitizeText(key);
      sanitized[safeKey] = sanitizeObject(value, depth + 1);
    }
    return sanitized;
  }

  return obj;
}

/**
 * Detect potential XSS patterns in text
 * Use for logging/monitoring suspicious input
 * 
 * @param {string} text - Text to check
 * @returns {boolean} - True if suspicious patterns detected
 */
export function detectXSS(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  const xssPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i, // Event handlers
    /<iframe/i,
    /<embed/i,
    /<object/i,
    /data:text\/html/i,
    /&#x/i, // Hex encoding
    /\\u[0-9a-f]{4}/i, // Unicode
    /<svg/i,
    /expression\s*\(/i,
    /vbscript:/i,
    /\{\{.*\}\}/, // Template injection
    /\$\{.*\}/ // Template literal injection
  ];

  for (const pattern of xssPatterns) {
    if (pattern.test(text)) {
      console.warn('[XSS] Suspicious pattern detected:', pattern.source);
      return true;
    }
  }

  return false;
}

/**
 * Sanitize and validate form input
 * Combines XSS detection with sanitization
 * 
 * @param {string} input - Form input value
 * @param {Object} options - Validation options
 * @returns {Object} - { valid: boolean, sanitized: string, error: string }
 */
export function sanitizeFormInput(input, options = {}) {
  const {
    maxLength = 10000,
    allowHtml = false,
    required = false
  } = options;

  // Check required
  if (required && (!input || input.trim().length === 0)) {
    return {
      valid: false,
      sanitized: '',
      error: 'This field is required'
    };
  }

  if (!input) {
    return { valid: true, sanitized: '', error: null };
  }

  // Check length
  if (input.length > maxLength) {
    return {
      valid: false,
      sanitized: input.substring(0, maxLength),
      error: `Input exceeds maximum length of ${maxLength} characters`
    };
  }

  // Detect XSS attempts
  if (detectXSS(input)) {
    console.warn('[XSS] Attack attempt blocked in form input');
    return {
      valid: false,
      sanitized: sanitizeText(input),
      error: 'Input contains invalid characters'
    };
  }

  // Sanitize based on allowHtml flag
  const sanitized = allowHtml ? sanitizeHtml(input) : sanitizeText(input);

  return {
    valid: true,
    sanitized,
    error: null
  };
}

/**
 * Create a safe React component for rendering user content
 * Use this to safely render HTML from users
 * 
 * @param {string} html - HTML to render
 * @returns {Object} - Props for dangerouslySetInnerHTML
 * 
 * @example
 * <div {...createSafeHtml(userGeneratedHtml)} />
 */
export function createSafeHtml(html) {
  return {
    dangerouslySetInnerHTML: {
      __html: sanitizeHtml(html)
    }
  };
}

// Export DOMPurify instance for advanced usage
export { DOMPurify };

export default {
  sanitizeHtml,
  sanitizeText,
  sanitizeUrl,
  sanitizeObject,
  sanitizeFormInput,
  detectXSS,
  createSafeHtml,
  DOMPurify
};
