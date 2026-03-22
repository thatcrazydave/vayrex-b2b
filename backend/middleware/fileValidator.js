const Logger = require('../logger');
const inputLimits = require('../config/inputLimits');

/**
 * File Magic Bytes (File Signatures)
 * First few bytes that identify actual file type
 */
const FILE_SIGNATURES = {
  // Documents
  'application/pdf': {
    signature: [0x25, 0x50, 0x44, 0x46],
    extensions: ['.pdf']
  },
  // Office Open XML formats - All use ZIP format, cannot be distinguished by magic bytes
  'application/vnd.openxmlformats-officedocument': {
    signature: [0x50, 0x4B, 0x03, 0x04],
    extensions: ['.docx', '.pptx'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ]
  },
  'text/plain': {
    // Text files have no consistent magic bytes, allow any
    signature: null,
    extensions: ['.txt']
  },
  
  // Images
  'image/png': {
    signature: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
    extensions: ['.png']
  },
  'image/jpeg': {
    signature: [0xFF, 0xD8, 0xFF],
    extensions: ['.jpg', '.jpeg']
  },
  'image/webp': {
    signature: [0x52, 0x49, 0x46, 0x46],
    extensions: ['.webp']
  },
  // HEIC/HEIF — ISOBMFF container: bytes 4-7 are 'ftyp' (0x66, 0x74, 0x79, 0x70)
  'image/heic': {
    signature: null, // checked via custom logic in detectFileType
    extensions: ['.heic', '.heif'],
    mimeTypes: ['image/heic', 'image/heif']
  },
  
  // Dangerous file types (BLOCKED)
  'application/x-msdownload': {
    signature: [0x4D, 0x5A], 
    extensions: ['.exe', '.dll'],
    blocked: true
  },
  'application/x-executable': {
    signature: [0x7F, 0x45, 0x4C, 0x46],
    extensions: ['.elf', '.bin'],
    blocked: true
  },
  'application/x-sh': {
    signature: [0x23, 0x21],
    extensions: ['.sh', '.bash'],
    blocked: true
  },
  'application/x-bat': {
    signature: null,
    extensions: ['.bat', '.cmd'],
    blocked: true
  }
};

/**
 * Check file magic bytes against expected signature
 */
