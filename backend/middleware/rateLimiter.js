const { isRedisReady, getRedisClient } = require('../redisClient');
const Logger = require('../logger');
const rateLimitConfig = require('../config/rateLimitConfig');

// ===== IN-MEMORY FALLBACK STORE (Cluster-Safe) =====
const inMemoryStore = new Map();
let lastCleanup = Date.now();
let isCleaningUp = false;

// ===== HELPER: Get Real IP (Fix #1: IP Spoofing) =====
function getRealIP(req) {
  // When trust proxy is enabled (app.set('trust proxy', 1)),
  // Express already resolves req.ip from X-Forwarded-For correctly.
  // This handles ngrok, load balancers, and reverse proxies automatically.
  
  // req.ip is already resolved by Express trust proxy setting
  if (req.ip && req.ip !== '::1' && req.ip !== '127.0.0.1') {
    return req.ip;
  }

  // If TRUSTED_PROXIES is explicitly set, use X-Forwarded-For
  const trustedProxies = process.env.TRUSTED_PROXIES?.split(',') || [];
  if (trustedProxies.length > 0 && req.headers['x-forwarded-for']) {
    const forwardedIPs = req.headers['x-forwarded-for'].split(',').map(ip => ip.trim());
    return forwardedIPs[0];
  }

  // For ngrok/tunnel setups: always check X-Forwarded-For even without TRUSTED_PROXIES
  // because ngrok sets this header and we need distinct IPs per user
  if (req.headers['x-forwarded-for']) {
    const forwardedIPs = req.headers['x-forwarded-for'].split(',').map(ip => ip.trim());
    if (forwardedIPs[0] && forwardedIPs[0] !== '127.0.0.1' && forwardedIPs[0] !== '::1') {
      return forwardedIPs[0];
    }
  }

  // Fallback to direct connection IP
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
}

// ===== HELPER: Normalize Path (Fix #2: Path Normalization) =====
function normalizePath(path) {
  return path
    .split('?')[0]
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/\/+/g, '/')
    || '/';
}

// ===== HELPER: Cleanup Old Entries (Fix #15: Memory Attack) =====
function cleanupInMemoryStore() {
  const now = Date.now();

  // Prevent concurrent cleanup (Fix #5: Race condition)
  if (isCleaningUp) return;
  if (now - lastCleanup < 60000) return;

  isCleaningUp = true;

  try {
    let removed = 0;
    const entries = Array.from(inMemoryStore.entries());

    for (const [key, data] of entries) {
      // Remove expired entries
      if (now > data.resetTime) {
        inMemoryStore.delete(key);
        removed++;
      }
    }

    lastCleanup = now;

    if (removed > 0) {
      Logger.info('In-memory rate limit cleanup', {
        removed,
        remaining: inMemoryStore.size
      });
    }

    // Hard limit on memory (Fix #15)
    if (inMemoryStore.size > rateLimitConfig.inMemory.maxEntries) {
      const keysToRemove = Array.from(inMemoryStore.keys())
        .slice(0, Math.ceil(rateLimitConfig.inMemory.maxEntries * 0.1)); // Remove oldest 10%

      keysToRemove.forEach(k => inMemoryStore.delete(k));

      Logger.warn('In-memory store size limit reached, pruned entries', {
        removed: keysToRemove.length,
        remaining: inMemoryStore.size
      });
    }
  } finally {
    isCleaningUp = false;
  }
}

// ===== HELPER: Get Rate Limit Config (Fix #7: Prefix Match Bug) =====
const getConfig = (endpoint) => {
  const normalizedEndpoint = normalizePath(endpoint);

  // Check for exact match first
  if (rateLimitConfig[normalizedEndpoint]) {
    return rateLimitConfig[normalizedEndpoint];
  }

  // Check for prefix match with EXACT path segments (Fix #7)
  const configPaths = Object.keys(rateLimitConfig)
    .filter(path => path !== 'default' && path !== 'inMemory')
    .sort((a, b) => b.length - a.length); // Longest match first

  for (const configPath of configPaths) {
    const normalizedConfigPath = normalizePath(configPath);

    // Only match if it's a path segment boundary
    // /api/admin matches /api/admin/users but NOT /api/administrator
    if (normalizedEndpoint === normalizedConfigPath ||
      normalizedEndpoint.startsWith(normalizedConfigPath + '/')) {
      return rateLimitConfig[configPath];
    }
  }

  return rateLimitConfig.default;
};

