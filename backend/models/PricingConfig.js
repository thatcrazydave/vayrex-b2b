const mongoose = require('mongoose');

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║              PricingConfig — SINGLE SOURCE OF TRUTH         ║
 * ║                                                              ║
 * ║  The MongoDB document is the ONLY live source.               ║
 * ║  CANONICAL_TIERS below is SEED DATA — used once to create    ║
 * ║  the initial document, then the admin dashboard takes over.  ║
 * ║  Bump SCHEMA_VERSION to force-reseed from code.              ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

// Bump this to force-reseed the MongoDB document on next server boot
const SCHEMA_VERSION = 3;

// SEED DATA — used ONLY to create or reset the MongoDB document.
// After creation, all values are managed via Admin Dashboard.
const CANONICAL_TIERS = {
  free: {
    name: 'Free',
    description: 'Perfect for getting started',
    monthlyUSD: 0,
    yearlyUSD: 0,
    features: [
      '3 uploads per day',
      '3 files per upload',
      '10MB max file size',
      '100MB storage',
      '20 questions per upload',
      'AI-powered quiz generation',
      '3 answer reveals per quiz'
    ],
    limits: {
      uploadsPerDay: 3,
      uploadsPerMonth: 50,
      filesPerUpload: 3,
      maxFileSizeMB: 10,
      maxStorageMB: 100,
      questionsPerUpload: 20,
      tokensPerMonth: 5000,
      tokensPerRequest: 1000,
      maxChatHistory: 10,
      pdfExport: false,
      noteSummary: false,
      priorityProcessing: false,
      revealsPerQuiz: 3
    }
  },
  starter: {
    name: 'Starter',
    description: 'For serious learners',
    monthlyUSD: 999,
    yearlyUSD: 9590,
    features: [
      '150 uploads per month',
      '3 files per upload',
      '25MB max file size',
      '1GB storage',
      '200 questions per upload',
      'PDF export',
      'AI note summaries',
      '15 answer reveals per quiz'
    ],
    limits: {
      uploadsPerDay: -1,
      uploadsPerMonth: 150,
      filesPerUpload: 3,
      maxFileSizeMB: 25,
      maxStorageMB: 1024,
      questionsPerUpload: 200,
      tokensPerMonth: 100000,
      tokensPerRequest: 2000,
      maxChatHistory: 30,
      pdfExport: true,
      noteSummary: true,
      priorityProcessing: false,
      revealsPerQuiz: 15
    }
  },
  pro: {
    name: 'Pro',
    description: 'For power users & professionals',
    monthlyUSD: 2499,
    yearlyUSD: 23990,
    features: [
      '300 uploads per month',
      '10 files per upload',
      '100MB max file size',
      '5GB storage',
      '1000 questions per upload',
      'PDF export',
      'AI note summaries',
      'Priority processing',
      'Full chat history',
      'Unlimited answer reveals'
    ],
    limits: {
      uploadsPerDay: -1,
      uploadsPerMonth: 300,
      filesPerUpload: 10,
      maxFileSizeMB: 100,
      maxStorageMB: 5120,
      questionsPerUpload: 1000,
      tokensPerMonth: 1000000,
      tokensPerRequest: 6000,
      maxChatHistory: 100,
      pdfExport: true,
      noteSummary: true,
      priorityProcessing: true,
      revealsPerQuiz: -1
    }
  }
};

// ─── Schema (shape only — no hardcoded defaults) ────────────────
// The actual values live in the MongoDB document, managed by admin.
const pricingConfigSchema = new mongoose.Schema({
  _key: { type: String, default: 'pricing', unique: true },
  schemaVersion: { type: Number, default: SCHEMA_VERSION },

  // Tiers stored as a flexible object — admin can edit any field
  tiers: {
    type: mongoose.Schema.Types.Mixed,
    default: () => JSON.parse(JSON.stringify(CANONICAL_TIERS))
  },

  // Exchange rates
  exchangeRates: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({
      NGN: 1600, GBP: 0.79, EUR: 0.92, CAD: 1.36,
      INR: 83.5, GHS: 15.5, ZAR: 18.3, KES: 129,
      lastUpdated: new Date()
    })
  },

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedAt: { type: Date, default: Date.now }
});

// ─── Get or create singleton config ─────────────────────────────
pricingConfigSchema.statics.getConfig = async function () {
  let config = await this.findOne({ _key: 'pricing' }).lean();

  // First boot — create from seed data
  if (!config) {
    const doc = await this.create({ _key: 'pricing' });
    return doc.toObject();
  }

  // Version mismatch → reseed ALL tier data from CANONICAL_TIERS
  if (!config.schemaVersion || config.schemaVersion < SCHEMA_VERSION) {
    config = await this.findOneAndUpdate(
      { _key: 'pricing' },
      { $set: { tiers: JSON.parse(JSON.stringify(CANONICAL_TIERS)), schemaVersion: SCHEMA_VERSION } },
      { new: true }
    ).lean();

    const Logger = require('../logger');
    Logger.info(`PricingConfig reseeded to schema v${SCHEMA_VERSION}`);
  }

  return config;
};

// ─── Update config (admin only) ─────────────────────────────────
pricingConfigSchema.statics.updateConfig = async function (updates, adminId) {
  const config = await this.findOneAndUpdate(
    { _key: 'pricing' },
    { ...updates, updatedBy: adminId, updatedAt: new Date() },
    { upsert: true, new: true, runValidators: true }
  );
  return config;
};

// ─── Exports ────────────────────────────────────────────────────
const PricingConfig = mongoose.model('PricingConfig', pricingConfigSchema);
module.exports = PricingConfig;
module.exports.CANONICAL_TIERS = CANONICAL_TIERS;
module.exports.SCHEMA_VERSION = SCHEMA_VERSION;
