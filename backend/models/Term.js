const mongoose = require("mongoose");

const termSchema = new mongoose.Schema({
  orgId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true,
    index: true,
  },

  academicYearId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "AcademicYear",
    required: true,
    index: true,
  },

  name: {
    type: String,
    enum: ["First Term", "Second Term", "Third Term"],
    required: true,
  },

  startDate: {
    type: Date,
    required: true,
  },

  endDate: {
    type: Date,
    required: true,
  },

  // Currently running — only one active per org at a time
  isActive: {
    type: Boolean,
    default: false,
    index: true,
  },

  // Officially closed by an admin
  isClosed: {
    type: Boolean,
    default: false,
  },

  // Set on close: "orgs/{orgId}/archives/{termId}.json.gz"
  archiveS3Key: {
    type: String,
    default: null,
  },

  archivedAt: {
    type: Date,
    default: null,
  },

  closedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

termSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// One active term per org at a time
termSchema.index({ orgId: 1, isActive: 1 });
// One set of three terms per academic year
termSchema.index({ academicYearId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Term", termSchema);
