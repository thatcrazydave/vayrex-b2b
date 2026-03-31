/**
 * XSS Protection Middleware - COMPREHENSIVE SECURITY
 * 
 * Multi-layered XSS attack detection and prevention system:
 * 1. Content sanitization (remove/escape dangerous HTML)
 * 2. Pattern detection (identify XSS attack vectors)
 * 3. Attack logging (track and alert on suspicious activity)
 * 4. Auto-blocking (rate limit attackers)
 * 
 * Since we use pure tab isolation with sessionStorage tokens,
 * XSS protection is CRITICAL to prevent token theft.
 */

const validator = require('validator');
const Logger = require('../logger');
const { getRedisClient, isRedisReady } = require('../redisClient');
const { Timestamp } = require('firebase/firestore');
const { sanitize } = require('./sanitizer');

// ===== XSS ATTACK PATTERNS =====
// These patterns detect common XSS attack vectors
const XSS_PATTERNS = [
  // Script tags and event handlers (FIXED: simplified to avoid ReDoS)
  /<script\b[^>]*>/gi,
  /<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi, // onclick=, onload=, onerror=, etc.
  /<iframe/gi,
  /<embed/gi,
  /<object/gi,
  
  // Data URIs with scripts
  /data:text\/html/gi,
  /data:application\/javascript/gi,
  
  // Common XSS encodings
  /&#x/gi, // Hex encoding
  /&#\d/gi, // Decimal encoding
  /\\u[0-9a-f]{4}/gi, // Unicode escape
  
  // SVG-based XSS
  /<svg[\s\S]*?>/gi,
  
  // Import and meta tags
  /<meta/gi,
  /<link/gi,
  /@import/gi,
  
  // Expression attacks
  /expression\s*\(/gi,
  /vbscript:/gi,
  /livescript:/gi,
  
  // Base64 encoded scripts
  /base64.*script/gi,
  
  // HTML entities that can bypass filters
  /&lt;script/gi,
  /&lt;iframe/gi,
  
  // Mutation XSS (mXSS)
  /<\w+:\w+/gi, // XML namespaces
  
  // Server-side template injection patterns
  /\{\{.*\}\}/g, // {{ expression }}
  /\$\{.*\}/g,   // ${ expression }
  /<%.+%>/g,     // <% expression %>
  
  // Polyglot patterns (valid in multiple contexts)
  /-->\s*<script/gi,
  /<!--.*-->/g
];

// ===== DANGEROUS HTML TAGS =====
// These tags are stripped completely
const DANGEROUS_TAGS = [
  'script', 'iframe', 'embed', 'object', 'applet',
  'meta', 'link', 'style', 'base', 'form',
  'input', 'button', 'select', 'textarea', 'keygen'
];

// ===== DANGEROUS ATTRIBUTES =====
// These attributes are removed from all tags
const DANGEROUS_ATTRS = [
  'onclick', 'ondblclick', 'onmousedown', 'onmouseup', 'onmouseover',
  'onmousemove', 'onmouseout', 'onmouseenter', 'onmouseleave',
  'onload', 'onunload', 'onchange', 'onsubmit', 'onreset',
  'onselect', 'onblur', 'onfocus', 'onkeydown', 'onkeypress',
  'onkeyup', 'onabort', 'onerror', 'onresize', 'onscroll',
  'onseeked', 'onseeking', 'onstalled', 'onsuspend', 'ontimeupdate',
  'onvolumechange', 'onwaiting', 'onwheel', 'oncopy', 'oncut',
  'onpaste', 'onanimationstart', 'onanimationend', 'ontransitionend',
  'formaction', 'action', 'poster', 'background', 'lowsrc',
  'xmlns', 'xmlns:xlink'
];

// ===== XSS DETECTION =====
/**
 * Check if text contains XSS attack patterns
 * @param {string} text - Text to check
 * @returns {Object} - { isAttack: boolean, patterns: string[] }
 */
function detectXSS(text) {
  if (!text || typeof text !== 'string') {
    return { isAttack: false, patterns: [] };
  }

  const matchedPatterns = [];
  
  for (const pattern of XSS_PATTERNS) {
    if (pattern.test(text)) {
      matchedPatterns.push(pattern.source);
    }
  }

  return {
    isAttack: matchedPatterns.length > 0,
    patterns: matchedPatterns
  };
}

// ===== SANITIZATION =====
// Note: Core sanitization is handled by ./sanitizer.js
// This module focuses on XSS detection and IP blocking
// Sanitization is applied via the sanitizer middleware chain

// ===== ATTACK TRACKING =====
/**
 * Track XSS attack attempts from an IP
 * Auto-blocks after threshold
 * @param {string} ip - Attacker IP
 * @param {Array} patterns - Matched attack patterns
 * @returns {Promise<Object>} - { blocked: boolean, attempts: number }
 */
async function trackXSSAttack(ip, patterns) {
  try {
    if (!isRedisReady()) {
      Logger.warn('Redis not ready, XSS tracking skipped', {ip});
      return { blocked: false, attempts: 0 }; 
    }

    const client = getRedisClient();
    const Key = `xss:attack:${ip}`;
    const attempts = await client.incr(Key);

    // Set expiry for tracking key (e.g. 1 hour)
    if(attempts === 1) {
      await client.expire(Key, 3600);
    }
    Logger.warn('XSS attack detected', {
      ip,
      attempts,
      patterns: patterns.slice(0, 3),
      timestamp : new Date().toISOString()
    });

    if (attempts >= 5) {
      const blockKey = `xss:blocked:${ip}`;
      await client.setEx(blockKey, 86400, '1');

      Logger.error('IP blocked for XSS attacks', {
        ip,
        attempts,
        blockDuration: '24 hours'
      });

      return { blocked: true, attempts };
    }
    return { blocked: false, attempts };
  } catch (error) {
    Logger.error('Error tracking XSS attacks', {error: error.message});
    return { blocked: false, attempts: 0 };
  }
}

/**
 * Check if IP is blocked for XSS attacks
 * @param {string} ip - IP to check
 * @returns {Promise<boolean>} - True if blocked
 */
async function isIPBlocked(ip) {
  try {
    if (!isRedisReady()) {
      return false;
    }

    const redisClient = getRedisClient();
    const blockKey = `xss:blocked:${ip}`;
    const blocked = await redisClient.get(blockKey);
    return blocked === '1';
  } catch (error) {
    Logger.error('Error checking IP block status', {error: error.message});
    return false;
  }
}

// ===== MIDDLEWARE =====
/**
 * XSS Protection Middleware - Main entry point
 * Applies to all requests automatically
 */
const xssProtection = async (req, res, next) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;

    // Check if IP is blocked
    const blocked = await isIPBlocked(ip);
    if (blocked) {
      Logger.warn('Blocked IP attempted request', { ip, path: req.path });
      return res.status(403).json({
        success: false,
        error: {
          code: 'IP_BLOCKED',
          message: 'Your IP has been blocked due to suspicious activity. Please contact support if you believe this is an error.',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Detect XSS in request body (NO EXEMPTIONS - check all endpoints)
    if (req.body && Object.keys(req.body).length > 0) {
      const bodyString = JSON.stringify(req.body);
      const detection = detectXSS(bodyString);

      if (detection.isAttack) {
        // Track the attack
        const tracking = await trackXSSAttack(ip, detection.patterns);

        Logger.warn('XSS attack blocked', {
          ip,
          method: req.method,
          path: req.path,
          patterns: detection.patterns.slice(0, 3),
          attempts: tracking.attempts,
          blocked: tracking.blocked
        });

        return res.status(400).json({
          success: false,
          error: {
            code: 'XSS_DETECTED',
            message: 'Request contains potentially malicious content',
            timestamp: new Date().toISOString()
          }
        });
      }

      // Sanitization is handled by sanitizer.js middleware
      // XSS protection focuses on detection and blocking
    }

    // Detect XSS in query parameters
    if (req.query && Object.keys(req.query).length > 0) {
      const queryString = JSON.stringify(req.query);
      const detection = detectXSS(queryString);

      if (detection.isAttack) {
        const tracking = await trackXSSAttack(ip, detection.patterns);

        Logger.warn('XSS attack in query params blocked', {
          ip,
          path: req.path,
          patterns: detection.patterns.slice(0, 3)
        });

        return res.status(400).json({
          success: false,
          error: {
            code: 'XSS_DETECTED',
            message: 'Query parameters contain potentially malicious content',
            timestamp: new Date().toISOString()
          }
        });
      }

      // Sanitization is handled by sanitizer.js middleware
    }

    // Detect XSS in URL path
    const pathDetection = detectXSS(req.path);
    if (pathDetection.isAttack) {
      await trackXSSAttack(ip, pathDetection.patterns);
      
      Logger.warn('XSS attack in URL path blocked', {
        ip,
        path: req.path
      });

      return res.status(400).json({
        success: false,
        error: {
          code: 'XSS_DETECTED',
          message: 'URL contains potentially malicious content'
        }
      });
    }

    next();
  } catch (error) {
    Logger.error('XSS protection middleware error', {
      error: error.message,
      stack: error.stack
    });
    next();
  }
};

module.exports = {
  xssProtection,
  detectXSS,
  isIPBlocked,
  trackXSSAttack
};
