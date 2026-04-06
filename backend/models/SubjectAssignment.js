const mongoose = require("mongoose");

/**
 * SubjectAssignment — the atomic unit of teacher scheduling.
 * "Mr. John teaching Mathematics in JSS1A during First Term 2025/2026."
 *
 * One teacher per subject per class per term is enforced by the unique index.
 * When a teacher is replaced mid-term, the old assignment is deactivated (isActive → false)
 * and a new one is created for the replacement.
 */
const subjectAssignmentSchema = new mongoose.Schema({
  orgId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true,
    index: true,
  },

  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
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

  // Deactivated on mid-term handoff — old assignment kept for audit trail
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

subjectAssignmentSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// Enforces: one teacher per subject per class per term (only for active assignments)
subjectAssignmentSchema.index(
  { classId: 1, subjectId: 1, termId: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

subjectAssignmentSchema.index({ teacherId: 1, termId: 1 });
subjectAssignmentSchema.index({ orgId: 1, termId: 1 });

module.exports = mongoose.model("SubjectAssignment", subjectAssignmentSchema);
