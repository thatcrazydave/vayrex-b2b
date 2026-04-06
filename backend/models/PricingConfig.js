const mongoose = require("mongoose");

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
const SCHEMA_VERSION = 5; // bumped: removed B2C tiers (free/starter/pro) — B2B school tiers only

// SEED DATA — used ONLY to create or reset the MongoDB document.
// After creation, all values are managed via Admin Dashboard.
const CANONICAL_TIERS = {
  // ── B2B Institutional Tiers ──────────────────────────────────
  school_starter: {
    name: "School Starter",
    description: "For schools up to 200 students",
    seats: 200,
    termPriceNGN: 150000,
    features: [
      "Up to 200 student seats",
      "All Pro-equivalent AI features per member",
      "Grade book & report cards",
      "Attendance tracking",
      "Guardian portal",
      "Assignment management",
      "Dedicated school subdomain",
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
      priorityProcessing: false,
      revealsPerQuiz: -1,
    },
  },

  school_pro: {
    name: "School Pro",
    description: "For schools up to 1,000 students",
    seats: 1000,
    termPriceNGN: 400000,
    features: [
      "Up to 1,000 student seats",
      "All Pro-equivalent AI features per member",
      "Grade book & report cards",
      "Attendance tracking",
      "Guardian portal",
      "Assignment management",
      "Priority processing for all members",
      "Dedicated school subdomain",
      "Advanced analytics",
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
      revealsPerQuiz: -1,
    },
  },

  enterprise: {
    name: "Enterprise",
    description: "Unlimited seats, custom quote",
    seats: -1, // unlimited
    termPriceNGN: 0, // custom invoice
    features: [
      "Unlimited student seats",
      "All Pro-equivalent AI features per member",
      "Grade book & report cards",
      "Attendance tracking",
      "Guardian portal",
      "Assignment management",
      "Priority processing for all members",
      "Dedicated school subdomain",
      "Advanced analytics",
      "SSO support",
      "Custom onboarding & SLA",
    ],
    limits: {
      uploadsPerDay: -1,
      uploadsPerMonth: -1,
      filesPerUpload: 10,
      maxFileSizeMB: 100,
      maxStorageMB: -1,
      questionsPerUpload: 1000,
      tokensPerMonth: -1,
      tokensPerRequest: 6000,
      maxChatHistory: 100,
      pdfExport: true,
      noteSummary: true,
      priorityProcessing: true,
      revealsPerQuiz: -1,
    },
  },
};

// ─── Schema (shape only — no hardcoded defaults) ────────────────
// The actual values live in the MongoDB document, managed by admin.
const pricingConfigSchema = new mongoose.Schema({
  _key: { type: String, default: "pricing", unique: true },
  schemaVersion: { type: Number, default: SCHEMA_VERSION },

  // Tiers stored as a flexible object — admin can edit any field
  tiers: {
    type: mongoose.Schema.Types.Mixed,
    default: () => JSON.parse(JSON.stringify(CANONICAL_TIERS)),
  },

  // Exchange rates
  exchangeRates: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({
      NGN: 1600,
      GBP: 0.79,
      EUR: 0.92,
      CAD: 1.36,
      INR: 83.5,
      GHS: 15.5,
      ZAR: 18.3,
      KES: 129,
      lastUpdated: new Date(),
    }),
  },

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedAt: { type: Date, default: Date.now },
});

// ─── Get or create singleton config ─────────────────────────────
pricingConfigSchema.statics.getConfig = async function () {
  let config = await this.findOne({ _key: "pricing" }).lean();

  // First boot — create from seed data
  if (!config) {
    const doc = await this.create({ _key: "pricing" });
    return doc.toObject();
  }

  // Version mismatch → reseed ALL tier data from CANONICAL_TIERS
  if (!config.schemaVersion || config.schemaVersion < SCHEMA_VERSION) {
    config = await this.findOneAndUpdate(
      { _key: "pricing" },
      {
        $set: {
          tiers: JSON.parse(JSON.stringify(CANONICAL_TIERS)),
          schemaVersion: SCHEMA_VERSION,
        },
      },
      { new: true },
    ).lean();

    const Logger = require("../logger");
    Logger.info(`PricingConfig reseeded to schema v${SCHEMA_VERSION}`);
  }

  return config;
};

// ─── Update config (admin only) ─────────────────────────────────
pricingConfigSchema.statics.updateConfig = async function (updates, adminId) {
  const config = await this.findOneAndUpdate(
    { _key: "pricing" },
    { ...updates, updatedBy: adminId, updatedAt: new Date() },
    { upsert: true, new: true, runValidators: true },
  );
  return config;
};

// ─── Exports ────────────────────────────────────────────────────
const PricingConfig = mongoose.model("PricingConfig", pricingConfigSchema);
module.exports = PricingConfig;
module.exports.CANONICAL_TIERS = CANONICAL_TIERS;
module.exports.SCHEMA_VERSION = SCHEMA_VERSION;
