"use strict";
const mongoose = require("mongoose");

const assignmentSchema = new mongoose.Schema(
  {
    orgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Classroom",
      required: true,
    },
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
    },
    termId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Term",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Question" }],
    dueDate: { type: Date },

    status: {
      type: String,
      enum: ["draft", "assigned", "submitted", "marked", "published"],
      default: "draft",
    },

    maxScore: { type: Number, default: 100 },
    autoGradeObjective: { type: Boolean, default: true },
  },
  { timestamps: true },
);

assignmentSchema.index({ orgId: 1, classId: 1, termId: 1 });
assignmentSchema.index({ orgId: 1, createdBy: 1 });

module.exports = mongoose.model("Assignment", assignmentSchema);
