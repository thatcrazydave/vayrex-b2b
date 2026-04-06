"use strict";
const mongoose = require("mongoose");

const answerEntrySchema = new mongoose.Schema(
  {
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
    },
    answer: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false },
);

const submissionSchema = new mongoose.Schema(
  {
    orgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    assignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Assignment",
      required: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    answers: [answerEntrySchema],

    autoScore: { type: Number, default: 0 },
    teacherScore: { type: Number, default: 0 },
    totalScore: { type: Number, default: 0 },

    feedback: { type: String, default: "" },

    submittedAt: { type: Date, default: Date.now },
    gradedAt: { type: Date },

    status: {
      type: String,
      enum: ["submitted", "graded", "returned"],
      default: "submitted",
    },
  },
  { timestamps: true },
);

// One submission per student per assignment
submissionSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true });
submissionSchema.index({ orgId: 1, assignmentId: 1 });

module.exports = mongoose.model("Submission", submissionSchema);
