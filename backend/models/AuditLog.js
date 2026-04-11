const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  action: {
    type: String,
    required: true,
    enum: [
      // ── B2C actions (unchanged) ───────────────────────────────
      "user_created",
      "user_updated",
      "user_deleted",
      "user_role_changed",
      "user_status_changed",
      "question_uploaded",
      "question_deleted",
      "exam_taken",
      "contact_created",
      "contact_updated",
      "backup_created",
      "backup_restored",
      "settings_updated",
      "login",
      "logout",
      "failed_login",
      "admin_access_success",
      "admin_access_denied",
      // ── B2B org actions ───────────────────────────────────────
      "org_created",
      "org_updated",
      "org_member_invited",
      "org_member_removed",
      "seat_assigned",
      "seat_revoked",
      "class_created",
      "class_updated",
      "term_opened",
      "term_closed",
      "grade_published",
      "grade_amended",
      "report_card_published",
      "assignment_published",
      "attendance_locked",
      "promotion_wizard_completed",
      "guardian_linked",
    ],
  },
  // B2B: org context for audit trail (null for B2C actions)
  orgId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    default: null,
    index: true,
  },
  targetType: String,
  targetId: mongoose.Schema.Types.ObjectId,
  details: mongoose.Schema.Types.Mixed,
  ipAddress: String,
  userAgent: String,
  severity: {
    type: String,
    enum: ["info", "warning", "error", "critical"],
    default: "info",
  },
  createdAt: { type: Date, default: Date.now },
});

auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ orgId: 1, action: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
