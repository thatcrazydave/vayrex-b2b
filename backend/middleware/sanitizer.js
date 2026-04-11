const Logger = require('../logger');

const VALIDATE_ONLY_FIELDS = new Set([
  'text',
  'content',
  'extractedText',
  'message',
  'answers',
  'answer',
  'explanation',
  'questionText',
  'options',
  'body',
  'description',
  'notes',
  'rawContent'
]);

// ===== COMPREHENSIVE NOSQL OPERATOR BLACKLIST =====
const NOSQL_OPERATORS = new Set([
  // Comparison
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin',
  // Logical
  '$and', '$or', '$not', '$nor',
  // Element
  '$exists', '$type',
  // Evaluation
  '$expr', '$jsonSchema', '$mod', '$regex', '$text', '$where',
  // Array
  '$all', '$elemMatch', '$size',
  // Update
  '$set', '$unset', '$inc', '$mul', '$rename', '$setOnInsert',
  '$push', '$pull', '$addToSet', '$pop', '$pullAll',
  // Aggregation
  '$match', '$group', '$project', '$sort', '$limit', '$skip',
  '$lookup', '$unwind', '$out', '$merge', '$replaceRoot',
  // Bitwise
  '$bit', '$bitsAllClear', '$bitsAllSet', '$bitsAnyClear', '$bitsAnySet',
  // Geospatial
  '$geoWithin', '$geoIntersects', '$near', '$nearSphere',
  // Meta
  '$comment', '$meta', '$slice', '$natural',
  // Other dangerous
  '$ref', '$id', '$db', '$currentDate', '$min', '$max',
  '$each', '$position', '$sort', '$isolated'
]);