// ===== ROUTES: Authenticated endpoints that use user-ID rate limiting =====
// These are the routes where individual users should have their own independent quotas.
// Unauthenticated routes (auth, health) remain IP-based for DDoS/brute-force protection.
const AUTHENTICATED_ROUTE_PREFIXES = [
  '/api/ai/',
  '/api/upload/',
  '/api/user/',
  '/api/questions/',
  '/api/admin/'
];

function isAuthenticatedRoute(path) {
  const normalizedPath = normalizePath(path);
  return AUTHENTICATED_ROUTE_PREFIXES.some(prefix => normalizedPath.startsWith(prefix));
}

// ===== HELPER: Generate Redis Key =====
// Authenticated routes: key by User+IP (each device gets its own bucket per user)
// Unauthenticated routes: key by IP (security against brute force)
const generateKey = (ip, endpoint, userId = null) => {
  const cleanEndpoint = normalizePath(endpoint);

  if (userId && isAuthenticatedRoute(endpoint)) {
    // Per-user-per-IP key: same user on different devices = independent limits
    // This prevents one device's heavy usage from blocking other devices
    return `rateLimit:user:${userId}:ip:${ip}:${cleanEndpoint}`;
  }

  // Per-IP key: for public/unauthenticated routes
  return `rateLimit:ip:${ip}:${cleanEndpoint}`;
};

// ===== IN-MEMORY RATE LIMITER - SLIDING WINDOW =====
async function inMemoryRateLimiter(key, config) {
  cleanupInMemoryStore();

  const now = Date.now();
  const entry = inMemoryStore.get(key);

  if (!entry) {
    // First request
    inMemoryStore.set(key, {
      requests: [now],
      blockedUntil: null
    });

    return {
      allowed: true,
      count: 1,
      limit: config.maxRequests,
      remaining: config.maxRequests - 1,
      resetTime: now + config.windowMs
    };
  }

  // Check if blocked (Fix #5: Block key synchronized)
  if (entry.blockedUntil && now < entry.blockedUntil) {
    return {
      allowed: false,
      count: entry.requests.length,
      limit: config.maxRequests,
      remaining: 0,
      resetTime: entry.blockedUntil,
      blocked: true
    };
  }

  // Clear block if expired
  if (entry.blockedUntil && now >= entry.blockedUntil) {
    entry.blockedUntil = null;
    entry.requests = [];
  }

  // Sliding window: Remove old requests
  const windowStart = now - config.windowMs;
  entry.requests = entry.requests.filter(timestamp => timestamp > windowStart);

  // Add current request
  entry.requests.push(now);

  const count = entry.requests.length;

  // Check if exceeded
  if (count > config.maxRequests) {
    // Block for blockDuration (Fix #12: TTL synchronized)
    entry.blockedUntil = now + (config.blockDuration || config.windowMs);

    Logger.warn('Rate limit exceeded (in-memory)', {
      key,
      count,
      limit: config.maxRequests,
      blockedUntil: new Date(entry.blockedUntil).toISOString()
    });

    return {
      allowed: false,
      count,
      limit: config.maxRequests,
      remaining: 0,
      resetTime: entry.blockedUntil,
      blocked: true
    };
  }

  // Reset time is when oldest request expires
  const oldestRequest = entry.requests[0];
  const resetTime = oldestRequest + config.windowMs;

  return {
    allowed: true,
    count,
    limit: config.maxRequests,
    remaining: config.maxRequests - count,
    resetTime
  };
}