function checkMagicBytes(buffer, expectedSignature) {
  if (!expectedSignature) {
    // No signature check required (e.g., text files)
    return true;
  }

  if (buffer.length < expectedSignature.length) {
    return false;
  }

  for (let i = 0; i < expectedSignature.length; i++) {
    if (buffer[i] !== expectedSignature[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Detect actual file type from magic bytes
 */
function detectFileType(buffer) {
  for (const [mimeType, config] of Object.entries(FILE_SIGNATURES)) {
    if (config.signature && checkMagicBytes(buffer, config.signature)) {
      return {
        mimeType,
        extensions: config.extensions,
        blocked: config.blocked || false
      };
    }
  }

  // HEIC/HEIF: ISOBMFF container — bytes 4-7 are ASCII 'ftyp'
  if (buffer.length >= 12 &&
    buffer[4] === 0x66 && buffer[5] === 0x74 &&
    buffer[6] === 0x79 && buffer[7] === 0x70) {
    // Check sub-brand: heic, heix, mif1, etc.
    const brand = buffer.slice(8, 12).toString('ascii').toLowerCase();
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heif'].some(b => brand.startsWith(b))) {
      return {
        mimeType: 'image/heic',
        extensions: ['.heic', '.heif'],
        blocked: false
      };
    }
  }

  return {
    mimeType: 'unknown',
    extensions: [],
    blocked: false
  };
}

/**
 * Get file extension from filename
 */
function getFileExtension(filename) {
  const match = filename.match(/\.[^.]+$/);
  return match ? match[0].toLowerCase() : '';
}

/**
 * Sanitize filename (remove dangerous characters)
 */
function sanitizeFilename(filename) {
  // Remove path separators and dangerous characters
  let sanitized = filename
    .replace(/[\/\\]/g, '')
    .replace(/\.\./g, '')
    .replace(/[<>:"|?*\x00-\x1f]/g, '')
    .replace(/^\./, '');

  // Limit length
  const maxLength = 200;
  if (sanitized.length > maxLength) {
    const ext = getFileExtension(sanitized);
    const nameWithoutExt = sanitized.substring(0, sanitized.length - ext.length);
    sanitized = nameWithoutExt.substring(0, maxLength - ext.length) + ext;
  }

  return sanitized;
}

/**
 * Check for dangerous file patterns
 */
function containsDangerousPatterns(filename, buffer) {
  const dangerous = {
    // Dangerous extensions
    extensions: ['.exe', '.dll', '.bat', '.cmd', '.com', '.scr', '.vbs', '.js', '.jar', '.sh', '.bash'],
    
    // Dangerous strings in content (first 1KB)
    patterns: [
      Buffer.from('MZ'),
      Buffer.from('#!/bin/'),
      Buffer.from('<script'),
      Buffer.from('<?php'),
      Buffer.from('eval('),
    ]
  };

  // Check extension
  const ext = getFileExtension(filename);
  if (dangerous.extensions.includes(ext)) {
    return true;
  }

  // Check content patterns (first 1KB)
  const checkLength = Math.min(buffer.length, 1024);
  const sample = buffer.slice(0, checkLength);

  for (const pattern of dangerous.patterns) {
    if (sample.includes(pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate file upload
 */
async function validateFileUpload(req, res, next) {
  try {
    // Check if file exists
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_FILE_UPLOADED',
          message: 'No file was uploaded',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Get the uploaded file
    const file = req.files.file || req.files[Object.keys(req.files)[0]];

    // ===== STEP 1: Check file size =====
    const maxSizeBytes = inputLimits.file.maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      Logger.warn('File upload rejected - size exceeded', {
        filename: file.name,
        size: file.size,
        maxSize: maxSizeBytes,
        ip: req.ip
      });

      return res.status(413).json({
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File size exceeds maximum allowed (${inputLimits.file.maxSizeMB}MB)`,
          maxSizeMB: inputLimits.file.maxSizeMB,
          fileSizeMB: (file.size / 1024 / 1024).toFixed(2),
          timestamp: new Date().toISOString()
        }
      });
    }

    // ===== STEP 2: Validate filename =====
    const extension = getFileExtension(file.name);
    
    if (!inputLimits.file.allowedExtensions.includes(extension)) {
      Logger.warn('File upload rejected - invalid extension', {
        filename: file.name,
        extension,
        allowedExtensions: inputLimits.file.allowedExtensions,
        ip: req.ip
      });

      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILE_TYPE',
          message: `File type not allowed. Allowed types: ${inputLimits.file.allowedExtensions.join(', ')}`,
          extension,
          allowedExtensions: inputLimits.file.allowedExtensions,
          timestamp: new Date().toISOString()
        }
      });
    }

    // =====Check magic bytes (actual file type) =====
    const buffer = file.data;
    const detectedType = detectFileType(buffer);

    if (detectedType.blocked) {
      Logger.error('SECURITY: Malicious file upload attempt detected', {
        filename: file.name,
        claimedExtension: extension,
        detectedType: detectedType.mimeType,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        userId: req.user?.id
      });

      return res.status(403).json({
        success: false,
        error: {
          code: 'MALICIOUS_FILE_DETECTED',
          message: 'File type is not allowed for security reasons',
          timestamp: new Date().toISOString()
        }
      });
    }

    // =====Check for dangerous patterns =====
    if (containsDangerousPatterns(file.name, buffer)) {
      Logger.error('SECURITY: Dangerous file pattern detected', {
        filename: file.name,
        ip: req.ip,
        userId: req.user?.id
      });

      return res.status(403).json({
        success: false,
        error: {
          code: 'DANGEROUS_FILE_CONTENT',
          message: 'File contains potentially dangerous content',
          timestamp: new Date().toISOString()
        }
      });
    }

    // =====Validate MIME type =====
    // For documents, check if detected type matches claimed type
    if (detectedType.mimeType !== 'unknown' && extension !== '.txt') {
      // Check if extension matches detected type
      const extensionMatches = detectedType.extensions.includes(extension);

      // For Office Open XML formats, check if both claimed and detected are valid Office types
      const isOfficeFormat = detectedType.mimeTypes &&
                           detectedType.mimeTypes.some(mt => file.mimetype.includes(mt) || mt.includes(file.mimetype));

      // Reject if extension doesn't match AND it's not a valid Office cross-format scenario
      if (!extensionMatches && !isOfficeFormat) {
        Logger.warn('File upload rejected - type mismatch', {
          filename: file.name,
          claimedMimeType: file.mimetype,
          detectedMimeType: detectedType.mimeType,
          extension,
          ip: req.ip
        });

        return res.status(400).json({
          success: false,
          error: {
            code: 'FILE_TYPE_MISMATCH',
            message: 'File content does not match the file extension',
            claimedType: file.mimetype,
            detectedType: detectedType.mimeType,
            suggestion: 'Please ensure the file is in the correct format',
            timestamp: new Date().toISOString()
          }
        });
      }
    }

    // Check if MIME type is allowed
    if (!inputLimits.file.allowedMimeTypes.includes(file.mimetype)) {
      Logger.warn('File upload rejected - MIME type not allowed', {
        filename: file.name,
        mimeType: file.mimetype,
        allowedMimeTypes: inputLimits.file.allowedMimeTypes,
        ip: req.ip
      });

      return res.status(400).json({
        success: false,
        error: {
          code: 'MIME_TYPE_NOT_ALLOWED',
          message: `MIME type not allowed: ${file.mimetype}`,
          mimeType: file.mimetype,
          allowedMimeTypes: inputLimits.file.allowedMimeTypes,
          timestamp: new Date().toISOString()
        }
      });
    }

    // =====Sanitize filename =====
    const sanitizedFilename = sanitizeFilename(file.name);
    
    if (!sanitizedFilename) {
      Logger.warn('File upload rejected - invalid filename after sanitization', {
        originalFilename: file.name,
        ip: req.ip
      });

      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILENAME',
          message: 'Filename contains invalid characters',
          timestamp: new Date().toISOString()
        }
      });
    }

    // =====Check for null bytes (path traversal attempt) =====
    if (file.name.includes('\x00')) {
      Logger.error('SECURITY: Null byte injection attempt detected', {
        filename: file.name,
        ip: req.ip,
        userId: req.user?.id
      });

      return res.status(403).json({
        success: false,
        error: {
          code: 'INVALID_FILE_CONTENT',
          message: 'File contains invalid data',
          timestamp: new Date().toISOString()
        }
      });
    }

    // =====Check file is not empty =====
    if (file.size === 0 || buffer.length === 0) {
      Logger.warn('File upload rejected - empty file', {
        filename: file.name,
        ip: req.ip
      });

      return res.status(400).json({
        success: false,
        error: {
          code: 'EMPTY_FILE',
          message: 'File is empty',
          timestamp: new Date().toISOString()
        }
      });
    }

    // ===== ALL CHECKS PASSED =====
    
    // Attach validated data to request
    req.validatedFile = {
      originalName: file.name,
      sanitizedName: sanitizedFilename,
      size: file.size,
      mimeType: file.mimetype,
      detectedType: detectedType.mimeType,
      extension,
      buffer: buffer,
      data: file.data,
      md5: file.md5
    };

    Logger.info('File upload validation passed', {
      filename: sanitizedFilename,
      size: file.size,
      mimeType: file.mimetype,
      detectedType: detectedType.mimeType,
      userId: req.user?.id,
      ip: req.ip
    });

    next();

  } catch (err) {
    Logger.error('File validation error', {
      error: err.message,
      stack: err.stack,
      ip: req.ip
    });

    return res.status(500).json({
      success: false,
      error: {
        code: 'FILE_VALIDATION_ERROR',
        message: 'Error validating file upload',
        timestamp: new Date().toISOString()
      }
    });
  }
}

/**
 * Validate multi-file upload (for multi-file quiz generation)
 * Runs same security checks as validateFileUpload on EACH file, then
 * attaches `req.validatedFiles[]` (array) instead of singular `req.validatedFile`.
 * 
 * Expects files under req.files.file (single or array via express-fileupload)
 */
async function validateMultiFileUpload(req, res, next) {
  try {
    // Check if any files exist
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_FILE_UPLOADED',
          message: 'No files were uploaded',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Normalize to array (express-fileupload sends single file as object, multiple as array)
    const rawFiles = req.files.file || req.files[Object.keys(req.files)[0]];
    const filesArray = Array.isArray(rawFiles) ? rawFiles : [rawFiles];

    // SECURITY: Enforce aggregate upload size limit (prevent OOM via many large files)
    const MAX_TOTAL_UPLOAD_BYTES = (inputLimits.file.maxSizeMB || 50) * 1024 * 1024 * 2; // 2x single file limit
    const totalSize = filesArray.reduce((sum, f) => sum + (f.size || 0), 0);
    if (totalSize > MAX_TOTAL_UPLOAD_BYTES) {
      Logger.warn('Multi-file upload rejected - aggregate size exceeded', {
        totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
        maxTotalMB: (MAX_TOTAL_UPLOAD_BYTES / 1024 / 1024).toFixed(2),
        fileCount: filesArray.length,
        ip: req.ip
      });
      return res.status(413).json({
        success: false,
        error: {
          code: 'TOTAL_SIZE_EXCEEDED',
          message: `Total upload size (${(totalSize / 1024 / 1024).toFixed(1)}MB) exceeds the maximum allowed (${(MAX_TOTAL_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB)`,
          totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
          timestamp: new Date().toISOString()
        }
      });
    }

    Logger.info('Multi-file upload validation starting', {
      fileCount: filesArray.length,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      userId: req.user?.id,
      ip: req.ip
    });

    const validatedFiles = [];

    for (let i = 0; i < filesArray.length; i++) {
      const file = filesArray[i];
      const fileLabel = `File ${i + 1}/${filesArray.length} (${file.name})`;

      // ── Size check ──
      const maxSizeBytes = inputLimits.file.maxSizeMB * 1024 * 1024;
      if (file.size > maxSizeBytes) {
        Logger.warn(`${fileLabel}: rejected - size exceeded`, { size: file.size, maxSize: maxSizeBytes });
        return res.status(413).json({
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `${file.name} exceeds maximum size (${inputLimits.file.maxSizeMB}MB)`,
            maxSizeMB: inputLimits.file.maxSizeMB,
            fileSizeMB: (file.size / 1024 / 1024).toFixed(2),
            fileName: file.name,
            timestamp: new Date().toISOString()
          }
        });
      }

      // ── Extension check ──
      const extension = getFileExtension(file.name);
      if (!inputLimits.file.allowedExtensions.includes(extension)) {
        Logger.warn(`${fileLabel}: rejected - invalid extension`, { extension });
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_FILE_TYPE',
            message: `${file.name}: file type not allowed. Allowed: ${inputLimits.file.allowedExtensions.join(', ')}`,
            extension,
            fileName: file.name,
            timestamp: new Date().toISOString()
          }
        });
      }

      // ── Magic bytes ──
      const buffer = file.data;
      const detectedType = detectFileType(buffer);
      if (detectedType.blocked) {
        Logger.error(`SECURITY: Malicious file in multi-upload`, { filename: file.name, detectedType: detectedType.mimeType, ip: req.ip });
        return res.status(403).json({
          success: false,
          error: {
            code: 'MALICIOUS_FILE_DETECTED',
            message: `${file.name}: file type not allowed for security reasons`,
            fileName: file.name,
            timestamp: new Date().toISOString()
          }
        });
      }

      // ── Dangerous patterns ──
      if (containsDangerousPatterns(file.name, buffer)) {
        Logger.error(`SECURITY: Dangerous pattern in multi-upload`, { filename: file.name, ip: req.ip });
        return res.status(403).json({
          success: false,
          error: {
            code: 'DANGEROUS_FILE_CONTENT',
            message: `${file.name}: contains potentially dangerous content`,
            fileName: file.name,
            timestamp: new Date().toISOString()
          }
        });
      }

      // ── MIME type mismatch ──
      if (detectedType.mimeType !== 'unknown' && extension !== '.txt') {
        const extensionMatches = detectedType.extensions.includes(extension);
        const isOfficeFormat = detectedType.mimeTypes &&
          detectedType.mimeTypes.some(mt => file.mimetype.includes(mt) || mt.includes(file.mimetype));
        if (!extensionMatches && !isOfficeFormat) {
          Logger.warn(`${fileLabel}: type mismatch`, { claimed: file.mimetype, detected: detectedType.mimeType });
          return res.status(400).json({
            success: false,
            error: {
              code: 'FILE_TYPE_MISMATCH',
              message: `${file.name}: file content does not match extension`,
              fileName: file.name,
              timestamp: new Date().toISOString()
            }
          });
        }
      }

      // ── MIME type allowed list ──
      if (!inputLimits.file.allowedMimeTypes.includes(file.mimetype)) {
        Logger.warn(`${fileLabel}: MIME type not allowed`, { mimeType: file.mimetype });
        return res.status(400).json({
          success: false,
          error: {
            code: 'MIME_TYPE_NOT_ALLOWED',
            message: `${file.name}: MIME type not allowed (${file.mimetype})`,
            fileName: file.name,
            timestamp: new Date().toISOString()
          }
        });
      }

      // ── Sanitize filename ──
      const sanitizedFilename = sanitizeFilename(file.name);
      if (!sanitizedFilename) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_FILENAME',
            message: `${file.name}: filename contains invalid characters`,
            fileName: file.name,
            timestamp: new Date().toISOString()
          }
        });
      }

      // ── Null bytes ──
      if (file.name.includes('\x00')) {
        Logger.error('SECURITY: Null byte injection in multi-upload', { filename: file.name, ip: req.ip });
        return res.status(403).json({
          success: false,
          error: {
            code: 'INVALID_FILE_CONTENT',
            message: `${file.name}: contains invalid data`,
            fileName: file.name,
            timestamp: new Date().toISOString()
          }
        });
      }

      // ── Empty file ──
      if (file.size === 0 || buffer.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'EMPTY_FILE',
            message: `${file.name}: file is empty`,
            fileName: file.name,
            timestamp: new Date().toISOString()
          }
        });
      }

      // ──  Passed ──
      validatedFiles.push({
        originalName: file.name,
        sanitizedName: sanitizedFilename,
        size: file.size,
        mimeType: file.mimetype,
        detectedType: detectedType.mimeType,
        extension,
        buffer: buffer,
        data: file.data,
        md5: file.md5
      });
    }

    req.validatedFiles = validatedFiles;

    Logger.info('Multi-file upload validation passed', {
      fileCount: validatedFiles.length,
      files: validatedFiles.map(f => ({ name: f.sanitizedName, size: f.size, ext: f.extension })),
      userId: req.user?.id,
      ip: req.ip
    });

    next();

  } catch (err) {
    Logger.error('Multi-file validation error', { error: err.message, stack: err.stack, ip: req.ip });
    return res.status(500).json({
      success: false,
      error: {
        code: 'FILE_VALIDATION_ERROR',
        message: 'Error validating file uploads',
        timestamp: new Date().toISOString()
      }
    });
  }
}

/**
 * Quick filename-only validator (for less critical endpoints)
 */
function validateFilenameOnly(req, res, next) {
  try {
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_FILE_UPLOADED',
          message: 'No file was uploaded'
        }
      });
    }

    const file = req.files.file || req.files[Object.keys(req.files)[0]];
    const extension = getFileExtension(file.name);

    if (!inputLimits.file.allowedExtensions.includes(extension)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILE_TYPE',
          message: `File type not allowed: ${extension}`,
          allowedExtensions: inputLimits.file.allowedExtensions
        }
      });
    }

    const sanitizedFilename = sanitizeFilename(file.name);
    
    if (!sanitizedFilename) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILENAME',
          message: 'Filename contains invalid characters'
        }
      });
    }

    req.validatedFile = {
      originalName: file.name,
      sanitizedName: sanitizedFilename,
      size: file.size,
      mimeType: file.mimetype,
      extension,
      data: file.data
    };

    next();

  } catch (err) {
    Logger.error('Filename validation error', { error: err.message });
    
    return res.status(500).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Error validating filename'
      }
    });
  }
}

module.exports = {
  validateFileUpload,
  validateMultiFileUpload,
  validateFilenameOnly,
  sanitizeFilename,
  detectFileType,
  checkMagicBytes,
  containsDangerousPatterns
};