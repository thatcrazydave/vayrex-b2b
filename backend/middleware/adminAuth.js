const Logger = require('../logger');
const AuditLog = require('../models/AuditLog');
const { isRedisReady, getRedisClient } = require('../redisClient');
const crypto = require('crypto');

// ===== REQUEST FINGERPRINTING =====

function generateRequestFingerprint(ip, userAgent) {
  const fingerprintString = `${ip}:${userAgent}`;
  return crypto.createHash('sha256').update(fingerprintString).digest('hex');
}

// ===== ADMIN ACCESS ATTEMPT TRACKING & BLACKLISTING =====

// In-memory fallback for tracking admin access attempts
const inMemoryAttempts = new Map();
const inMemoryBlacklist = new Set();

async function checkAdminAccessAttempts(userId, ip, userAgent) {
  const fingerprint = generateRequestFingerprint(ip, userAgent);
  const key = `admin_access_attempts:${userId}:${fingerprint}`;
  const blacklistKey = `admin_blacklist:${userId}:${fingerprint}`;
  const MAX_ATTEMPTS = 5; // STRICTER: Reduced from 10 to 5
  const WINDOW_SECONDS = 15 * 60; // 15 minutes
  const BLACKLIST_DURATION = 60 * 60; // 1 hour
  
  try {
    if (isRedisReady()) {
      const redis = getRedisClient();
      
      // Check if blacklisted
      const isBlacklisted = await redis.exists(blacklistKey);
      if (isBlacklisted) {
        const ttl = await redis.ttl(blacklistKey);
        return {
          attempts: MAX_ATTEMPTS + 1,
          exceeded: true,
          blacklisted: true,
          remainingTime: ttl,
          storage: 'redis'
        };
      }
      
      const attempts = await redis.incr(key);
      
      if (attempts === 1) {
        await redis.expire(key, WINDOW_SECONDS);
      }
      
      // Auto-blacklist after max attempts
      if (attempts > MAX_ATTEMPTS) {
        await redis.setex(blacklistKey, BLACKLIST_DURATION, '1');
        
        Logger.error('Admin access auto-blacklisted', {
          userId,
          ip,
          fingerprint,
          attempts,
          blacklistDuration: BLACKLIST_DURATION
        });
      }
      
      return {
        attempts,
        exceeded: attempts > MAX_ATTEMPTS,
        blacklisted: attempts > MAX_ATTEMPTS,
        storage: 'redis'
      };
    } else {
      // Fall back to in-memory
      const now = Date.now();
      
      // Check blacklist
      if (inMemoryBlacklist.has(blacklistKey)) {
        return {
          attempts: MAX_ATTEMPTS + 1,
          exceeded: true,
          blacklisted: true,
          storage: 'memory'
        };
      }
      
      const entry = inMemoryAttempts.get(key);
      
      if (!entry || now > entry.resetTime) {
        inMemoryAttempts.set(key, {
          count: 1,
          resetTime: now + (WINDOW_SECONDS * 1000)
        });
        
        return {
          attempts: 1,
          exceeded: false,
          blacklisted: false,
          storage: 'memory'
        };
      }
      
      entry.count++;
      
      // Auto-blacklist
      if (entry.count > MAX_ATTEMPTS) {
        inMemoryBlacklist.add(blacklistKey);
        setTimeout(() => inMemoryBlacklist.delete(blacklistKey), BLACKLIST_DURATION * 1000);
      }
      
      return {
        attempts: entry.count,
        exceeded: entry.count > MAX_ATTEMPTS,
        blacklisted: entry.count > MAX_ATTEMPTS,
        storage: 'memory'
      };
    }
  } catch (err) {
    Logger.error('Admin access attempt check failed', { error: err.message });
    
    //  FAIL-CLOSED: On error, assume exceeded
    return {
      attempts: MAX_ATTEMPTS + 1,
      exceeded: true,
      blacklisted: false,
      storage: 'error',
      error: err.message
    };
  }
}

async function clearAdminAccessAttempts(userId, ip, userAgent) {
  const fingerprint = generateRequestFingerprint(ip, userAgent);
  const key = `admin_access_attempts:${userId}:${fingerprint}`;
  const blacklistKey = `admin_blacklist:${userId}:${fingerprint}`;
  
  try {
    if (isRedisReady()) {
      const redis = getRedisClient();
      await redis.del(key);
      await redis.del(blacklistKey); // Also remove from blacklist on successful auth
    }
    
    // Also clear from in-memory
    inMemoryAttempts.delete(key);
    inMemoryBlacklist.delete(blacklistKey);
  } catch (err) {
    Logger.error('Failed to clear admin access attempts', { error: err.message });
  }
}

// ===== ADMIN AUTH MIDDLEWARE =====

