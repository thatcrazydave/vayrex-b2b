const mongoose = require("mongoose");

const DEFAULT_GRADE_BOUNDARIES = [
  { grade: "A1", min: 75, max: 100, remark: "Excellent" },
  { grade: "B2", min: 70, max: 74, remark: "Very Good" },
  { grade: "B3", min: 65, max: 69, remark: "Good" },
  { grade: "C4", min: 60, max: 64, remark: "Credit" },
  { grade: "C5", min: 55, max: 59, remark: "Credit" },
  { grade: "C6", min: 50, max: 54, remark: "Credit" },
  { grade: "D7", min: 45, max: 49, remark: "Pass" },
  { grade: "E8", min: 40, max: 44, remark: "Pass" },
  { grade: "F9", min: 0, max: 39, remark: "Fail" },
];

const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },

  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  },

  subdomain: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  },

  plan: {
    type: String,
    enum: ["school_starter", "school_pro", "enterprise"],
    default: "school_starter",
  },

  enrollmentCapacity: {
    type: Number,
    default: 220, // 200 declared + 10% buffer for school_starter
  },

  enrollmentCount: {
    type: Number,
    default: 0,
  },

  // Email domains that auto-enroll matching signups as students
  allowedDomains: {
    type: [String],
    default: [],
  },

  emailDomain: {
    type: String,
    default: null,
  },

  // True if Vayrex provisioned @{slug}.coedu.com addresses
  emailProvisioned: {
    type: Boolean,
    default: false,
  },

  billingContactId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },

  paystackCustomerId: {
    type: String,
    default: null,
  },

  subscriptionStatus: {
    type: String,
    enum: ["active", "past_due", "cancelled", "pending"],
    default: "pending",
  },

  subscriptionExpiry: {
    type: Date,
    default: null,
  },

  // Per-org branding: colours, logo, display copy
  branding: {
    logoUrl:            { type: String, default: null },  // S3 URL
    faviconUrl:         { type: String, default: null },
    primaryColor:       { type: String, default: "#2563eb" },
    accentColor:        { type: String, default: "#10b981" },
    displayName:        { type: String, default: null },  // overrides org.name in UI if set
    tagline:            { type: String, default: null },
    loginHeroText:      { type: String, default: null },
    hideVayrexBranding: { type: Boolean, default: false }, // enterprise flag
  },

  // Feature flags toggled by Vayrex staff per org
  featureFlags: {
    sharedLibrary: { type: Boolean, default: false },
    assignments: { type: Boolean, default: true },
    csvImport: { type: Boolean, default: true },
    sso: { type: Boolean, default: false },
    guardianPortal: { type: Boolean, default: true },
    imageGenInNotes: { type: Boolean, default: false },
  },

  // Org-level academic settings (editable by owner/org_admin)
  settings: {
    caWeight: { type: Number, default: 40 }, // % of final score from CA
    examWeight: { type: Number, default: 60 }, // % of final score from exam
    // Score components the org uses — e.g. CA1, CA2, MidTerm, Exam
    // Each with a display name, max score, and whether it counts as Exam weight
    scoreComponents: {
      type: [
        {
          name: { type: String, required: true, trim: true },   // e.g. "CA1", "Test 1"
          maxScore: { type: Number, required: true, min: 1, default: 100 },
          isExam: { type: Boolean, default: false },             // true = Exam weight
          order: { type: Number, default: 0 },                  // display order
        },
      ],
      default: [
        { name: "CA1",     maxScore: 100, isExam: false, order: 0 },
        { name: "CA2",     maxScore: 100, isExam: false, order: 1 },
        { name: "MidTerm", maxScore: 100, isExam: false, order: 2 },
        { name: "Exam",    maxScore: 100, isExam: true,  order: 3 },
      ],
    },
    gradeBoundaries: {
      type: [
        {
          grade: { type: String, required: true },
          min: { type: Number, required: true },
          max: { type: Number, required: true },
          remark: { type: String, required: true },
          points: { type: Number, default: 0 },
        },
      ],
      default: DEFAULT_GRADE_BOUNDARIES,
    },
    attendancePeriods: {
      type: String,
      enum: ["morning", "afternoon", "full-day", "both"],
      default: "full-day",
    },
    attendanceThreshold: { type: Number, default: 75 }, // % alert below this
    allowExcelAttendance: { type: Boolean, default: true },
    examOfflineMode: { type: Boolean, default: true },
  },

  // 5-step onboarding wizard
  setupComplete: { type: Boolean, default: false },
  setupStep: { type: Number, default: 1, min: 1, max: 5 },

  isActive: {
    type: Boolean,
    default: false, // goes live only when setupComplete = true
    index: true,
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Keep updatedAt current on every save
organizationSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// Helper: derive enrollment ceiling from declared count with buffer
organizationSchema.statics.calcCapacity = function (declared) {
  return Math.ceil(declared * 1.1); // 10% buffer
};

// Helper: lookup by subdomain (cached in Redis by the guard middleware)
organizationSchema.statics.findBySubdomain = function (subdomain) {
  return this.findOne({ subdomain: subdomain.toLowerCase(), isActive: true }).lean();
};

module.exports = mongoose.model("Organization", organizationSchema);