// ===== REDIS RATE LIMITER - ATOMIC SLIDING WINDOW (Fix #4, #11) =====
async function redisRateLimiter(redis, key, config) {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  //  FIX #4/#11: ATOMIC OPERATION using Lua script
  const luaScript = `
    local key = KEYS[1]
    local blockKey = KEYS[2]
    local now = tonumber(ARGV[1])
    local windowStart = tonumber(ARGV[2])
    local maxRequests = tonumber(ARGV[3])
    local windowMs = tonumber(ARGV[4])
    local blockDuration = tonumber(ARGV[5])
    
    -- Check if blocked
    local blockedUntil = redis.call('GET', blockKey)
    if blockedUntil and tonumber(blockedUntil) > now then
      return {0, tonumber(blockedUntil), maxRequests + 1}
    end
    
    -- Remove old entries (sliding window)
    redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
    
    -- Count current requests
    local count = redis.call('ZCARD', key)
    
    -- Check if would exceed limit
    if count >= maxRequests then
      -- Block user
      local blockUntil = now + blockDuration
      redis.call('SETEX', blockKey, math.ceil(blockDuration / 1000), tostring(blockUntil))
      return {0, blockUntil, count + 1}
    end
    
    -- Add current request (ATOMIC: count checked, then add)
    redis.call('ZADD', key, now, tostring(now) .. ':' .. tostring(math.random()))
    
    -- Set expiry (Fix #12: synchronized TTL)
    redis.call('EXPIRE', key, math.ceil(windowMs / 1000) * 2)
    redis.call('EXPIRE', blockKey, math.ceil(blockDuration / 1000))
    
    -- Get oldest request timestamp for reset time
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local resetTime
    if #oldest > 0 then
      resetTime = tonumber(oldest[2]) + windowMs
    else
      resetTime = now + windowMs
    end
    
    return {1, resetTime, count + 1}
  `;

  const blockKey = `${key}:blocked`;

  try {
    // Execute atomic Lua script
    const result = await redis.eval(luaScript, {
      keys: [key, blockKey],
      arguments: [
        now.toString(),
        windowStart.toString(),
        config.maxRequests.toString(),
        config.windowMs.toString(),
        (config.blockDuration || config.windowMs).toString()
      ]
    });

    const [allowed, resetTime, count] = result;

    if (!allowed) {
      Logger.warn('Rate limit exceeded (Redis)', {
        key,
        count,
        limit: config.maxRequests,
        blockedUntil: new Date(resetTime).toISOString()
      });

      return {
        allowed: false,
        count,
        limit: config.maxRequests,
        remaining: 0,
        resetTime,
        blocked: true
      };
    }

    return {
      allowed: true,
      count,
      limit: config.maxRequests,
      remaining: Math.max(0, config.maxRequests - count),
      resetTime
    };
  } catch (err) {
    Logger.error('Redis Lua script error', { error: err.message, key });
    throw err; // Let caller handle fallback
  }
}

// ===== MAIN RATE LIMITER MIDDLEWARE =====
const rateLimiter = async (req, res, next) => {
  try {
    const normalizedPath = normalizePath(req.path);
    const config = getConfig(normalizedPath);

    // Get real client IP (Fix #1: IP Spoofing)
    const ip = getRealIP(req);
    const userId = req.user?.id?.toString() || null;

    // Key strategy: user+IP for authenticated routes, IP for public routes
    const key = generateKey(ip, normalizedPath, userId);

    Logger.debug('Rate limit check', {
      path: normalizedPath,
      ip,
      userId: userId || 'anonymous',
      key,
      keyType: userId && isAuthenticatedRoute(normalizedPath) ? 'user+ip' : 'ip-only',
      maxRequests: config.maxRequests
    });

    let result;

    // Try Redis first
    if (isRedisReady()) {
      try {
        const redis = getRedisClient();
        result = await redisRateLimiter(redis, key, config);
      } catch (redisErr) {
        Logger.warn('Redis rate limit check failed, using in-memory fallback', {
          error: redisErr.message,
          endpoint: normalizedPath
        });

        // Use endpoint-specific config if available, fallback to defaults ONLY if config is missing
        result = await inMemoryRateLimiter(key, {
          maxRequests: config.maxRequests || rateLimitConfig.inMemory.defaultMaxRequests,
          windowMs: config.windowMs || rateLimitConfig.inMemory.defaultWindowMs,
          message: config.message,
          blockDuration: config.blockDuration
        });
      }
    } else {
      // Redis not ready, use in-memory
      result = await inMemoryRateLimiter(key, {
        maxRequests: config.maxRequests || rateLimitConfig.inMemory.defaultMaxRequests,
        windowMs: config.windowMs || rateLimitConfig.inMemory.defaultWindowMs,
        message: config.message,
        blockDuration: config.blockDuration
      });
    }

    // Set rate limit headers (Fix #13: Optional hiding)
    const hideHeaders = process.env.HIDE_RATE_LIMIT_HEADERS === 'true';

    if (!hideHeaders) {
      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);

      // Only send valid reset time (Fix TTL -1)
      if (result.resetTime && result.resetTime > Date.now()) {
        res.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());
      }

      if (result.blocked) {
        res.setHeader('X-RateLimit-Blocked-Until', new Date(result.resetTime).toISOString());
      }
    } else {
      // Production: Only show Retry-After when blocked
      if (result.blocked) {
        res.setHeader('Retry-After', Math.ceil((result.resetTime - Date.now()) / 1000));
      }
    }

    // Block request if not allowed
    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);

      return res.status(429).json({
        success: false,
        error: {
          code: result.blocked ? 'RATE_LIMIT_BLOCKED' : 'RATE_LIMIT_EXCEEDED',
          message: result.blocked
            ? `Too many failed attempts. You are temporarily blocked. Try again in ${Math.ceil(retryAfter / 60)} minutes`
            : config.message,
          retryAfter,
          blockedUntil: result.blocked ? new Date(result.resetTime).toISOString() : undefined,
          timestamp: new Date().toISOString()
        }
      });
    }

    next();
  } catch (err) {
    // NEVER fail open (critical security principle)
    Logger.error('Rate limiter critical error', {
      error: err.message,
      stack: err.stack,
      endpoint: req.path,
      ip: getRealIP(req)
    });

    return res.status(503).json({
      success: false,
      error: {
        code: 'RATE_LIMITER_ERROR',
        message: 'Rate limiting service temporarily unavailable. Please try again in a moment',
        timestamp: new Date().toISOString()
      }
    });
  }
};

