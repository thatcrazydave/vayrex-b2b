const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const TokenService = require('../services/tokenService');
const Logger = require('../logger');
const PricingConfig = require('../models/PricingConfig');
const crypto = require('crypto');

// Request fingerprinting for additional security
function generateRequestFingerprint(req) {
  const components = [
    req.headers['user-agent'] || '',
    req.headers['accept-language'] || '',
    req.headers['accept-encoding'] || ''
  ].join('|');

  return crypto.createHash('sha256').update(components).digest('hex');
}

/**
 * identifyUser: Lightweight middleware to optionally identify the user from JWT
 * but NEVER fails the request. Used for rate limiting on shared IPs.
 */
const identifyUser = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return next();

    const decoded = TokenService.verifyAccessToken(token);
    if (!decoded) return next();

    // Check if token version matches (role changes, password resets)
    // We do a lightweight check here. Full check stays in authenticateToken.
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      subscriptionTier: decoded.subscriptionTier,
      tokenVersion: decoded.tokenVersion || 0
    };
  } catch (err) {
    // Ignore verification errors for identification ONLY
    // authenticateToken will handle rejection later if needed
  }
  next();
};

const authenticateToken = async (req, res, next) => {
  const startTime = Date.now();

  try {
    // SECURITY LAYER 1: Extract token
    // Priority 1: Authorization header (for tab-isolated sessionStorage tokens)
    // Priority 2: Cookie (for backward compatibility during migration)
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1];


    if (!token) {
      Logger.warn('Authentication attempt without token', {
        ip: req.ip,
        path: req.path,
        method: req.method,
        hasAuthHeader: !!authHeader,
        hasCookie: !!(req.cookies && req.cookies.token)
      });

      return res.status(401).json({
        success: false,
        error: {
          code: 'NO_TOKEN',
          message: 'Access token required',
          timestamp: new Date().toISOString()
        }
      });
    }

    // SECURITY LAYER 2: Verify token signature and expiration
    let decoded;
    try {
      decoded = TokenService.verifyAccessToken(token);
    } catch (err) {
      const isExpired = err.message.includes('expired');
      const isVerifyPath = req.path.includes('/auth/verify');

      if (isExpired && isVerifyPath) {
        // Silently handle expiration for the background verification endpoint
        // This prevents log clutter for expected session expirations
        Logger.debug('Token expired during background verification', {
          ip: req.ip,
          path: req.path
        });
      } else {
        Logger.warn('Token verification failed', {
          error: err.message,
          ip: req.ip,
          path: req.path
        });
      }

      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: err.message.includes('expired') ? 'Access token expired' : 'Invalid access token',
          timestamp: new Date().toISOString()
        }
      });
    }

    // SECURITY LAYER 3: Check token revocation
    let isRevoked = false;
    try {
      isRevoked = await TokenService.isTokenRevoked(decoded.jti);
    } catch (revokeErr) {
      // Redis is down or unavailable
      const criticalOperations = ['/auth/logout', '/auth/change-password', '/auth/delete-account', '/admin'];
      const isCriticalOperation = criticalOperations.some(op => req.path.includes(op));

      if (isCriticalOperation) {
        // Fail-closed for critical operations
        Logger.error('Token revocation check failed for critical operation', {
          error: revokeErr.message,
          jti: decoded.jti,
          path: req.path,
          userId: decoded.id
        });
        return res.status(503).json({
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Service temporarily unavailable. Please try again later.'
          }
        });
      }

      // Fail-open for non-critical operations
      Logger.warn('Token revocation check skipped (Redis unavailable)', {
        error: revokeErr.message,
        jti: decoded.jti,
        path: req.path,
        userId: decoded.id
      });
      isRevoked = false;
    }

    if (isRevoked) {
      Logger.warn('Revoked token used', {
        userId: decoded.id,
        jti: decoded.jti,
        ip: req.ip,
        path: req.path
      });

      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_REVOKED',
          message: 'Token has been revoked',
          timestamp: new Date().toISOString()
        }
      });
    }

    // SECURITY LAYER 4: Fetch user from database (fresh data)
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      Logger.warn('Token for non-existent user', {
        tokenUserId: decoded.id,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User account not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    // SECURITY LAYER 5: Check user account status
    if (!user.isActive) {
      Logger.warn('Inactive user attempted access', {
        userId: user._id,
        email: user.email,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        error: {
          code: 'USER_INACTIVE',
          message: 'User account is inactive',
          timestamp: new Date().toISOString()
        }
      });
    }

    if (user.isDeleted) {
      Logger.warn('Deleted user attempted access', {
        userId: user._id,
        email: user.email,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        error: {
          code: 'USER_DELETED',
          message: 'User account has been deleted',
          timestamp: new Date().toISOString()
        }
      });
    }

    // SECURITY LAYER 6: Validate token version (critical for RBAC)
    const tokenVersion = decoded.tokenVersion || 0;
    const userTokenVersion = user.tokenVersion || 0;

    if (tokenVersion !== userTokenVersion) {
      Logger.warn('Token version mismatch detected', {
        userId: user._id,
        tokenVersion,
        userTokenVersion,
        reason: 'Role or permissions changed'
      });

      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_VERSION_MISMATCH',
          message: 'User permissions have changed. Please log in again.',
          timestamp: new Date().toISOString(),
          requiresReauth: true
        }
      });
    }

    // SECURITY LAYER 7: Verify role in token matches DB (double-check)
    if (decoded.role !== user.role) {
      Logger.error('Role mismatch between token and database', {
        userId: user._id,
        tokenRole: decoded.role,
        dbRole: user.role,
        critical: true
      });

      return res.status(401).json({
        success: false,
        error: {
          code: 'ROLE_MISMATCH',
          message: 'Security verification failed. Please log in again.',
          timestamp: new Date().toISOString(),
          requiresReauth: true
        }
      });
    }

    // SECURITY LAYER 8: Check subscription expiry (atomic operation to prevent race conditions)
    if (user.isSubscriptionExpired && user.isSubscriptionExpired() && user.subscriptionTier !== 'free') {
      // Use atomic update to prevent concurrent modification issues
      await mongoose.model('User').findByIdAndUpdate(
        user._id,
        {
          $set: {
            subscriptionTier: 'free',
            subscriptionStatus: 'expired'
          }
        }
      );

      // Update local user object
      user.subscriptionTier = 'free';
      user.subscriptionStatus = 'expired';

      Logger.info('User subscription expired, downgraded to free', {
        userId: user._id
      });
    }

    // SECURITY LAYER 9: Request fingerprinting
    req.fingerprint = generateRequestFingerprint(req);

    // Attach validated data to request
    req.user = user;
    req.token = token;
    req.tokenDecoded = decoded;
    req.authTime = Date.now() - startTime;

    // Log successful authentication for audit trail
    if (req.path.includes('/admin')) {
      Logger.info('Admin route accessed', {
        userId: user._id,
        role: user.role,
        path: req.path,
        method: req.method,
        authTime: req.authTime
      });
    }

    next();
  } catch (err) {
    Logger.error('Authentication error', {
      error: err.message,
      stack: err.stack,
      ip: req.ip,
      path: req.path
    });

    return res.status(403).json({
      success: false,
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication failed',
        timestamp: new Date().toISOString()
      }
    });
  }
};

