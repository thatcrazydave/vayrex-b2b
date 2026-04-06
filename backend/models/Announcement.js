"use strict";
const mongoose = require("mongoose");

const announcementSchema = new mongoose.Schema(
  {
    orgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    scope: {
      type: String,
      enum: ["school", "class", "teacher-broadcast", "user"],
      required: true,
    },
    targetClassIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Classroom" }],
    targetUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // Pre-computed flat recipient list for efficient queries
    recipientList: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    title: { type: String, required: true, trim: true },
    body: { type: String, default: "", trim: true },
    attachmentUrl: { type: String, default: "" },

    isActive: { type: Boolean, default: true },
    expiresAt: { type: Date },
  },
  { timestamps: true },
);

announcementSchema.index({ orgId: 1, recipientList: 1 });
announcementSchema.index({ orgId: 1, isActive: 1, expiresAt: 1 });

module.exports = mongoose.model("Announcement", announcementSchema);
