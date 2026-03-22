const { isRedisReady, getRedisClient } = require('../redisClient');
const Logger = require('../logger');
const User = require('../models/User');

const LOCKOUT_CONFIG = {
  maxAttempts: 5,
  lockoutDurationMs: 15 * 60 * 1000,
  attemptWindowMs: 15 * 60 * 1000,
  permanentLockThreshold: 20
};

// Fallback when Redis is unavailable
const inMemoryAttempts = new Map();
const inMemoryBlocks = new Map();

// ===== HELPER: Get Real IP =====
function getRealIP(req) {
  // req.ip is resolved by Express trust proxy setting
  if (req.ip && req.ip !== '::1' && req.ip !== '127.0.0.1') {
    return req.ip;
  }

  const trustedProxies = process.env.TRUSTED_PROXIES?.split(',') || [];
  if (trustedProxies.length > 0 && req.headers['x-forwarded-for']) {
    const forwardedIPs = req.headers['x-forwarded-for'].split(',').map(ip => ip.trim());
    return forwardedIPs[0];
  }

  // For tunnel setups (ngrok): use X-Forwarded-For for distinct client IPs
  if (req.headers['x-forwarded-for']) {
    const forwardedIPs = req.headers['x-forwarded-for'].split(',').map(ip => ip.trim());
    if (forwardedIPs[0] && forwardedIPs[0] !== '127.0.0.1' && forwardedIPs[0] !== '::1') {
      return forwardedIPs[0];
    }
  }

  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
}

// ===== HELPER: Create unique identifier (IP + Email) =====
function createLockoutKey(ip, identifier) {
  return `${ip}:${identifier}`;
}

async function getFailedAttempts(identifier, req) {
  const ip = getRealIP(req);
  const key = `login_attempts:${createLockoutKey(ip, identifier)}`;

  try {
    if (isRedisReady()) {
      const redis = getRedisClient();
      const attempts = await redis.get(key);
      return attempts ? parseInt(attempts) : 0;
    } else {
      const entry = inMemoryAttempts.get(key);
      if (!entry) return 0;

      if (Date.now() > entry.expiresAt) {
        inMemoryAttempts.delete(key);
        return 0;
      }

      return entry.count;
    }
  } catch (err) {
    return 0;
  }
}

async function incrementFailedAttempts(identifier, req) {
  const ip = getRealIP(req);
  const key = `login_attempts:${createLockoutKey(ip, identifier)}`;

  try {
    if (isRedisReady()) {
      const redis = getRedisClient();
      const count = await redis.incr(key);

      if (count === 1) {
        await redis.expire(key, Math.ceil(LOCKOUT_CONFIG.attemptWindowMs / 1000));
      }

      return count;
    } else {
      const entry = inMemoryAttempts.get(key);
      const now = Date.now();

      if (!entry || now > entry.expiresAt) {
        inMemoryAttempts.set(key, {
          count: 1,
          expiresAt: now + LOCKOUT_CONFIG.attemptWindowMs
        });
        return 1;
      }

      entry.count++;
      return entry.count;
    }
  } catch (err) {
    return 0;
  }
}

async function clearFailedAttempts(identifier, req) {
  const ip = getRealIP(req);
  const key = `login_attempts:${createLockoutKey(ip, identifier)}`;

  try {
    if (isRedisReady()) {
      const redis = getRedisClient();
      await redis.del(key);
    }

    inMemoryAttempts.delete(key);
  } catch (err) {
    // Silent fail
  }
}

async function isLocked(identifier, req) {
  const ip = getRealIP(req);
  const lockKey = `login_locked:${createLockoutKey(ip, identifier)}`;

  try {
    if (isRedisReady()) {
      const redis = getRedisClient();
      const lockedUntil = await redis.get(lockKey);

      if (lockedUntil) {
        const unlockTime = parseInt(lockedUntil);
        if (Date.now() < unlockTime) {
          return {
            locked: true,
            unlockAt: unlockTime,
            remainingMs: unlockTime - Date.now()
          };
        } else {
          await redis.del(lockKey);
          return { locked: false };
        }
      }

      return { locked: false };
    } else {
      const block = inMemoryBlocks.get(lockKey);

      if (!block) return { locked: false };

      if (Date.now() < block.unlockAt) {
        return {
          locked: true,
          unlockAt: block.unlockAt,
          remainingMs: block.unlockAt - Date.now()
        };
      } else {
        inMemoryBlocks.delete(lockKey);
        return { locked: false };
      }
    }
  } catch (err) {
    return { locked: false };
  }
}