// Enhanced requireAdmin with strict role validation
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    Logger.error('requireAdmin called without authenticated user', {
      path: req.path,
      ip: req.ip
    });

    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        timestamp: new Date().toISOString()
      }
    });
  }

  const userRole = req.user.role;
  const allowedRoles = ['admin', 'superadmin'];

  if (!allowedRoles.includes(userRole)) {
    Logger.warn('Non-admin user attempted admin access', {
      userId: req.user._id,
      username: req.user.username,
      role: userRole,
      path: req.path,
      method: req.method,
      ip: req.ip
    });

    return res.status(403).json({
      success: false,
      error: {
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'Admin privileges required',
        timestamp: new Date().toISOString()
      }
    });
  }

  next();
};

// SuperAdmin-only middleware
const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        timestamp: new Date().toISOString()
      }
    });
  }

  if (req.user.role !== 'superadmin') {
    Logger.warn('Non-superadmin attempted superadmin action', {
      userId: req.user._id,
      username: req.user.username,
      role: req.user.role,
      path: req.path,
      method: req.method,
      ip: req.ip
    });

    return res.status(403).json({
      success: false,
      error: {
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'SuperAdmin privileges required',
        requiredRole: 'superadmin',
        currentRole: req.user.role,
        timestamp: new Date().toISOString()
      }
    });
  }

  next();
};

