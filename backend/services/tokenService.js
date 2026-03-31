// ===== Token Service =====
// Manages token lifecycle, revocation, and validation

const jwt = require('jsonwebtoken');
const { getRedisClient, isRedisReady } = require('../redisClient');
const Logger = require('../logger');

// Validate JWT secrets at module load
if (!process.env.JWT_SECRET) {
  Logger.error('FATAL: JWT_SECRET environment variable is not set');
  throw new Error('JWT_SECRET is required');
}

if (!process.env.JWT_REFRESH_SECRET) {
  Logger.error('FATAL: JWT_REFRESH_SECRET environment variable is not set');
  throw new Error('JWT_REFRESH_SECRET is required for secure token management');
}

if (process.env.JWT_REFRESH_SECRET === process.env.JWT_SECRET) {
  Logger.error('FATAL: JWT_REFRESH_SECRET must be different from JWT_SECRET');
  throw new Error('JWT_REFRESH_SECRET must be different from JWT_SECRET for security');
}

const TokenService = {
  // ===== Generate Tokens =====
  
  /**
   * Generate access token (customizable expiry, default 1 hour)
   * @param {Object} user - User object
   * @param {string} expiresIn - Token expiry (e.g., '15m', '1h')
   */
  generateAccessToken: (user, expiresIn = '1h') => {
    try {
      const jti = require('crypto').randomBytes(16).toString('hex'); // Unique token ID
      return jwt.sign(
        {
          id: user._id,
          email: user.email,
          role: user.role,
          subscriptionTier: user.subscriptionTier,
          tokenVersion: user.tokenVersion || 0,
          jti // Token ID for revocation tracking
        },
        process.env.JWT_SECRET,
        { expiresIn } // Customizable expiry
      );
    } catch (err) {
      Logger.error('Access token generation error', { error: err.message });
      throw err;
    }
  },

  /**
   * Generate refresh token (long-lived, 7 days)
   */
  generateRefreshToken: (user) => {
    try {
      const jti = require('crypto').randomBytes(16).toString('hex'); // Unique token ID
      return jwt.sign(
        {
          id: user._id,
          email: user.email,
          tokenVersion: user.tokenVersion || 0,
          type: 'refresh',
          jti // Token ID for revocation tracking
        },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: '7d' } // Long-lived refresh token
      );
    } catch (err) {
      Logger.error('Refresh token generation error', { error: err.message });
      throw err;
    }
  },

  // ===== Token Revocation =====

  /**
   * Revoke a token by JTI (unique token ID)
   * @param {string} jti - Unique token identifier
   * @param {number} expiresIn - Seconds until expiry (for TTL)
   */
  revokeToken: async (jti, expiresIn = 604800) => {
    try {
      if (!isRedisReady()) {
        Logger.error('Redis not ready, token revocation FAILED - this is a security risk', { jti });
        throw new Error('Token revocation failed: Redis unavailable');
      }

      const client = getRedisClient();
      if (!client) {
        Logger.error('Redis client unavailable, token revocation FAILED', { jti });
        throw new Error('Token revocation failed: Redis client unavailable');
      }
      
      const redisKey = `token:blacklist:jti:${jti}`;
      
      // Set TTL to match token expiry (default 7 days for refresh tokens)
      if (expiresIn > 0) {
        await client.setEx(redisKey, expiresIn, '1');
        Logger.info('Token revoked by JTI', { jti, ttl: expiresIn });
        return true;
      }
      
      return false;
    } catch (err) {
      Logger.error('Token revocation error', { error: err.message, jti });
      return false;
    }
  },

  /**
   * Check if token is revoked by JTI
   * @param {string} jti - Unique token identifier
   */
  isTokenRevoked: async (jti) => {
    try {
      if (!isRedisReady()) {
        Logger.debug('Redis not ready, assuming token not revoked (fail-open)', { jti });
        return false; // If Redis unavailable, allow token (fail-open)
      }

      const client = getRedisClient();
      if (!client) {
        Logger.debug('Redis client unavailable, assuming token not revoked (fail-open)', { jti });
        return false;
      }
      
      const redisKey = `token:blacklist:jti:${jti}`;
      const exists = await client.exists(redisKey);
      
      return exists === 1;
    } catch (err) {
      Logger.error('Token revocation check error', { error: err.message, jti });
      return false; // Fail-open on error
    }
  },

  /**
   * Revoke all tokens for a user (invalidate all sessions)
   */
  revokeAllUserTokens: async (userId) => {
    try {
      if (!isRedisReady()) {
        Logger.warn('Redis not ready, could not revoke all tokens');
        return false;
      }

      const client = getRedisClient();
      const redisKey = `user:token:version:${userId}`;
      
      // Increment token version to invalidate all existing tokens
      await client.incr(redisKey);
      
      Logger.info('All user tokens revoked', { userId });
      return true;
    } catch (err) {
      Logger.error('Error revoking all user tokens', { error: err.message });
      return false;
    }
  },

  /**
   * Get current token version for user
   */
  getTokenVersion: async (userId) => {
    try {
      if (!isRedisReady()) {
        return 0;
      }

      const client = getRedisClient();
      const redisKey = `user:token:version:${userId}`;
      const version = await client.get(redisKey);
      
      return version ? parseInt(version) : 0;
    } catch (err) {
      Logger.error('Error getting token version', { error: err.message });
      return 0;
    }
  },

  /**
   * Validate token version (detects if user's role was changed)
   */
  validateTokenVersion: async (decodedTokenVersion, userId) => {
    try {
      const currentVersion = await TokenService.getTokenVersion(userId);
      
      // If versions don't match, token is invalid
      if (decodedTokenVersion !== currentVersion) {
        Logger.warn('Token version mismatch', { 
          userId, 
          decodedVersion: decodedTokenVersion, 
          currentVersion 
        });
        return false;
      }
      
      return true;
    } catch (err) {
      Logger.error('Token version validation error', { error: err.message });
      return false;
    }
  },

  // ===== Token Verification =====

  /**
   * Verify access token
   */
  verifyAccessToken: (token) => {
    try {
      return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new Error('Access token expired');
      }
      throw new Error('Invalid access token');
    }
  },

  /**
   * Verify refresh token
   */
  verifyRefreshToken: (token) => {
    try {
      return jwt.verify(
        token,
        process.env.JWT_REFRESH_SECRET,
        { algorithms: ['HS256'] }
      );
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new Error('Refresh token expired');
      }
      throw new Error('Invalid refresh token');
    }
  }
};

module.exports = TokenService;
