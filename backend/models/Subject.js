const mongoose = require("mongoose");

const subjectSchema = new mongoose.Schema({
  orgId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true,
    index: true,
  },

  // e.g. "Mathematics", "English Language"
  name: {
    type: String,
    required: true,
    trim: true,
  },

  // Short code, optional — e.g. "MTH", "ENG"
  code: {
    type: String,
    trim: true,
    uppercase: true,
    default: null,
  },

  description: {
    type: String,
    default: null,
  },

  // When true, teachers teaching this subject can see each other's
  // published questions (drafts remain private). Off by default.
  sharingEnabled: {
    type: Boolean,
    default: false,
  },

  isActive: {
    type: Boolean,
    default: true,
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

subjectSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// One subject name per org
subjectSchema.index({ orgId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Subject", subjectSchema);