// Check upload limit (monthly and daily)
const checkUploadLimit = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NOT_AUTHENTICATED',
          message: 'Authentication required'
        }
      });
    }

    // NEW: Fetch global pricing config for dynamic limits
    const config = await PricingConfig.getConfig();
    const tierLimits = config.tiers[req.user.subscriptionTier]?.limits || req.user.limits;

    const monthlyLimit = tierLimits.uploadsPerMonth;
    const dailyLimit = tierLimits.uploadsPerDay;

    // Check monthly limit
    if (monthlyLimit !== -1 && req.user.usage.uploadsThisMonth >= monthlyLimit) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'UPLOAD_LIMIT_REACHED',
          message: `Monthly upload limit reached (${monthlyLimit}). Please upgrade for more.`,
          current: req.user.usage.uploadsThisMonth,
          limit: monthlyLimit,
          tier: req.user.subscriptionTier,
          upgradeRequired: true
        }
      });
    }

    // Check daily limit (if applicable)
    if (dailyLimit !== -1 && req.user.usage.uploadsToday >= dailyLimit) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'DAILY_LIMIT_REACHED',
          message: `Daily upload limit reached (${dailyLimit}). Please wait until tomorrow or upgrade.`,
          current: req.user.usage.uploadsToday,
          limit: dailyLimit,
          tier: req.user.subscriptionTier,
          upgradeRequired: true
        }
      });
    }

    next();
  } catch (err) {
    console.error('Upload limit check error:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Error checking upload limits'
      }
    });
  }
};

