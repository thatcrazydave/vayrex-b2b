/**
 * =====================================================================
 * RESPONSE HARDENING MIDDLEWARE
 * =====================================================================
 * 
 * Minimizes information leakage in HTTP responses to make HAR files,
 * browser Network tabs, and proxy captures as useless as possible
 * for attackers performing reconnaissance.
 * 
 * Covers:
 *  - Strip internal error details from all responses
 *  - Remove identifying headers (Server, ETag on API routes)
 *  - Add Cache-Control: no-store on all API routes
 *  - Normalize auth response timing (prevent user enumeration)
 *  - Suppress field names in validation errors (production)
 *  - Strip timestamps from error responses (production)
 * =====================================================================
 */

const Logger = require('../logger');
const crypto = require('crypto');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ========== 12 CANONICAL ERROR CODES ==========
// All error responses in production are mapped to one of these.
// Internal codes like MONGOOSE_CAST_ERROR, JWT_MALFORMED etc. never leak out.

const CANONICAL_CODES = new Set([
  'INVALID_REQUEST',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'VALIDATION_ERROR',
  'SERVER_ERROR',
  'SERVICE_UNAVAILABLE',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'TIMEOUT',
  'QUOTA_EXCEEDED',
]);

// Map internal codes to canonical codes
const CODE_MAP = {
  // Auth-related
  'INVALID_CREDENTIALS': 'AUTH_REQUIRED',
  'INVALID_TOKEN': 'AUTH_REQUIRED',
  'TOKEN_EXPIRED': 'AUTH_REQUIRED',
  'TOKEN_REVOKED': 'AUTH_REQUIRED',
  'NO_TOKEN': 'AUTH_REQUIRED',
  'INVALID_REFRESH_TOKEN': 'AUTH_REQUIRED',
  'NO_REFRESH_TOKEN': 'AUTH_REQUIRED',
  'JWT_MALFORMED': 'AUTH_REQUIRED',
  'MISSING_CREDENTIALS': 'AUTH_REQUIRED',
  'MISSING_FIREBASE_TOKEN': 'AUTH_REQUIRED',
  'INVALID_FIREBASE_TOKEN': 'AUTH_REQUIRED',
  'EMPTY_TOKEN': 'AUTH_REQUIRED',
  'INVALID_TOKEN_TYPE': 'AUTH_REQUIRED',
  'INVALID_TOKEN_LENGTH': 'AUTH_REQUIRED',
  'NOT_AUTHENTICATED': 'AUTH_REQUIRED',

  // Forbidden
  'UNAUTHORIZED_ACCESS': 'FORBIDDEN',
  'ACCOUNT_DEACTIVATED': 'FORBIDDEN',
  'ADMIN_REQUIRED': 'FORBIDDEN',
  'SUPERADMIN_REQUIRED': 'FORBIDDEN',
  'ACCOUNT_LOCKED': 'FORBIDDEN',
  'SUBSCRIPTION_EXPIRED': 'FORBIDDEN',
  'FILE_COUNT_EXCEEDED': 'FORBIDDEN',
  'USER_INACTIVE': 'FORBIDDEN',

  // Validation
  'WEAK_PASSWORD': 'VALIDATION_ERROR',
  'INVALID_PASSWORD': 'VALIDATION_ERROR',
  'PASSWORD_MISMATCH': 'VALIDATION_ERROR',
  'INVALID_USERNAME': 'VALIDATION_ERROR',
  'INVALID_EMAIL': 'VALIDATION_ERROR',
  'INVALID_TOPIC': 'VALIDATION_ERROR',
  'INVALID_DIFFICULTY': 'VALIDATION_ERROR',
  'INVALID_QUESTION_COUNT': 'VALIDATION_ERROR',
  'INVALID_TIER': 'VALIDATION_ERROR',
  'INVALID_BILLING': 'VALIDATION_ERROR',
  'INVALID_INPUT': 'VALIDATION_ERROR',
  'MISSING_FIELDS': 'VALIDATION_ERROR',
  'INVALID_OTP': 'VALIDATION_ERROR',
  'INVALID_USER_ID': 'VALIDATION_ERROR',
  'INVALID_RESULT_ID': 'VALIDATION_ERROR',
  'INVALID_JOB_ID': 'VALIDATION_ERROR',
  'INVALID_QUERY': 'VALIDATION_ERROR',
  'INVALID_URL_PARAMETER': 'VALIDATION_ERROR',

  // Conflict
  'USER_EXISTS': 'CONFLICT',
  'EMAIL_ALREADY_USED': 'CONFLICT',
  'USERNAME_ALREADY_USED': 'CONFLICT',
  'DUPLICATE_ERROR': 'CONFLICT',

  // Not found
  'USER_NOT_FOUND': 'NOT_FOUND',
  'FILE_NOT_FOUND': 'NOT_FOUND',
  'RESULT_NOT_FOUND': 'NOT_FOUND',
  'JOB_NOT_FOUND': 'NOT_FOUND',
  'SESSION_NOT_FOUND': 'NOT_FOUND',
  'THREAD_NOT_FOUND': 'NOT_FOUND',
  'NO_QUESTIONS_FOUND': 'NOT_FOUND',

  // Quota
  'UPLOAD_LIMIT_REACHED': 'QUOTA_EXCEEDED',
  'STORAGE_LIMIT_REACHED': 'QUOTA_EXCEEDED',
  'TOKEN_LIMIT_EXCEEDED': 'QUOTA_EXCEEDED',
  'USER_JOB_LIMIT': 'QUOTA_EXCEEDED',
  'QUEUE_OVERLOADED': 'QUOTA_EXCEEDED',

  // Rate limiting
  'RATE_LIMIT_EXCEEDED': 'RATE_LIMITED',
  'RATE_LIMIT_BLOCKED': 'RATE_LIMITED',
  'TOO_MANY_STREAMS': 'RATE_LIMITED',

  // Server errors
  'INTERNAL_ERROR': 'SERVER_ERROR',
  'SERVER_ERROR': 'SERVER_ERROR',
  'PROCESSING_ERROR': 'SERVER_ERROR',
  'GRADING_ERROR': 'SERVER_ERROR',
  'AI_CHAT_ERROR': 'SERVER_ERROR',
  'CACHE_STATS_ERROR': 'SERVER_ERROR',
  'CACHE_CLEAR_ERROR': 'SERVER_ERROR',
  'URL_GENERATION_FAILED': 'SERVER_ERROR',
  'QUEUE_ERROR': 'SERVER_ERROR',
  'VERIFICATION_FAILED': 'SERVER_ERROR',
  'OTP_SEND_FAILED': 'SERVER_ERROR',
  'REFRESH_ERROR': 'SERVER_ERROR',

  // Service unavailable
  'RATE_LIMITER_ERROR': 'SERVICE_UNAVAILABLE',
  'PAYMENT_UNAVAILABLE': 'SERVICE_UNAVAILABLE',

  // Payload
  'FILE_TOO_LARGE': 'PAYLOAD_TOO_LARGE',

  // Timeout
  'REQUEST_TIMEOUT': 'TIMEOUT',
};

