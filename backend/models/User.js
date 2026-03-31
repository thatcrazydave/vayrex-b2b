const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Logger = require("../logger");

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },

  username: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },

  password: {
    type: String,
    required: function () { return !this.firebaseUid; },
    select: false
  },

  firebaseUid: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },

  provider: {
    type: String,
    enum: ['email', 'firebase', 'google'],
    default: 'email'
  },

  fullname: {
    type: String,
    required: true,
    trim: true
  },

  photoURL: String,

  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  updatedAt: {
    type: Date,
    default: Date.now
  },

  // Admin role for admin panel access
  role: {
    type: String,
    enum: ['user', 'admin', 'superadmin'],
    default: 'user',
    index: true
  },

  // Subscription tier for feature limits
  subscriptionTier: {
    type: String,
    enum: ['free', 'starter', 'pro'],
    default: 'free',
    index: true
  },

  subscriptionStatus: {
    type: String,
    enum: ['active', 'inactive', 'trial', 'cancelled', 'expired', 'past_due'],
    default: 'active',
    index: true
  },

  subscriptionStartDate: {
    type: Date,
    default: Date.now
  },

  subscriptionExpiry: {
    type: Date,
    default: null
  },

  // Payment tracking for Paystack
  paystackCustomerId: {
    type: String,
    sparse: true,
    index: true
  },

  paystackSubscriptionCode: {
    type: String,
    sparse: true
  },

  paystackAuthorizationCode: {
    type: String,
    sparse: true
  },

  // Usage tracking
  usage: {
    uploadsThisMonth: { type: Number, default: 0 },
    uploadsToday: { type: Number, default: 0 },
    lastDailyReset: { type: Date, default: Date.now },
    storageUsedMB: { type: Number, default: 0 },
    tokensUsedThisMonth: { type: Number, default: 0 },
    questionsGenerated: { type: Number, default: 0 },
    quizzesTaken: { type: Number, default: 0 },
    lastResetDate: { type: Date, default: Date.now }
  },

  // Tier limits — no hardcoded defaults, set live from DB via pre-save hook
  limits: {
    uploadsPerDay: { type: Number },
    uploadsPerMonth: { type: Number },
    filesPerUpload: { type: Number },
    maxFileSizeMB: { type: Number },
    maxStorageMB: { type: Number },
    questionsPerUpload: { type: Number },
    tokensPerMonth: { type: Number },
    tokensPerRequest: { type: Number },
    maxChatHistory: { type: Number },
    pdfExport: { type: Boolean },
    noteSummary: { type: Boolean },
    priorityProcessing: { type: Boolean },
    revealsPerQuiz: { type: Number },
    aiModel: { type: String, default: 'gpt-5-mini-2025-08-07' }
  },

  // User preferences (single definition - DO NOT duplicate)
  preferences: {
    defaultDifficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      default: 'medium'
    },
    emailNotifications: { type: Boolean, default: true },
    weeklyReports: { type: Boolean, default: false },
    marketingEmails: { type: Boolean, default: false },
    systemAlerts: { type: Boolean, default: true }   // Only relevant for admins
  },

  // Account status
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },

  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },

  deletedAt: Date,

  lastLogin: {
    type: Date,
    index: true
  },

  // Token versioning for immediate role/permission changes
  // Increment this field to invalidate all existing tokens
  tokenVersion: {
    type: Number,
    default: 0
  },

  loginAttempts: {
    type: Number,
    default: 0
  },

  lockUntil: Date,

  emailVerified: {
    type: Boolean,
    default: false
  },

  emailVerificationToken: String,
  emailVerificationExpires: Date,
  emailVerificationCode: String,
  emailVerificationCodeExpires: Date,

  passwordResetToken: String,
  passwordResetExpires: Date,
  passwordResetCode: String,
  passwordResetCodeExpires: Date
});