// Check file size limit
const checkFileSize = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NOT_AUTHENTICATED',
          message: 'Authentication required'
        }
      });
    }

    if (!req.files || (!req.files.file && !req.files.files)) {
      return next();
    }

    const config = await PricingConfig.getConfig();
    const tierLimits = config.tiers[req.user.subscriptionTier]?.limits || req.user.limits;
    const maxSizeMB = tierLimits.maxFileSizeMB;

    const files = req.files.file || req.files.files;
    const fileArray = Array.isArray(files) ? files : [files];

    for (const file of fileArray) {
      const fileSizeMB = file.size / (1024 * 1024);
      if (fileSizeMB > maxSizeMB) {
        return res.status(413).json({
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File size exceeds the maximum allowed limit of ${maxSizeMB}MB`,
            fileSize: fileSizeMB.toFixed(2),
            maxSize: maxSizeMB,
            tier: req.user.subscriptionTier
          }
        });
      }
    }

    next();
  } catch (err) {
    console.error('File size check error:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Error checking file size'
      }
    });
  }
};

// Check storage limit
const checkStorageLimit = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NOT_AUTHENTICATED',
          message: 'Authentication required'
        }
      });
    }

    if (!req.files || (!req.files.file && !req.files.files)) {
      return next();
    }

    const config = await PricingConfig.getConfig();
    const tierLimits = config.tiers[req.user.subscriptionTier]?.limits || req.user.limits;
    const maxStorageMB = tierLimits.maxStorageMB;

    if (maxStorageMB === -1) return next();

    let incomingSizeMB = 0;
    const files = req.files.file || req.files.files;
    const fileArray = Array.isArray(files) ? files : [files];

    fileArray.forEach(file => {
      incomingSizeMB += (file.size / (1024 * 1024));
    });

    const currentUsageMB = req.user.usage?.storageUsedMB || 0;

    if ((currentUsageMB + incomingSizeMB) > maxStorageMB) {
      const remaining = Math.max(0, maxStorageMB - currentUsageMB);
      return res.status(507).json({
        success: false,
        error: {
          code: 'STORAGE_LIMIT_REACHED',
          message: `Storage limit reached. You have ${remaining.toFixed(2)}MB remaining.`,
          fileSize: incomingSizeMB.toFixed(2),
          storageUsed: currentUsageMB.toFixed(2),
          storageLimit: maxStorageMB,
          remaining: remaining,
          tier: req.user.subscriptionTier,
          upgradeRequired: true
        }
      });
    }

    next();
  } catch (err) {
    console.error('Storage limit check error:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Error checking storage limits'
      }
    });
  }
};

// Check token limit for AI requests
const checkTokenLimit = (estimatedTokens = 500) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'NOT_AUTHENTICATED',
            message: 'Authentication required'
          }
        });
      }

      const config = await PricingConfig.getConfig();
      const tierLimits = config.tiers[req.user.subscriptionTier]?.limits || req.user.limits;

      // Check per-request token limit
      if (estimatedTokens > tierLimits.tokensPerRequest) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'TOKEN_REQUEST_LIMIT',
            message: 'This request exceeds your plan\'s per-request token limit. Try fewer questions or upgrade your plan.',
            requested: estimatedTokens,
            maxPerRequest: tierLimits.tokensPerRequest,
            tier: req.user.subscriptionTier,
            upgradeRequired: true
          }
        });
      }

      // Check monthly token limit
      if (tierLimits.tokensPerMonth !== -1) {
        const tokensUsed = req.user.usage?.tokensUsedThisMonth || 0;
        if ((tokensUsed + estimatedTokens) > tierLimits.tokensPerMonth) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'TOKEN_LIMIT_REACHED',
              message: 'Monthly AI token limit reached. Upgrade your plan for more usage.',
              tokensUsed: tokensUsed,
              tokensLimit: tierLimits.tokensPerMonth,
              tier: req.user.subscriptionTier,
              upgradeRequired: true,
              resetDate: getNextMonthDate()
            }
          });
        }
      }

      next();
    } catch (err) {
      console.error('Token limit check error:', err);
      return res.status(500).json({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'Error checking token limits'
        }
      });
    }
  };
};

// Track upload after success
const trackUpload = (req, res, next) => {
  const originalSend = res.send;

  res.send = async function (data) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        const hasFile = req.files && req.files.file;
        // Text-only uploads (e.g. generate-from-notes text path) have no file
        // but still count as an upload for limit purposes
        const hasText = !hasFile && req.body && req.body.text;

        if (req.user && (hasFile || hasText)) {
          if (req.user.incrementUploadCount) {
            await req.user.incrementUploadCount();
          }
          // Only track storage for actual file uploads
          if (hasFile && req.user.addStorageUsage) {
            const fileArr = Array.isArray(req.files.file) ? req.files.file : [req.files.file];
            const totalSizeMB = fileArr.reduce((sum, f) => sum + ((f && f.size) ? f.size : 0), 0) / (1024 * 1024);
            if (totalSizeMB > 0 && !isNaN(totalSizeMB)) {
              await req.user.addStorageUsage(totalSizeMB);
            }
          }
        }
      } catch (err) {
        console.error('Upload tracking error:', err);
      }
    }

    originalSend.call(this, data);
  };

  next();
};

// Track token usage after AI request
const trackTokenUsage = (req, res, next) => {
  const originalJson = res.json;

  res.json = async function (data) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        const tokensUsed = data?.usage?.total_tokens ||
          data?.tokensUsed ||
          estimateTokensFromResponse(data);

        if (req.user && tokensUsed > 0 && req.user.addTokenUsage) {
          await req.user.addTokenUsage(tokensUsed);
        }
      } catch (err) {
        console.error('Token tracking error:', err);
      }
    }

    originalJson.call(this, data);
  };

  next();
};

// Estimate tokens from response content
function estimateTokensFromResponse(data) {
  if (!data) return 0;

  let content = '';
  if (data.content) content = data.content;
  else if (data.data?.content) content = data.data.content;
  else if (data.feedback) content = data.feedback;

  if (!content) return 0;

  return Math.ceil(content.length / 4);
}

// Helper: Get next month date
function getNextMonthDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

module.exports = {
  authenticateToken,
  identifyUser,
  requireAdmin,
  requireSuperAdmin,
  checkUploadLimit,
  checkFileSize,
  checkStorageLimit,
  checkTokenLimit,
  trackUpload,
  trackTokenUsage
};