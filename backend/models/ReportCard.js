"use strict";
const mongoose = require("mongoose");

const gradeEntrySchema = new mongoose.Schema(
  {
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
    },
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    caScore: { type: Number, default: 0 },
    examScore: { type: Number, default: 0 },
    totalScore: { type: Number, default: 0 },
    letterGrade: { type: String, default: "" },
    remark: { type: String, default: "" },
  },
  { _id: false },
);

const attendanceSummarySchema = new mongoose.Schema(
  {
    present: { type: Number, default: 0 },
    absent: { type: Number, default: 0 },
    late: { type: Number, default: 0 },
    excused: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
  },
  { _id: false },
);

const reportCardSchema = new mongoose.Schema(
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

    grades: [gradeEntrySchema],

    attendanceSummary: attendanceSummarySchema,

    classPosition: { type: Number },
    classSize: { type: Number },

    classTeacherComment: { type: String, default: "" },
    principalComment: { type: String, default: "" },

    // Supabase storage key for the generated PDF
    storageKey: { type: String, default: "" },

    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
    },
    publishedAt: { type: Date },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// One report card per student per term
reportCardSchema.index({ studentId: 1, termId: 1 }, { unique: true });
reportCardSchema.index({ orgId: 1, termId: 1, classId: 1 });

module.exports = mongoose.model("ReportCard", reportCardSchema);