// Pre-save: Auto-set limits from LIVE PricingConfig (admin dashboard)
userSchema.pre('save', async function () {
  if (this.isModified('subscriptionTier') || this.isNew) {
    try {
      const PricingConfig = require('./PricingConfig');
      const config = await PricingConfig.getConfig();
      const tier = this.subscriptionTier || 'free';
      const liveLimits = config?.tiers?.[tier]?.limits;
      if (liveLimits && typeof liveLimits === 'object') {
        this.limits = { ...liveLimits, aiModel: this.limits?.aiModel || (tier === 'free' ? 'gpt-5-mini-2025-08-07' : 'gpt-5.1-2025-11-13') };
      }
    } catch (err) {
      // Fallback to seed data if DB is unavailable (e.g. first boot)
      const { CANONICAL_TIERS } = require('./PricingConfig');
      const tier = this.subscriptionTier || 'free';
      const fallback = CANONICAL_TIERS[tier]?.limits;
      if (fallback) {
        this.limits = { ...fallback, aiModel: tier === 'free' ? 'gpt-5-mini-2025-08-07' : 'gpt-5.1-2025-11-13' };
      }
    }
  }

  if (this.username) {
    this.username = this.username.toLowerCase();
  }
  if (this.email) {
    this.email = this.email.toLowerCase();
  }

  this.updatedAt = new Date();
});

// Pre-save: Hash password
userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) {
    return next();
  }

  // SECURITY: Detect already-hashed passwords to prevent double hashing
  // Bcrypt hashes always start with $2a$, $2b$, or $2y$ and are 60 chars long
  const bcryptHashPattern = /^\$2[aby]\$\d{2}\$/;
  if (bcryptHashPattern.test(this.password) && this.password.length === 60) {
    Logger.warn('Attempted to hash an already-hashed password', {
      userId: this._id,
      emailPreview: this.email?.substring(0, 3) + '***'
    });
    // Password is already hashed, skip hashing
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Check if user has reached upload limit (daily for free, monthly for paid)
userSchema.methods.hasReachedUploadLimit = function () {
  // Check daily limit (for free tier)
  if (this.limits.uploadsPerDay !== -1) {
    // Auto-reset daily count if it's a new day
    const now = new Date();
    const lastReset = this.usage.lastDailyReset ? new Date(this.usage.lastDailyReset) : new Date(0);
    if (now.toDateString() !== lastReset.toDateString()) {
      this.usage.uploadsToday = 0;
      this.usage.lastDailyReset = now;
    }
    if (this.usage.uploadsToday >= this.limits.uploadsPerDay) return true;
  }
  // Check monthly limit
  if (this.limits.uploadsPerMonth === -1) return false;
  return this.usage.uploadsThisMonth >= this.limits.uploadsPerMonth;
};

// Get next daily reset time (midnight UTC)
userSchema.methods.getNextDailyReset = function () {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return tomorrow;
};

// Get next monthly reset time (1st of next month at midnight UTC)
userSchema.methods.getNextMonthlyReset = function () {
  const now = new Date();
  const nextMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0);
  return nextMonth;
};

// Check if user has enough storage
userSchema.methods.hasStorageSpace = function (fileSizeMB) {
  if (this.limits.maxStorageMB === -1) return true;
  return (this.usage.storageUsedMB + fileSizeMB) <= this.limits.maxStorageMB;
};

// Check if file size is within limit
userSchema.methods.isFileSizeAllowed = function (fileSizeMB) {
  return fileSizeMB <= this.limits.maxFileSizeMB;
};

// Check if user has enough tokens for a request
userSchema.methods.hasTokensAvailable = function (estimatedTokens) {
  if (this.limits.tokensPerMonth === -1) return true;
  return (this.usage.tokensUsedThisMonth + estimatedTokens) <= this.limits.tokensPerMonth;
};

// Check if request token count is within per-request limit
userSchema.methods.isTokenCountAllowed = function (tokenCount) {
  return tokenCount <= this.limits.tokensPerRequest;
};

