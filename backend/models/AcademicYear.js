const mongoose = require("mongoose");

const academicYearSchema = new mongoose.Schema({
  orgId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true,
    index: true,
  },

  name: {
    type: String,
    required: true,
    trim: true, // e.g. "2025/2026"
  },

  startDate: {
    type: Date,
    required: true,
  },

  endDate: {
    type: Date,
    required: true,
  },

  // Only one active year per org at a time — enforced via pre-save
  isActive: {
    type: Boolean,
    default: false,
    index: true,
  },

  // True when all three terms have been closed
  isArchived: {
    type: Boolean,
    default: false,
  },

  // Ordered ref to the three Term documents created with this year
  terms: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Term",
    },
  ],

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

academicYearSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// Compound index: one active year per org
academicYearSchema.index({ orgId: 1, isActive: 1 });
academicYearSchema.index({ orgId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("AcademicYear", academicYearSchema);
