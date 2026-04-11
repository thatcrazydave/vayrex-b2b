const { isRedisReady, getRedisClient } = require("../redisClient");
const User = require("../models/User");
const Logger = require("../logger");

const CACHE_TTL = 300; // 5 minutes
const CACHE_PREFIX = "usercache:";

/**
 * Get a user by ID, checking Redis cache first.
 * Falls through to MongoDB on cache miss or Redis failure.
 * Returns a plain JS object (not a Mongoose document).
 */
async function getCachedUser(userId) {
  if (isRedisReady()) {
    try {
      const redis = getRedisClient();
      const cached = await redis.get(`${CACHE_PREFIX}${userId}`);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      Logger.warn("Redis cache read failed, falling through to MongoDB", {
        userId,
        error: err.message,
      });
    }
  }

  const user = await User.findById(userId).select("-password").lean();

  if (user && isRedisReady()) {
    try {
      const redis = getRedisClient();
      await redis.set(`${CACHE_PREFIX}${userId}`, JSON.stringify(user), { EX: CACHE_TTL });
    } catch (err) {
      Logger.warn("Redis cache write failed", { userId, error: err.message });
    }
  }

  return user;
}

/**
 * Invalidate a user's cache entry. Call this whenever a user document is modified.
 */
async function invalidateUserCache(userId) {
  if (!isRedisReady()) return;

  try {
    const redis = getRedisClient();
    await redis.del(`${CACHE_PREFIX}${userId}`);
  } catch (err) {
    Logger.warn("Redis cache invalidation failed", { userId, error: err.message });
  }
}

module.exports = { getCachedUser, invalidateUserCache };
