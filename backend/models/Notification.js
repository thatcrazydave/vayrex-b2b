"use strict";
const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    orgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
    },

    type: {
      type: String,
      enum: [
        "announcement",
        "assignment_created",
        "assignment_due_soon",
        "grade_published",
        "report_card_ready",
        "attendance_below_threshold",
        "org_invite",
        "seat_assigned",
        "class_promotion",
        "term_closing",
        "grade_amendment_approved",
      ],
      required: true,
    },

    title: { type: String, required: true },
    body: { type: String, default: "" },
    actionUrl: { type: String, default: "" },

    isRead: { type: Boolean, default: false },
    readAt: { type: Date },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
