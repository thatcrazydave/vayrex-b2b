/**
 * GradeBook.js
 *
 * Per-student, per-subject, per-term grade record.
 * Teachers enter raw component scores (CA1, CA2, MidTerm, Exam).
 * Computed fields (totalCA, totalExam, finalScore, letterGrade, remark)
 * are derived automatically via pre-save hook using the org's settings.
 *
 * Unique compound index: { studentId, subjectId, termId }
 * -- one grade entry per student per subject per term.
 */

"use strict";
const mongoose = require("mongoose");

const gradeComponentSchema = new mongoose.Schema(
  {
    // Open string — org configures its own component names (CA1, Test 1, Practical, etc.)
    type: {
      type: String,
      required: true,
      trim: true,
    },
    score: { type: Number, required: true, min: 0 },
    maxScore: { type: Number, required: true, min: 1, default: 100 },
    // true = counts as Exam weight, false = counts as CA weight
    isExam: { type: Boolean, default: false },
    weight: { type: Number, min: 0, max: 100 },
    enteredAt: { type: Date, default: Date.now },
    enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false },
);

const gradeBookSchema = new mongoose.Schema(
  {
    orgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
    },
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Classroom",
      required: true,
    },
    termId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Term",
      required: true,
    },

    // Raw component scores entered by teacher
    components: [gradeComponentSchema],

    // Computed fields (derived in pre-save)
    totalCA: { type: Number, default: 0 },
    totalExam: { type: Number, default: 0 },
    finalScore: { type: Number, default: 0 },
    letterGrade: { type: String, default: "" },
    gradePoints: { type: Number, default: 0 },
    // Open string — remark is derived from org-configured grade boundaries
    remark: { type: String, default: "" },

    status: {
      type: String,
      enum: ["draft", "reviewed", "published"],
      default: "draft",
    },
    publishedAt: { type: Date },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Amendment trail
    amendments: [
      {
        reason: String,
        previousScore: Number,
        newScore: Number,
        amendedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        amendedAt: { type: Date, default: Date.now },
      },
    ],
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// One grade entry per student per subject per term
gradeBookSchema.index({ studentId: 1, subjectId: 1, termId: 1 }, { unique: true });
gradeBookSchema.index({ orgId: 1, termId: 1, classId: 1 });
gradeBookSchema.index({ orgId: 1, status: 1 });

/**
 * Default Nigerian grade boundaries.
 * When org settings are available they override these.
 */
const DEFAULT_BOUNDARIES = [
  { grade: "A1", min: 75, max: 100, remark: "Excellent", points: 1 },
  { grade: "B2", min: 70, max: 74, remark: "Very Good", points: 2 },
  { grade: "B3", min: 65, max: 69, remark: "Good", points: 3 },
  { grade: "C4", min: 60, max: 64, remark: "Credit", points: 4 },
  { grade: "C5", min: 55, max: 59, remark: "Credit", points: 5 },
  { grade: "C6", min: 50, max: 54, remark: "Credit", points: 6 },
  { grade: "D7", min: 45, max: 49, remark: "Pass", points: 7 },
  { grade: "E8", min: 40, max: 44, remark: "Pass", points: 8 },
  { grade: "F9", min: 0, max: 39, remark: "Fail", points: 9 },
];

// Simple in-memory cache for org settings to avoid N+1 queries on bulk grade saves.
// TTL: 5 minutes. Key: orgId string. Value: { caWeight, boundaries, cachedAt }.
const orgSettingsCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getOrgSettings(orgId) {
  const key = orgId.toString();
  const cached = orgSettingsCache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached;
  }
  try {
    const Organization = mongoose.model("Organization");
    const org = await Organization.findById(orgId).select("settings").lean();
    const result = {
      caWeight: org?.settings?.caWeight ?? 40,
      boundaries:
        Array.isArray(org?.settings?.gradeBoundaries) &&
        org.settings.gradeBoundaries.length > 0
          ? org.settings.gradeBoundaries
          : DEFAULT_BOUNDARIES,
      scoreComponents:
        Array.isArray(org?.settings?.scoreComponents) &&
        org.settings.scoreComponents.length > 0
          ? org.settings.scoreComponents
          : null, // null = use legacy CA/Exam split
      cachedAt: Date.now(),
    };
    orgSettingsCache.set(key, result);
    return result;
  } catch (_) {
    return { caWeight: 40, boundaries: DEFAULT_BOUNDARIES, scoreComponents: null, cachedAt: Date.now() };
  }
}

/**
 * Bust the in-memory cache for a specific org (call after settings are updated).
 */
function bustOrgSettingsCache(orgId) {
  orgSettingsCache.delete(orgId.toString());
}

module.exports.bustOrgSettingsCache = bustOrgSettingsCache;

/**
 * Pre-save hook: compute derived grade fields.
 * Fetches org.settings.caWeight and org.settings.gradeBoundaries at runtime
 * so that if the org changes weight/boundaries, grades recompute correctly.
 */
gradeBookSchema.pre("save", async function (next) {
  if (!this.isModified("components") && !this.isNew) return next();

  // Load org settings (CA weight, boundaries, scoreComponents)
  let caWeight = 40;
  let boundaries = DEFAULT_BOUNDARIES;
  let scoreComponents = null;
  try {
    const settings = await getOrgSettings(this.orgId);
    caWeight = settings.caWeight;
    boundaries = settings.boundaries;
    scoreComponents = settings.scoreComponents;
  } catch (_) {
    // Fallback to defaults
  }

  let caTotal = 0;
  let examScore = 0;

  if (scoreComponents && scoreComponents.length > 0) {
    // Dynamic mode: use isExam flag from org-defined components
    const compMap = {};
    scoreComponents.forEach((sc) => { compMap[sc.name] = sc; });

    const caComponents = this.components.filter((c) => !compMap[c.type]?.isExam);
    const examComponents = this.components.filter((c) => compMap[c.type]?.isExam);

    if (caComponents.length > 0) {
      caTotal = caComponents.reduce((sum, c) => sum + (c.score / (c.maxScore || 100)) * 100, 0) / caComponents.length;
    }
    if (examComponents.length > 0) {
      examScore = examComponents.reduce((sum, c) => sum + (c.score / (c.maxScore || 100)) * 100, 0) / examComponents.length;
    }
  } else {
    // Legacy mode: CA1/CA2/MidTerm = CA, Exam = Exam
    const caComponents = this.components.filter((c) => !["Exam"].includes(c.type));
    const examComponent = this.components.find((c) => c.type === "Exam");

    if (caComponents.length > 0) {
      caTotal = caComponents.reduce((sum, c) => sum + (c.score / (c.maxScore || 100)) * 100, 0) / caComponents.length;
    }
    if (examComponent) {
      examScore = (examComponent.score / (examComponent.maxScore || 100)) * 100;
    }
  }

  const examWeight = 100 - caWeight;

  this.totalCA = Math.round(caTotal * (caWeight / 100) * 100) / 100;
  this.totalExam = Math.round(examScore * (examWeight / 100) * 100) / 100;
  this.finalScore = Math.round((this.totalCA + this.totalExam) * 100) / 100;

  // Determine letter grade from org-configured boundaries
  const boundary = boundaries.find(
    (b) => this.finalScore >= b.min && this.finalScore <= b.max,
  );
  if (boundary) {
    this.letterGrade = boundary.grade;
    this.remark = boundary.remark;
    this.gradePoints = boundary.points || 0;
  }

  next();
});

const GradeBookModel = mongoose.model("GradeBook", gradeBookSchema);
module.exports = GradeBookModel;