// ===== SUSPICIOUS PATTERNS (ENHANCED) =====
const suspiciousPatterns = {
  // MongoDB operators (backup pattern matching)
  nosql: /\$[a-zA-Z]+/g,

  // XSS patterns
  xss: /<script|<iframe|<svg|<object|<embed|<applet|javascript:|on\w+\s*=/gi,

  // SQL injection patterns
  sql: /(union\s+select|insert\s+into|update\s+.*set|delete\s+from|drop\s+table|exec\s*\(|execute\s*\()/gi,

  // Command injection
  command: /[;&|`$(){}[\]]/g,

  // Path traversal
  pathTraversal: /\.\.[\/\\]/g,

  // Null bytes
  nullByte: /\x00/g,

  // LDAP injection
  ldap: /[()&|*]/g,

  // Unicode control characters
  controlChars: /[\x00-\x1F\x7F-\x9F]/g
};

// ===== HELPER: Detect NoSQL Operator Objects =====
const containsNoSQLOperators = (obj) => {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  // Check if any key is a NoSQL operator
  for (const key in obj) {
    if (NOSQL_OPERATORS.has(key) || key.startsWith('$')) {
      return true;
    }

    // Recursively check nested objects
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      if (containsNoSQLOperators(obj[key])) {
        return true;
      }
    }
  }

  return false;
};

// ===== HELPER: Validate String Without Modifying =====
const validateString = (value, fieldName = '') => {
  // Type check
  if (typeof value !== 'string') {
    Logger.warn('Non-string value in validate-only field', {
      field: fieldName,
      type: typeof value
    });
    throw new Error(`Invalid type for field "${fieldName}": expected string, got ${typeof value}`);
  }

  // Length check (prevent DoS)
  if (value.length > 1000000) { // 1MB limit
    Logger.error('Content too large', {
      field: fieldName,
      length: value.length
    });
    throw new Error(`Field "${fieldName}" exceeds maximum length of 1MB`);
  }

  // Check for NoSQL operators (CRITICAL - blocks injection)
  // Only reject actual known MongoDB operators, not $-prefixed variables (e.g. PHP superglobals like $_GET)
  if (value.includes('$')) {
    const tokenPattern = /\$[a-zA-Z][a-zA-Z0-9]*/g;
    let match;
    while ((match = tokenPattern.exec(value)) !== null) {
      if (NOSQL_OPERATORS.has(match[0])) {
        Logger.error('NoSQL operator detected in validate-only field', {
          field: fieldName,
          operator: match[0],
          sample: value.substring(0, 100)
        });
        throw new Error(`Security violation: NoSQL operators not allowed in field "${fieldName}"`);
      }
    }
  }

  // Check for prototype pollution attempts (CRITICAL)
  if (value.includes('__proto__') || value.includes('constructor') || value.includes('prototype')) {
    Logger.error('Prototype pollution attempt in validate-only field', {
      field: fieldName
    });
    throw new Error(`Security violation: Prototype pollution attempt in field "${fieldName}"`);
  }

  // Null byte check
  if (value.includes('\0') || /\x00/.test(value)) {
    Logger.error('Null byte detected in validate-only field', {
      field: fieldName
    });
    throw new Error(`Security violation: Null bytes not allowed in field "${fieldName}"`);
  }

  // Return original value unchanged
  return value;
};

// ===== HELPER: Sanitize String =====
const sanitizeString = (value, allowHtml = false, fieldName = '') => {
  // Check if this field should be validated-only (not modified)
  const baseFieldName = fieldName.split('.').pop().split('[')[0]; // Get base field name
  if (VALIDATE_ONLY_FIELDS.has(baseFieldName)) {
    Logger.debug('Field marked as validate-only, preserving content', {
      field: fieldName
    });
    return validateString(value, fieldName);
  }

  //  FIX #1: STRICT TYPE VALIDATION
  if (typeof value !== 'string') {
    Logger.warn('Non-string value detected during sanitization', {
      field: fieldName,
      type: typeof value,
      value: JSON.stringify(value)
    });

    // Convert to string or reject
    if (value === null || value === undefined) {
      return '';
    }

    // Convert numbers/booleans to strings
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    //   REJECT objects/arrays/functions
    throw new Error(`Invalid type for field "${fieldName}": expected string, got ${typeof value}`);
  }

  let sanitized = value;

  // Remove suspicious patterns
  Object.keys(suspiciousPatterns).forEach(pattern => {
    if (pattern === 'xss' && allowHtml) {
      return; // Skip XSS sanitization for HTML-allowed fields
    }

    sanitized = sanitized.replace(suspiciousPatterns[pattern], '');
  });

  //  FIX #2: EXPLICIT OPERATOR CHECK
  // Remove any remaining $ operators (belt and suspenders)
  if (sanitized.includes('$')) {
    Logger.warn('Potential NoSQL operator in string', {
      field: fieldName,
      original: value,
      sanitized
    });
    sanitized = sanitized.replace(/\$/g, '');
  }

  // Normalize Unicode (prevent bypass via encoding)
  sanitized = sanitized.normalize('NFKC');

  // Trim whitespace
  sanitized = sanitized.trim();

  return sanitized;
};

// ===== HELPER: Sanitize Object =====
const sanitizeObject = (obj, allowHtmlFields = [], parentKey = '') => {
  //  FIX #3: NULL CHECK
  if (obj === null || obj === undefined) {
    return null;
  }

  //  FIX #4: REJECT NOSQL OPERATOR OBJECTS
  if (containsNoSQLOperators(obj)) {
    Logger.error('NoSQL operator object detected and blocked', {
      parentKey,
      object: JSON.stringify(obj)
    });
    throw new Error(`Security violation: NoSQL operators detected in ${parentKey || 'request'}`);
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item, index) => {
      const itemKey = `${parentKey}[${index}]`;

      if (typeof item === 'string') {
        return sanitizeString(item, allowHtmlFields.includes(parentKey), itemKey);
      } else if (typeof item === 'object' && item !== null) {
        return sanitizeObject(item, allowHtmlFields, itemKey);
      } else if (typeof item === 'number' || typeof item === 'boolean') {
        return item; // Safe primitives
      } else {
        Logger.warn('Unexpected array item type', {
          key: itemKey,
          type: typeof item
        });
        return null; // Remove unexpected types
      }
    }).filter(item => item !== null); // Remove nulls
  }

  // Sanitize object keys and values
  const sanitized = {};

  Object.keys(obj).forEach(key => {
    //  FIX #5: SANITIZE KEYS (prevent prototype pollution)
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      Logger.error('Prototype pollution attempt detected', { key, parentKey });
      throw new Error('Security violation: Prototype pollution attempt');
    }

    const value = obj[key];
    const fullKey = parentKey ? `${parentKey}.${key}` : key;
    const allowHtml = allowHtmlFields.includes(key);

    try {
      if (typeof value === 'string') {
        sanitized[key] = sanitizeString(value, allowHtml, fullKey);
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = sanitizeObject(value, allowHtmlFields, fullKey);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        sanitized[key] = value; // Safe primitives
      } else if (value === null || value === undefined) {
        sanitized[key] = null; // Preserve explicit nulls
      } else {
        Logger.warn('Unexpected value type during sanitization', {
          key: fullKey,
          type: typeof value
        });
        sanitized[key] = null; // Default to null for unknown types
      }
    } catch (err) {
      Logger.error('Sanitization error', {
        key: fullKey,
        error: err.message
      });
      throw err; // Propagate security errors
    }
  });

  return sanitized;
};

// ===== MIDDLEWARE: Sanitize Request Body =====
const sanitizeRequestBody = (allowHtmlFields = []) => {
  return (req, res, next) => {
    //  FIX #6: REMOVE PROTECTED FIELD EXEMPTION
    if (!req.body || typeof req.body !== 'object') {
      return next();
    }

    try {
      if (process.env.NODE_ENV !== 'production') {
        Logger.debug('Sanitizing request body', {
          path: req.path,
          fields: Object.keys(req.body || {}),
        });
      }

      // Sanitize entire body
      // SECURITY: Block prototype pollution in body keys
      const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
      for (const dk of dangerousKeys) {
        if (Object.prototype.hasOwnProperty.call(req.body, dk)) {
          Logger.error('Prototype pollution attempt detected in body', { key: dk, path: req.path, ip: req.ip });
          delete req.body[dk];
        }
      }

      req.body = sanitizeObject(req.body, allowHtmlFields, 'body');

      Logger.info('Request body sanitized successfully', {
        path: req.path,
        method: req.method
      });

      next();
    } catch (err) {
      Logger.error('Request body sanitization failed', {
        path: req.path,
        error: err.message,
        fields: Object.keys(req.body || {}),
      });

      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid request data detected',
          details: process.env.NODE_ENV === 'development' ? err.message : undefined
        }
      });
    }
  };
};

// ===== MIDDLEWARE: Sanitize Query Parameters =====
const sanitizeQueryParams = (req, res, next) => {
  if (!req.query || typeof req.query !== 'object') {
    return next();
  }

  try {
    req.query = sanitizeObject(req.query, [], 'query');
    Logger.debug('Query parameters sanitized', { path: req.path });
    next();
  } catch (err) {
    Logger.error('Query parameter sanitization failed', {
      path: req.path,
      error: err.message
    });

    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_QUERY',
        message: 'Invalid query parameters detected'
      }
    });
  }
};

// ===== NEW: MIDDLEWARE: Sanitize URL Parameters =====
const sanitizeUrlParams = (req, res, next) => {
  if (!req.params || typeof req.params !== 'object') {
    return next();
  }

  try {
    //  FIX #7: SANITIZE URL PARAMETERS
    const sanitizedParams = {};

    Object.keys(req.params).forEach(key => {
      // SECURITY: Block prototype pollution attempts
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        Logger.error('Prototype pollution attempt detected in URL params', { key, path: req.path, ip: req.ip });
        return; // skip this key
      }

      const value = req.params[key];

      if (typeof value === 'string') {
        // Sanitize as string
        sanitizedParams[key] = sanitizeString(value, false, `params.${key}`);
      } else {
        // Should never happen, but handle it
        Logger.warn('Non-string URL parameter detected', {
          key,
          type: typeof value,
          value
        });
        sanitizedParams[key] = String(value);
      }
    });

    req.params = sanitizedParams;
    Logger.debug('URL parameters sanitized', { path: req.path, params: req.params });
    next();
  } catch (err) {
    Logger.error('URL parameter sanitization failed', {
      path: req.path,
      error: err.message
    });

    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_URL_PARAMETER',
        message: 'Invalid URL parameter detected'
      }
    });
  }
};

// ===== EMAIL VALIDATION =====
const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') {
    return false;
  }

  // Trim and lowercase for consistency
  const trimmed = email.trim().toLowerCase();

  // Basic email pattern
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Additional validation rules
  if (trimmed.length < 5 || trimmed.length > 255) {
    return false;
  }

  // Check for suspicious patterns
  if (trimmed.includes('..') || trimmed.startsWith('.') || trimmed.endsWith('.')) {
    return false;
  }

  return emailPattern.test(trimmed);
};

// ===== FILENAME VALIDATION =====
const validateFileName = (filename) => {
  if (!filename || typeof filename !== 'string') {
    return false;
  }

  // Check for path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return false;
  }

  // Check length
  if (filename.length < 1 || filename.length > 255) {
    return false;
  }

  // Check for valid characters
  const validPattern = /^[a-zA-Z0-9\s._-]+$/;
  return validPattern.test(filename);
};

// ===== UTILITY: Manual Sanitization =====
const sanitize = {
  string: sanitizeString,
  object: sanitizeObject,
  containsOperators: containsNoSQLOperators
};

module.exports = {
  sanitizeRequestBody,
  sanitizeQueryParams,
  sanitizeUrlParams,
  sanitize,
  isValidEmail,
  validateFileName,
  NOSQL_OPERATORS
};