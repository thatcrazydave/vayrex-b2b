/**
 * Centralized Rate Limit Configuration
 * All rate limits defined in one place for easy management
 */

// Tier-based rate limit multipliers
const TIER_MULTIPLIERS = {
  free: 1,
  starter: 1.5,
  pro: 3,
  business: 5,
  enterprise: 10
};

// Get tier-aware max requests
function getTierLimit(baseLimit, tier) {
  const multiplier = TIER_MULTIPLIERS[tier] || TIER_MULTIPLIERS.free;
  return Math.ceil(baseLimit * multiplier);
}

module.exports = {
  // Tier multiplier helper
  getTierLimit,
  TIER_MULTIPLIERS,

  // ===== AUTHENTICATION ENDPOINTS (Strictest) =====
  '/api/auth/signup': {
    maxRequests: 10,
    windowMs: 20 * 60 * 1000,
    message: 'Too many signup attempts. Please try again in 20 minutes',
    blockDuration: 30 * 60 * 1000 
  },
  
  '/api/auth/login': {
    maxRequests: 10,
    windowMs: 15 * 60 * 1000,
    message: 'Too many login attempts. Please try again in 15 minutes',
    blockDuration: 30 * 60 * 1000 
  },
  
  '/api/auth/firebase-login': {
    maxRequests: 10,
    windowMs: 15 * 60 * 1000,
    message: 'Too many login attempts. Please try again in 15 minutes',
    blockDuration: 30 * 60 * 1000
  },

  '/api/auth/resend-verification': {
    maxRequests: 3,
    windowMs: 60 * 60 * 1000,
    message: 'Too many verification email requests. Please wait 1 hour before requesting again',
    blockDuration: 2 * 60 * 60 * 1000
  },

  '/api/auth/forgot-password': {
    maxRequests: 3,
    windowMs: 60 * 60 * 1000,
    message: 'Too many password reset requests. Please wait 1 hour before requesting again',
    blockDuration: 2 * 60 * 60 * 1000
  },

  // ===== ADMIN ENDPOINTS (Very Strict) =====
  '/api/admin': {
    maxRequests: 20,
    windowMs: 60 * 1000,
    message: 'Too many admin requests. Please slow down',
    blockDuration: 15 * 60 * 1000
  },

  // ===== CONTACT FORM (Anti-spam) =====
  '/api/contact': {
    maxRequests: 3,
    windowMs: 60 * 60 * 1000,
    message: 'Too many contact submissions. Please try again in 1 hour',
    blockDuration: 24 * 60 * 60 * 1000 
  },

  // ===== UPLOAD ENDPOINTS (Moderate) =====
  '/api/admin/upload': {
    maxRequests: 10,
    windowMs: 60 * 60 * 1000, 
    message: 'Too many uploads. Please try again in 1 hour',
    blockDuration: 2 * 60 * 60 * 1000
  },
  
  '/api/ai/parse-questions': {
    maxRequests: 150,
    windowMs: 15 * 60 * 1000,
    message: 'Too many parsing requests. Please try again in 15 minutes',
    blockDuration: 15 * 60 * 1000
  },

  '/api/ai/generate-from-notes': {
    maxRequests: 150,
    windowMs: 15 * 60 * 1000,
    message: 'Too many AI generation requests. Please try again in 15 minutes',
    blockDuration: 15 * 60 * 1000
  },

  // ===== API ENDPOINTS (Permissive) =====
  '/api/questions': {
    maxRequests: 100,
    windowMs: 60 * 1000,
    message: 'Too many requests. Please try again later',
    blockDuration: 5 * 60 * 1000 
  },
  
  '/api/user/quiz': {
    maxRequests: 50,
    windowMs: 60 * 1000,
    message: 'Too many requests. Please try again later',
    blockDuration: 5 * 60 * 1000
  },

  '/api/user/submit-exam': {
    maxRequests: 30,
    windowMs: 60 * 1000,
    message: 'Too many exam submissions. Please slow down',
    blockDuration: 10 * 60 * 1000
  },

  // ===== DEFAULT (Fallback) =====
  'default': {
    maxRequests: 100,
    windowMs: 60 * 1000,
    message: 'Too many requests. Please try again later',
    blockDuration: 5 * 60 * 1000
  },

  // ===== IN-MEMORY FALLBACK SETTINGS (When Redis Down) =====
  inMemory: {
    enabled: true,
    maxEntries: 10000, 
    cleanupIntervalMs: 60 * 1000, 
    defaultMaxRequests: 50, 
    defaultWindowMs: 60 * 1000
  }
};