// Increment upload count (atomic operation - tracks both daily and monthly)
userSchema.methods.incrementUploadCount = async function () {
  const result = await mongoose.model('User').findByIdAndUpdate(
    this._id,
    { $inc: { 'usage.uploadsThisMonth': 1, 'usage.uploadsToday': 1 } },
    { new: true, select: 'usage.uploadsThisMonth usage.uploadsToday' }
  );
  this.usage.uploadsThisMonth = result.usage.uploadsThisMonth;
  this.usage.uploadsToday = result.usage.uploadsToday;
  return this.usage.uploadsThisMonth;
};

// Add storage usage (atomic check-and-increment to prevent TOCTOU race)
userSchema.methods.addStorageUsage = async function (fileSizeMB) {
  const query = { _id: this._id };
  // If there's a storage limit, enforce it atomically
  if (this.limits.maxStorageMB !== -1) {
    query['usage.storageUsedMB'] = { $lte: this.limits.maxStorageMB - fileSizeMB };
  }
  const result = await mongoose.model('User').findOneAndUpdate(
    query,
    { $inc: { 'usage.storageUsedMB': fileSizeMB } },
    { new: true, select: 'usage.storageUsedMB' }
  );
  if (!result) {
    throw new Error('Insufficient storage space');
  }
  this.usage.storageUsedMB = result.usage.storageUsedMB;
  return this.usage.storageUsedMB;
};

// Reduce storage usage when file deleted (atomic operation to prevent race conditions)
userSchema.methods.reduceStorageUsage = async function (fileSizeMB) {
  const result = await mongoose.model('User').findByIdAndUpdate(
    this._id,
    { $inc: { 'usage.storageUsedMB': -fileSizeMB } },
    { new: true, select: 'usage.storageUsedMB' }
  );
  // Ensure we don't go below 0
  if (result.usage.storageUsedMB < 0) {
    await mongoose.model('User').findByIdAndUpdate(
      this._id,
      { $set: { 'usage.storageUsedMB': 0 } }
    );
    this.usage.storageUsedMB = 0;
  } else {
    this.usage.storageUsedMB = result.usage.storageUsedMB;
  }
  return this.usage.storageUsedMB;
};

// Add token usage (atomic operation to prevent race conditions)
userSchema.methods.addTokenUsage = async function (tokensUsed) {
  const result = await mongoose.model('User').findByIdAndUpdate(
    this._id,
    { $inc: { 'usage.tokensUsedThisMonth': tokensUsed } },
    { new: true, select: 'usage.tokensUsedThisMonth' }
  );
  this.usage.tokensUsedThisMonth = result.usage.tokensUsedThisMonth;
  return this.usage.tokensUsedThisMonth;
};

// Reset monthly usage
userSchema.methods.resetMonthlyUsage = async function () {
  this.usage.uploadsThisMonth = 0;
  this.usage.tokensUsedThisMonth = 0;
  this.usage.lastResetDate = new Date();
  await this.save();
};

// Check if subscription is expired
userSchema.methods.isSubscriptionExpired = function () {
  if (!this.subscriptionExpiry) return false;
  return new Date() > this.subscriptionExpiry;
};

// Upgrade or downgrade tier
userSchema.methods.updateTier = async function (newTier, expiryDate = null) {
  this.subscriptionTier = newTier;
  this.subscriptionExpiry = expiryDate;
  this.subscriptionStatus = 'active';
  await this.save();
  return this;
};

// Get remaining uploads
userSchema.methods.getRemainingUploads = function () {
  if (this.limits.uploadsPerMonth === -1) return 'unlimited';
  return Math.max(0, this.limits.uploadsPerMonth - this.usage.uploadsThisMonth);
};

// Get remaining storage in MB
userSchema.methods.getRemainingStorage = function () {
  if (this.limits.maxStorageMB === -1) return 'unlimited';
  return Math.max(0, this.limits.maxStorageMB - this.usage.storageUsedMB);
};