// ========== MIDDLEWARE 1: Strip Response Headers ==========

function stripHeaders(req, res, next) {
  // Remove Server header
  res.removeHeader('Server');
  res.removeHeader('X-Powered-By'); // Belt + suspenders (Helmet already does this)

  const path = (req.path || '').toLowerCase();

  // On all /api/* routes:
  if (path.startsWith('/api/')) {
    // Remove ETag (prevents cache-timing attacks)
    res.removeHeader('ETag');

    // Force no caching on API routes
    res.setHeader('Cache-Control', 'no-store, no-cache, private, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }

  next();
}

// ========== MIDDLEWARE 2: Intercept & Harden JSON Responses ==========

function hardenResponses(req, res, next) {
  // Only apply in production
  if (!IS_PRODUCTION) return next();

  // Store original json method
  const originalJson = res.json.bind(res);

  res.json = function(body) {
    // Only harden error responses (4xx, 5xx)
    if (res.statusCode >= 400 && body && typeof body === 'object') {
      const hardened = hardenErrorBody(body);
      return originalJson(hardened);
    }
    return originalJson(body);
  };

  next();
}

function hardenErrorBody(body) {
  // Deep clone to avoid mutating original
  const result = { success: false };

  if (body.error) {
    const error = typeof body.error === 'string'
      ? { code: 'SERVER_ERROR', message: body.error }
      : { ...body.error };

    // Map internal code to canonical code
    const originalCode = error.code || 'SERVER_ERROR';
    error.code = CODE_MAP[originalCode] || (CANONICAL_CODES.has(originalCode) ? originalCode : 'SERVER_ERROR');

    // Strip internal details
    delete error.stack;
    delete error.details;  // Hides field-specific validation messages
    delete error.query;
    delete error.mongoError;
    delete error.field;    // Hides which field caused conflict

    // Strip timestamp (prevents retry-window mapping)
    delete error.timestamp;

    // Generic validation message (no field names)
    if (error.code === 'VALIDATION_ERROR') {
      error.message = 'One or more fields are invalid';
    }

    // Generic conflict message (no field names)
    if (error.code === 'CONFLICT') {
      error.message = 'Account already registered';
    }

    // Generic auth message (no specifics about what failed)
    if (error.code === 'AUTH_REQUIRED') {
      error.message = 'Authentication required';
    }

    result.error = {
      code: error.code,
      message: error.message || 'Request failed'
    };
  } else if (body.message && !body.success) {
    // Some legacy error formats
    result.error = {
      code: 'SERVER_ERROR',
      message: 'Request failed'
    };
  }

  return result;
}

// ========== MIDDLEWARE 3: Auth Timing Normalization ==========

// Ensures /login and /forgot-password always take the same amount of time,
// preventing timing-based user enumeration.

const AUTH_TIMING_ROUTES = [
  '/api/auth/login',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/signup',
];

const MIN_AUTH_RESPONSE_MS = Number(process.env.AUTH_MIN_RESPONSE_MS) || 300;

function normalizeAuthTiming(req, res, next) {
  const path = (req.path || '').toLowerCase().replace(/\/+$/, '');
  const isAuthTimingRoute = AUTH_TIMING_ROUTES.some(r => path.startsWith(r));

  if (!isAuthTimingRoute) return next();

  const startTime = Date.now();

  // Override res.json to add delay
  const originalJson = res.json.bind(res);
  res.json = function(body) {
    const elapsed = Date.now() - startTime;
    const delay = Math.max(0, MIN_AUTH_RESPONSE_MS - elapsed);

    if (delay > 0) {
      setTimeout(() => originalJson(body), delay);
    } else {
      originalJson(body);
    }
  };

  next();
}

// ========== COMBINED EXPORT ==========

/**
 * Apply all response hardening middleware.
 * Usage: app.use(responseHardening());
 */
function responseHardening() {
  return (req, res, next) => {
    // Layer 1: Strip identifying headers
    stripHeaders(req, res, () => {
      // Layer 2: Normalize auth timing
      normalizeAuthTiming(req, res, () => {
        // Layer 3: Harden error response bodies (production only)
        hardenResponses(req, res, next);
      });
    });
  };
}

module.exports = {
  responseHardening,
  stripHeaders,
  hardenResponses,
  normalizeAuthTiming,
  hardenErrorBody,
  CANONICAL_CODES,
  CODE_MAP,
};
