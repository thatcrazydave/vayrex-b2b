"use strict";
const mongoose = require("mongoose");

const attendanceEntrySchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["present", "absent", "late", "excused"],
      required: true,
    },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const attendanceRecordSchema = new mongoose.Schema(
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
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    termId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Term",
      required: true,
    },

    date: { type: Date, required: true },
    period: {
      type: String,
      enum: ["morning", "afternoon", "full-day"],
      default: "full-day",
    },

    records: [attendanceEntrySchema],

    isLocked: { type: Boolean, default: false },
    lockedAt: { type: Date },
  },
  { timestamps: true },
);

// One attendance record per class per date per period
attendanceRecordSchema.index({ classId: 1, date: 1, period: 1 }, { unique: true });
attendanceRecordSchema.index({ orgId: 1, termId: 1, classId: 1 });

module.exports = mongoose.model("AttendanceRecord", attendanceRecordSchema);