// Get remaining tokens
userSchema.methods.getRemainingTokens = function () {
  if (this.limits.tokensPerMonth === -1) return 'unlimited';
  return Math.max(0, this.limits.tokensPerMonth - this.usage.tokensUsedThisMonth);
};

// Compare passwords
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Remove password from JSON output
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

// Indexes
userSchema.index({ email: 1, isActive: 1 });
userSchema.index({ username: 1, isActive: 1 });
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ subscriptionTier: 1, subscriptionStatus: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ lastLogin: -1 });

// ─── Static methods: ALL read LIVE from PricingConfig (admin dashboard) ───

// Get LIVE tier limits from admin-editable PricingConfig
// ★ This is the PRIMARY method — reads from the DB every time
userSchema.statics.getLiveTierLimits = async function (tier) {
  try {
    const PricingConfig = require('./PricingConfig');
    const config = await PricingConfig.getConfig();
    const liveLimits = config?.tiers?.[tier]?.limits;
    if (liveLimits && typeof liveLimits === 'object') {
      return liveLimits;
    }
  } catch (err) {
    Logger.warn('getLiveTierLimits: PricingConfig unavailable, using seed fallback', { tier, error: err.message });
  }
  // Fallback to seed data
  const { CANONICAL_TIERS } = require('./PricingConfig');
  return CANONICAL_TIERS[tier]?.limits || CANONICAL_TIERS.free.limits;
};

// Synchronous fallback (uses seed data) — prefer getLiveTierLimits() instead
userSchema.statics.getTierLimits = function (tier) {
  const { CANONICAL_TIERS } = require('./PricingConfig');
  return CANONICAL_TIERS[tier]?.limits || CANONICAL_TIERS.free.limits;
};

// Get LIVE tier pricing from admin-editable PricingConfig
userSchema.statics.getLiveTierPricing = async function (tier) {
  try {
    const PricingConfig = require('./PricingConfig');
    const config = await PricingConfig.getConfig();
    const tierData = config?.tiers?.[tier];
    if (tierData) {
      return { monthlyUSD: tierData.monthlyUSD, yearlyUSD: tierData.yearlyUSD, currency: 'USD' };
    }
  } catch (err) {
    Logger.warn('getLiveTierPricing: PricingConfig unavailable', { tier, error: err.message });
  }
  const { CANONICAL_TIERS } = require('./PricingConfig');
  const t = CANONICAL_TIERS[tier] || CANONICAL_TIERS.free;
  return { monthlyUSD: t.monthlyUSD, yearlyUSD: t.yearlyUSD, currency: 'USD' };
};

// Synchronous fallback
userSchema.statics.getTierPricing = function (tier) {
  const { CANONICAL_TIERS } = require('./PricingConfig');
  const t = CANONICAL_TIERS[tier] || CANONICAL_TIERS.free;
  return { monthlyUSD: t.monthlyUSD, yearlyUSD: t.yearlyUSD, currency: 'USD' };
};

// Get all plans LIVE from admin config
userSchema.statics.getAllPlansLive = async function () {
  try {
    const PricingConfig = require('./PricingConfig');
    const config = await PricingConfig.getConfig();
    if (config?.tiers) {
      return Object.entries(config.tiers).map(([tier, data]) => ({
        tier,
        name: data.name,
        description: data.description,
        limits: data.limits,
        pricing: { monthlyUSD: data.monthlyUSD, yearlyUSD: data.yearlyUSD },
        features: data.features
      }));
    }
  } catch (err) {
    Logger.warn('getAllPlansLive: PricingConfig unavailable', { error: err.message });
  }
  // Fallback to seed
  const { CANONICAL_TIERS } = require('./PricingConfig');
  return Object.entries(CANONICAL_TIERS).map(([tier, data]) => ({
    tier, name: data.name, description: data.description,
    limits: data.limits, pricing: { monthlyUSD: data.monthlyUSD, yearlyUSD: data.yearlyUSD },
    features: data.features
  }));
};

const UserModel = mongoose.models.User || mongoose.model("User", userSchema);
module.exports = UserModel;