async function lockAccount(identifier, req, durationMs = LOCKOUT_CONFIG.lockoutDurationMs) {
  const ip = getRealIP(req);
  const lockKey = `login_locked:${createLockoutKey(ip, identifier)}`;
  const unlockAt = Date.now() + durationMs;

  Logger.info('Account locked', { identifier, ip, durationMs });

  try {
    if (isRedisReady()) {
      const redis = getRedisClient();
      await redis.setEx(
        lockKey,
        Math.ceil(durationMs / 1000),
        unlockAt.toString()
      );
    }

    inMemoryBlocks.set(lockKey, { unlockAt });
  } catch (err) {
   Logger.error('Error locking account', { error: err.message });
  }
}

// Middleware to check if account is locked before processing login
async function checkAccountLockout(req, res, next) {
  try {
    const { emailOrUsername, username, email } = req.body;
    const identifier = emailOrUsername || username || email;

    if (!identifier) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_IDENTIFIER',
          message: 'Email or username is required',
          timestamp: new Date().toISOString()
        }
      });
    }

    const ip = getRealIP(req);

    // Check lockout for this specific IP+identifier combination
    const lock = await isLocked(identifier.toLowerCase(), req);

    if (lock.locked) {
      const remainingMinutes = Math.ceil(lock.remainingMs / 60000);

      return res.status(423).json({
        success: false,
        error: {
          code: 'ACCOUNT_LOCKED',
          message: `Too many failed login attempts from your location. Try again in ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}.`,
          unlockAt: new Date(lock.unlockAt).toISOString(),
          remainingMinutes,
          timestamp: new Date().toISOString()
        }
      });
    }

    req.loginIdentifier = identifier.toLowerCase();
    req.loginIp = ip;

    next();
  } catch (err) {
    next();
  }
}

async function handleFailedLogin(identifier, req) {
  try {
    const attempts = await incrementFailedAttempts(identifier, req);

    // Lock if threshold exceeded
    if (attempts >= LOCKOUT_CONFIG.maxAttempts) {
      await lockAccount(identifier, req, LOCKOUT_CONFIG.lockoutDurationMs);
    }

    return {
      attempts,
      remainingAttempts: Math.max(0, LOCKOUT_CONFIG.maxAttempts - attempts)
    };
  } catch (err) {
    return { attempts: 0, remainingAttempts: LOCKOUT_CONFIG.maxAttempts };
  }
}

async function handleSuccessfulLogin(identifier, req) {
  try {
    await clearFailedAttempts(identifier, req);
  } catch (err) {
    Logger.error('Error clearing failed login attempts', { error: err.message });
  }
}

// Get current lockout status for admin endpoints
async function getLockoutStatus(identifier, req) {
  try {
    const [attempts, lockStatus] = await Promise.all([
      getFailedAttempts(identifier, req),
      isLocked(identifier, req)
    ]);

    return {
      failedAttempts: attempts,
      maxAttempts: LOCKOUT_CONFIG.maxAttempts,
      remainingAttempts: Math.max(0, LOCKOUT_CONFIG.maxAttempts - attempts),
      isLocked: lockStatus.locked,
      unlockAt: lockStatus.locked ? new Date(lockStatus.unlockAt).toISOString() : null,
      remainingMinutes: lockStatus.locked ? Math.ceil(lockStatus.remainingMs / 60000) : 0
    };
  } catch (err) {
    return null;
  }
}

// Admin function to manually unlock account
async function unlockAccount(identifier, req) {
  try {
    const ip = req ? getRealIP(req) : 'unknown';
    const lockKey = `login_locked:${createLockoutKey(ip, identifier)}`;
    
    await clearFailedAttempts(identifier, req);
    
    if (isRedisReady()) {
      const redis = getRedisClient();
      await redis.del(lockKey);
    }
    inMemoryBlocks.delete(lockKey);

    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  checkAccountLockout,
  handleFailedLogin,
  handleSuccessfulLogin,
  getLockoutStatus,
  unlockAccount,
  LOCKOUT_CONFIG
};
