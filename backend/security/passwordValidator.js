// ===== Password Validation & Account Lockout =====

const bcrypt = require('bcryptjs');
const { getRedisClient } = require('../redisClient');
const Logger = require('../logger');

// Common weak passwords (top 100)
const commonPasswords = [
  'password', '123456', '12345678', 'qwerty', 'abc123',
  'password123', 'admin', 'letmein', 'welcome', 'monkey',
  'dragon', 'master', 'sunshine', 'princess', 'shadow',
  '123123', '1q2w3e4r', 'passw0rd', 'admin123', 'root',
  'toor', 'pass', 'test', 'guest', 'info',
  'webmaster', 'null', 'god', 'love', 'sex',
  'secret', 'sexy', 'soccer', 'summer', 'sweet',
  'system', 'teacher', 'telephone', 'tennis', 'texas',
  'thank', 'thanks', 'that', 'thats', 'theme',
  'there', 'these', 'they', 'thing', 'think',
  'this', 'thomas', 'those', 'though', 'thought',
  'three', 'threw', 'throw', 'thrown', 'trust',
  'truth', 'trying', 'tunnel', 'turn', 'turtle',
  'twelve', 'twenty', 'twice', 'twin', 'twist',
  'two', 'type', 'typical', 'ugly', 'unable'
];

// Password validation result
const PasswordValidator = {
  // Validate password strength
  validate: (password) => {
    const errors = [];
    const minLength = 8;
    const maxLength = 72; // BCrypt silently truncates beyond 72 chars

    if (!password) {
      errors.push('Password is required');
      return { isValid: false, errors, score: 0 };
    }

    if (password.length < minLength) {
      errors.push(`Password must be at least ${minLength} characters`);
    }

    if (password.length > maxLength) {
      errors.push(`Password must not exceed ${maxLength} characters`);
    }

    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (!/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    // Check against common passwords
    if (commonPasswords.includes(password.toLowerCase())) {
      errors.push('Password is too common. Please choose a stronger password');
    }

    // Calculate password strength score
    let score = 0;
    if (password.length >= minLength) score += 20;
    if (password.length >= 12) score += 10;
    if (/[A-Z]/.test(password)) score += 15;
    if (/[a-z]/.test(password)) score += 15;
    if (/\d/.test(password)) score += 15;
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score += 25;

    return {
      isValid: errors.length === 0,
      errors,
      score: Math.min(100, score),
      strength: score >= 80 ? 'strong' : score >= 60 ? 'medium' : 'weak'
    };
  },

  // Hash password
  hash: async (password) => {
    try {
      const salt = await bcrypt.genSalt(10);
      return await bcrypt.hash(password, salt);
    } catch (err) {
      Logger.error('Password hash error', { error: err.message });
      throw new Error('Failed to hash password');
    }
  },

  // Compare password
  compare: async (plainPassword, hashedPassword) => {
    try {
      return await bcrypt.compare(plainPassword, hashedPassword);
    } catch (err) {
      Logger.error('Password compare error', { error: err.message });
      throw new Error('Failed to compare password');
    }
  }
};

const AccountLockout = {
  config: {
    maxAttempts: 5,
    lockoutDurationMinutes: 15,
    attemptWindowMinutes: 30
  },

  // Generate Redis key for login attempts
  getAttemptsKey: (userId) => `login_attempts:${userId}`,
  getLockedKey: (userId) => `locked:${userId}`,

  // Record failed login attempt
  recordFailedAttempt: async (userId) => {
    try {
      const redis = getRedisClient();
      const attemptsKey = AccountLockout.getAttemptsKey(userId);
      const lockedKey = AccountLockout.getLockedKey(userId);

      // Increment attempts
      const attempts = await redis.incr(attemptsKey);

      // Set expiry on first attempt
      if (attempts === 1) {
        await redis.expire(
          attemptsKey,
          AccountLockout.config.attemptWindowMinutes * 60
        );
      }

      Logger.warn('Failed login attempt recorded', { userId, attempts });

      // Check if should be locked
      if (attempts >= AccountLockout.config.maxAttempts) {
        await redis.setEx(
          lockedKey,
          AccountLockout.config.lockoutDurationMinutes * 60,
          'locked'
        );

        Logger.warn('Account locked due to failed attempts', {
          userId,
          attempts,
          lockoutMinutes: AccountLockout.config.lockoutDurationMinutes
        });

        return {
          locked: true,
          attempts,
          lockoutMinutes: AccountLockout.config.lockoutDurationMinutes
        };
      }

      return {
        locked: false,
        attempts,
        remainingAttempts: AccountLockout.config.maxAttempts - attempts
      };
    } catch (err) {
      Logger.error('Failed to record login attempt', { userId, error: err.message });
      throw err;
    }
  },

  // Check if account is locked
  isLocked: async (userId) => {
    try {
      const redis = getRedisClient();
      const lockedKey = AccountLockout.getLockedKey(userId);
      return await redis.exists(lockedKey) > 0;
    } catch (err) {
      Logger.error('Failed to check account lock', { userId, error: err.message });
      throw err;
    }
  },

  // Get remaining lock time (in seconds)
  getRemainingLockTime: async (userId) => {
    try {
      const redis = getRedisClient();
      const lockedKey = AccountLockout.getLockedKey(userId);
      const ttl = await redis.ttl(lockedKey);
      return ttl > 0 ? ttl : 0;
    } catch (err) {
      Logger.error('Failed to get lock time', { userId, error: err.message });
      throw err;
    }
  },

  // Get failed attempts count
  getFailedAttempts: async (userId) => {
    try {
      const redis = getRedisClient();
      const attemptsKey = AccountLockout.getAttemptsKey(userId);
      const attempts = await redis.get(attemptsKey);
      return attempts ? parseInt(attempts) : 0;
    } catch (err) {
      Logger.error('Failed to get attempts', { userId, error: err.message });
      throw err;
    }
  },

  // Clear failed attempts (successful login)
  clearFailedAttempts: async (userId) => {
    try {
      const redis = getRedisClient();
      const attemptsKey = AccountLockout.getAttemptsKey(userId);
      await redis.del(attemptsKey);
      Logger.info('Failed attempts cleared', { userId });
    } catch (err) {
      Logger.error('Failed to clear attempts', { userId, error: err.message });
      throw err;
    }
  },

  // Unlock account (admin feature)
  unlock: async (userId) => {
    try {
      const redis = getRedisClient();
      const lockedKey = AccountLockout.getLockedKey(userId);
      const attemptsKey = AccountLockout.getAttemptsKey(userId);
      
      await redis.del(lockedKey);
      await redis.del(attemptsKey);
      
      Logger.info('Account manually unlocked', { userId });
    } catch (err) {
      Logger.error('Failed to unlock account', { userId, error: err.message });
      throw err;
    }
  }
};

module.exports = {
  PasswordValidator,
  AccountLockout
};