// ===== ENDPOINT-SPECIFIC RATE LIMITER =====
const createEndpointLimiter = (maxRequests, windowMs, message) => {
  return async (req, res, next) => {
    const customConfig = {
      maxRequests,
      windowMs,
      message: message || 'Too many requests. Please try again later',
      blockDuration: windowMs * 2
    };

    try {
      const ip = getRealIP(req);
      const userId = req.user?.id?.toString() || null;
      const normalizedPath = normalizePath(req.path);
      const key = generateKey(ip, normalizedPath, userId);

      let result;

      if (isRedisReady()) {
        try {
          const redis = getRedisClient();
          result = await redisRateLimiter(redis, key, customConfig);
        } catch (redisErr) {
          result = await inMemoryRateLimiter(key, customConfig);
        }
      } else {
        result = await inMemoryRateLimiter(key, customConfig);
      }

      // Set headers
      const hideHeaders = process.env.HIDE_RATE_LIMIT_HEADERS === 'true';

      if (!hideHeaders) {
        res.setHeader('X-RateLimit-Limit', result.limit);
        res.setHeader('X-RateLimit-Remaining', result.remaining);

        if (result.resetTime && result.resetTime > Date.now()) {
          res.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());
        }
      }

      if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);

        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: customConfig.message,
            retryAfter,
            timestamp: new Date().toISOString()
          }
        });
      }

      next();
    } catch (err) {
      Logger.error('Endpoint rate limiter error', { error: err.message });

      return res.status(503).json({
        success: false,
        error: {
          code: 'RATE_LIMITER_ERROR',
          message: 'Rate limiting service error',
          timestamp: new Date().toISOString()
        }
      });
    }
  };
};

// ===== UTILITY: Reset Rate Limit =====
const resetUserRateLimit = async (userId, endpoint = null, ip = null) => {
  try {
    const normalizedEndpoint = endpoint ? normalizePath(endpoint) : null;
    const keysToDelete = [];

    if (isRedisReady()) {
      const redis = getRedisClient();

      if (userId) {
        // Reset ALL rate limits for this user (across all IPs and endpoints)
        const userPattern = `rateLimit:user:${userId}:*`;
        const userKeys = await redis.keys(userPattern);
        keysToDelete.push(...userKeys);
      }

      if (ip) {
        // Reset ALL endpoints for this IP
        const ipPattern = `rateLimit:ip:${ip}:*`;
        const ipKeys = await redis.keys(ipPattern);
        keysToDelete.push(...ipKeys);
      }

      if (keysToDelete.length > 0) {
        await redis.del(keysToDelete);
        Logger.info('Rate limit reset (Redis)', {
          userId,
          ip,
          endpoint: normalizedEndpoint,
          keysDeleted: keysToDelete.length
        });
      }
    }

    // Also clear from in-memory store
    for (const [key] of inMemoryStore.entries()) {
      if (ip && key.includes(`ip:${ip}`)) {
        inMemoryStore.delete(key);
      }
      if (userId && key.includes(`user:${userId}`)) {
        inMemoryStore.delete(key);
      }
    }

    Logger.info('Rate limit reset (in-memory)', { userId, ip, endpoint: normalizedEndpoint });
  } catch (err) {
    Logger.error('Failed to reset rate limit', {
      userId,
      ip,
      endpoint: normalizedEndpoint,
      error: err.message
    });
  }
};

module.exports = {
  rateLimiter,
  createEndpointLimiter,
  resetUserRateLimit,
  getRealIP,
  normalizePath
};