async function adminAuth(req, res, next) {
  try {
    // ===== STEP 1: Check authentication =====
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

    // ===== STEP 2: Check authorization =====
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      const userAgent = req.get('user-agent') || 'unknown';
      const { attempts, exceeded, blacklisted, remainingTime, storage } = await checkAdminAccessAttempts(req.user.id, req.ip, userAgent);
      
      if (blacklisted) {
        Logger.error('Blacklisted user attempted admin access', {
          userId: req.user.id,
          ip: req.ip,
          fingerprint: generateRequestFingerprint(req.ip, userAgent),
          attempts,
          remainingTime,
          storage,
          endpoint: req.path
        });
        
        try {
          await AuditLog.create({
            userId: req.user.id,
            action: 'admin_access_blacklisted',
            details: {
              endpoint: req.path,
              role: req.user.role,
              attempts,
              remainingTime,
              storage
            },
            ipAddress: req.ip,
            userAgent: userAgent,
            severity: 'critical',
            timestamp: new Date()
          });
        } catch (auditErr) {
          Logger.error('Audit log failed for blacklisted access', { error: auditErr.message });
        }
        
        return res.status(403).json({
          success: false,
          error: {
            code: 'BLACKLISTED',
            message: 'Access denied. Too many failed attempts. Contact administrator.',
            timestamp: new Date().toISOString()
          }
        });
      }
      
      if (exceeded) {
        Logger.warn('Admin access rate limit exceeded', {
          userId: req.user.id,
          ip: req.ip,
          fingerprint: generateRequestFingerprint(req.ip, userAgent),
          attempts,
          storage,
          endpoint: req.path
        });
        
        try {
          await AuditLog.create({
            userId: req.user.id,
            action: 'admin_access_rate_limit',
            details: {
              endpoint: req.path,
              role: req.user.role,
              attempts,
              storage
            },
            ipAddress: req.ip,
            userAgent: userAgent,
            severity: 'critical',
            timestamp: new Date()
          });
        } catch (auditErr) {
          Logger.error('Audit log failed for rate limit', { error: auditErr.message });
        }
        
        return res.status(429).json({
          success: false,
          error: {
            code: 'TOO_MANY_ATTEMPTS',
            message: 'Too many failed admin access attempts. Access blocked.',
            timestamp: new Date().toISOString()
          }
        });
      }
      
      Logger.warn('Unauthorized admin access attempt', { 
        userId: req.user.id,
        username: req.user.username || 'unknown',
        role: req.user.role,
        endpoint: req.path,
        method: req.method,
        ip: req.ip,
        fingerprint: generateRequestFingerprint(req.ip, userAgent),
        attempt: attempts
      });
      
      try {
        await AuditLog.create({
          userId: req.user.id,
          action: 'failed_admin_access',
          details: {
            endpoint: req.path,
            method: req.method,
            role: req.user.role,
            attempt: attempts
          },
          ipAddress: req.ip,
          userAgent: userAgent,
          severity: 'warning',
          timestamp: new Date()
        });
      } catch (auditErr) {
        Logger.error('Audit log creation failed', { 
          error: auditErr.message,
          userId: req.user.id 
        });
      }
      
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied. This incident has been logged.',
          remainingAttempts: Math.max(0, 5 - attempts), // Updated to 5
          timestamp: new Date().toISOString()
        }
      });
    }

    // ===== STEP 3: Authorized - clear failed attempts =====
    const userAgent = req.get('user-agent') || 'unknown';
    await clearAdminAccessAttempts(req.user.id, req.ip, userAgent);
    try {
      await AuditLog.create({
        userId: req.user.id,
        action: 'admin_access_success',
        details: {
          endpoint: req.path,
          method: req.method,
          role: req.user.role
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        severity: 'info',
        timestamp: new Date()
      });
    } catch (auditErr) {
      Logger.error('Audit log failed for successful admin access', { 
        error: auditErr.message 
      });
    }

    next();
  } catch (err) {
    Logger.error('Admin auth error', { 
      error: err.message,
      stack: err.stack,
      userId: req.user?.id 
    });
    
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Authentication error',
        timestamp: new Date().toISOString()
      }
    });
  }
}

// ===== SUPER ADMIN AUTH MIDDLEWARE =====

function superAdminAuth(req, res, next) {
  if (req.user.role !== 'superadmin') {
    Logger.warn('Unauthorized super admin access attempt', {
      userId: req.user.id,
      role: req.user.role,
      endpoint: req.path
    });
    
    // Audit log (fire-and-forget for superadmin - less critical)
    AuditLog.create({
      userId: req.user.id,
      action: 'failed_superadmin_access',
      details: {
        endpoint: req.path,
        role: req.user.role
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      severity: 'warning',
      timestamp: new Date()
    }).catch(err => Logger.error('Superadmin audit log failed', { error: err.message }));
    
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Super admin access required',
        timestamp: new Date().toISOString()
      }
    });
  }
  
  next();
}

module.exports = { adminAuth, superAdminAuth };